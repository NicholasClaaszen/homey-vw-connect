import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import vm from 'vm';
import { json } from 'node:stream/consumers'

export interface Credentials {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
}

export interface Vehicle {
  vin: string;
  modelName?: string;
  nickname?: string;
  batteryLevel?: number;
}

export class WeConnectApi {
  private client: AxiosInstance;
  private token?: TokenResponse;

  constructor() {
    const jar = new CookieJar();
    this.client = wrapper(axios.create({ jar }));
    this.client.defaults.headers.common['user-agent'] = 'Mozilla/5.0';
  }

  public async checkTokenValidity(): Promise<boolean> {
    if (!this.token || !this.token.access_token) {
      return false;
    }
    const parts = this.token.access_token.split('.');
    if (parts.length !== 3) {
      return false;
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    const exp = payload.exp;
    if (!exp) {
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    return exp > now;
  }

  private async followRedirect(url: string): Promise<string> {
    let next = url;
    while (true) {
      const res = await this.client.get(next, {
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      if (res.status === 302 || res.status === 303) {
        if (!res.headers.location) throw new Error('Missing redirect');
        next = res.headers.location as string;
        if (next.startsWith('weconnect://')) {
          return next;
        }
        continue;
      }
      return res.request.res.responseUrl || next;
    }
  }

  async login(creds: Credentials): Promise<void> {
    const nonce = Math.random().toString(16).slice(2);
    const authorizeUrl = `https://emea.bff.cariad.digital/user-login/v1/authorize?redirect_uri=weconnect://authenticated&nonce=${nonce}`;
    const first = await this.client.get(authorizeUrl, { maxRedirects: 0, validateStatus: (s) => s >= 300 && s < 400 });
    const loginUrl = first.headers.location as string;
    if (!loginUrl) throw new Error('Failed to get login url');

    // Fetch login form
    const loginPage = await this.client.get(loginUrl);
    const $login = cheerio.load(loginPage.data as string);

    const formAction = $login('form#emailPasswordForm').attr('action');
    const csrf = $login('input[name="_csrf"]').attr('value');
    const relayState = $login('input[name="relayState"]').attr('value');
    const hmac = $login('input[name="hmac"]').attr('value');

    if (!formAction || !csrf || !relayState || !hmac) {
      //log for debugging purposes
      throw new Error('Login form parse error');
    }

    const emailFormUrl = new URL(formAction, 'https://identity.vwgroup.io').toString();
    const emailPayload = new URLSearchParams({
      _csrf: csrf, relayState, hmac, email: creds.username,
    });
    const passPage = await this.client.post(emailFormUrl, emailPayload.toString(), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    const $pass = cheerio.load(passPage.data as string);
    const scriptContent = $pass('script')
      .map((i, el) => $pass(el).html())
      .get()
      .find(text => text?.includes('window._IDK'));

    if (!scriptContent) throw new Error('window._IDK script not found');



    const context: any = { window:{} };
    vm.createContext(context); // create sandbox
    vm.runInContext(scriptContent, context);

    const idkData = context.window?._IDK || context._IDK;

    const passAction = 'login/authenticate';
    const passRelay = idkData.templateModel.relayState || ''
    const passHmac = idkData.templateModel.hmac || ''
    const passCsrf = idkData.csrf_token || ''

    if (!passAction || !passRelay || !passHmac || !passCsrf) throw new Error('Password form parse error');
    const passUrl = `https://identity.vwgroup.io/signin-service/v1/a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com/${passAction}`;
    const passPayload = new URLSearchParams({
      relayState: passRelay, hmac: passHmac, _csrf: passCsrf, password: creds.password, email: creds.username,
    });

    const loginRes = await this.client.post(passUrl, passPayload.toString(), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
      validateStatus: (s) => s >= 300 && s < 400,
    });
    let redirect = loginRes.headers.location as string;
    if (!redirect) throw new Error('No redirect after login');

    if (!redirect.startsWith('weconnect://')) {
      redirect = await this.followRedirect(redirect);
    }

    if (!redirect.startsWith('weconnect://')) throw new Error('Unexpected redirect');
    const fragment = redirect.split('#')[1];
    const params = new URLSearchParams(fragment);
    const state = params.get('state');
    const idToken = params.get('id_token');
    const accessToken = params.get('access_token');
    const code = params.get('code');
    if (!state || !idToken || !accessToken || !code) throw new Error('Missing tokens');

    const body = {
      state,
      id_token: idToken,
      redirect_uri: 'weconnect://authenticated',
      region: 'emea',
      access_token: accessToken,
      authorizationCode: code,
    };

    const tokenRes = await this.client.post('https://emea.bff.cariad.digital/user-login/login/v1', body, {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    });
    if (tokenRes.status !== 200) throw new Error('Token fetch failed');
    this.token = {
      access_token: tokenRes.data.accessToken,
      refresh_token: tokenRes.data.refreshToken,
      id_token: tokenRes.data.idToken,
      expires_in: tokenRes.data.expiresIn,
      token_type: tokenRes.data.tokenType,
    };
  }

  async getVehicles(): Promise<Vehicle[]> {
    if (!this.token?.access_token) throw new Error('Not logged in');
    const res = await this.client.get('https://emea.bff.cariad.digital/vehicle/v1/vehicles', {
      headers: { Authorization: `Bearer ${this.token.access_token}` },
    });
    if (res.status !== 200) throw new Error('Failed to fetch vehicles');

    return (res.data.data as any[]).map((v) => ({
      vin: v.vin,
      modelName: v.model,
      nickname: v.nickname,
      batteryLevel: v.charging?.batteryStatusData?.stateOfCharge?.content,
    }));
  }

  async getVehicle(vin: string): Promise<any> {
    if (!this.token?.access_token) throw new Error('Not logged in');
    const res = await this.client.get(`https://emea.bff.cariad.digital/vehicle/v1/vehicles/${vin}/selectivestatus?jobs=access,activeventilation,automation,auxiliaryheating,userCapabilities,charging,chargingProfiles,batteryChargingCare,climatisation,climatisationTimers,departureTimers,fuelStatus,vehicleLights,lvBattery,readiness,vehicleHealthInspection,vehicleHealthWarnings,oilLevel,measurements,batterySupport,trips`, {
      headers: { Authorization: `Bearer ${this.token.access_token}` },
    });
    if (res.status !== 207) throw new Error('Failed to fetch vehicle');
    const v = res.data;
    const result = {
      vin: vin,
      batteryLevel: v.measurements.fuelLevelStatus?.value?.currentSOC_pct || 0,
      charging: {
        lastUpdate: v.charging?.chargingStatus?.value?.carCapturedTimestamp,
        chargingStatus: v.charging?.chargingStatus?.value?.chargingState,
        remainingTime: v.charging?.chargingStatus?.value?.remainingChargingTimeToComplete_min,
        chargingPower: v.charging?.chargingStatus?.value?.chargePower_kW,
        target: v.charging?.chargingSettings?.value?.targetSOC_pct,
      },
      climate: {
        target: v.climatisation?.climatisationSettings?.value?.targetTemperature_C,
        targetF: v.climatisation?.climatisationSettings?.value?.targetTemperature_F,
        remainingTime: v.climatisation?.climatisationStatus?.value?.remainingClimatisationTime_min,
        climateState: v.climatisation?.climatisationStatus?.value?.climatisationState,
        windowHeatingState: {
          front: "off",
          rear: "off",
        }
      },
      stats: {
        odometer: v.measurements.odometerStatus?.value?.odometer || 0,
        temperatureBatteryStatus: {
          min: v.measurements.temperatureBatteryStatus?.value?.temperatureHvBatteryMin_K || 0,
          max: v.measurements.temperatureBatteryStatus?.value?.temperatureHvBatteryMax_K || 0,
        },
        nextInspection: v.vehicleHealthInspection?.maintenanceStatus?.value?.inspectionDue_days || 999,
      }
    };

    v.climatisation?.windowHeatingStatus?.value?.windowHeatingStatus?.forEach((w: { windowLocation: 'front' | 'rear'; windowHeatingState: string }) => {
      result.climate.windowHeatingState[w.windowLocation] = w.windowHeatingState;
    });


    return result;
  }
}
