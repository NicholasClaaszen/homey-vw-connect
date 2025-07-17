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

import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

export class WeConnectApi {
  private client: AxiosInstance;
  private token?: TokenResponse;

  constructor() {
    const jar = new CookieJar();
    this.client = wrapper(axios.create({ jar }));
    this.client.defaults.headers.common['user-agent'] = 'Mozilla/5.0';
  }

  private async followRedirect(url: string): Promise<string> {
    let next = url;
    while (true) {
      const res = await this.client.get(next, {
        maxRedirects: 0,
        validateStatus: s => s >= 200 && s < 400,
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
    const first = await this.client.get(authorizeUrl, { maxRedirects: 0, validateStatus: s => s >= 300 && s < 400 });
    const loginUrl = first.headers.location as string;
    if (!loginUrl) throw new Error('Failed to get login url');

    // Fetch login form
    const loginPage = await this.client.get(loginUrl);
    const $login = cheerio.load(loginPage.data as string);
    const formAction = $login('form#emailPasswordForm').attr('action');
    const csrf = $login('input[name="_csrf"]').attr('value');
    const relayState = $login('input[name="relayState"]').attr('value');
    const hmac = $login('input[name="hmac"]').attr('value');
    if (!formAction || !csrf || !relayState || !hmac) throw new Error('Login form parse error');

    const emailFormUrl = new URL(formAction, 'https://identity.vwgroup.io').toString();
    const emailPayload = new URLSearchParams({ _csrf: csrf, relayState, hmac, email: creds.username });
    const passPage = await this.client.post(emailFormUrl, emailPayload.toString(), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    const $pass = cheerio.load(passPage.data as string);
    const passAction = $pass('form').attr('action');
    const passRelay = $pass('input[name="relayState"]').attr('value');
    const passHmac = $pass('input[name="hmac"]').attr('value');
    const passCsrf = $pass('input[name="_csrf"]').attr('value');
    if (!passAction || !passRelay || !passHmac || !passCsrf) throw new Error('Password form parse error');
    const passUrl = `https://identity.vwgroup.io/signin-service/v1/a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com/${passAction}`;
    const passPayload = new URLSearchParams({ relayState: passRelay, hmac: passHmac, _csrf: passCsrf, password: creds.password });

    const loginRes = await this.client.post(passUrl, passPayload.toString(), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
      validateStatus: s => s >= 300 && s < 400,
    });
    let redirect = loginRes.headers.location as string;
    if (!redirect) throw new Error('No redirect after login');

    // Follow any additional redirects until final
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
      headers: { 'accept': 'application/json', 'content-type': 'application/json' },
    });
    if (tokenRes.status !== 200) throw new Error('Token fetch failed');
    this.token = tokenRes.data as TokenResponse;
  }

  async refresh(): Promise<void> {
    if (!this.token?.refresh_token) throw new Error('No refresh token');
    const res = await this.client.get('https://emea.bff.cariad.digital/user-login/refresh/v1', {
      headers: { Authorization: `Bearer ${this.token.refresh_token}` },
    });
    if (res.status !== 200) throw new Error('Refresh failed');
    this.token = res.data as TokenResponse;
  }

  async getVehicles(): Promise<Vehicle[]> {
    if (!this.token?.access_token) throw new Error('Not logged in');
    const res = await this.client.get('https://emea.bff.cariad.digital/vehicle/v1/vehicles', {
      headers: { Authorization: `Bearer ${this.token.access_token}` },
    });
    if (res.status !== 200) throw new Error('Failed to fetch vehicles');
    return (res.data.data as any[]).map(v => ({
      vin: v.vin,
      modelName: v.model,
      nickname: v.nickname,
      batteryLevel: v.charging?.batteryStatusData?.stateOfCharge?.content,
    }));
  }
}
