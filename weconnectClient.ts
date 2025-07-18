import { WeConnectApi, Credentials, Vehicle } from './weconnectApi';

class WeConnectClient {
  private api = new WeConnectApi();
  private credentials?: Credentials;
  private cachedVehicles: Vehicle[] = [];

  setCredentials(username: string, password: string): void {
    this.credentials = { username, password };
  }

  async login(): Promise<void> {
    try {
      await this.api.login(this.credentials!);
    } catch (error) {
      throw new Error('Login failed: check your credentials.');
    }
    await this.pollOnce();
  }

  get vehicles() {
    return this.cachedVehicles;
  }

  private async pollOnce(): Promise<void> {
    const tokenCheck = await this.api.checkTokenValidity();
    if (!tokenCheck) {
      await this.login();
    }
    this.cachedVehicles = await this.api.getVehicles();
  }

  public async getVehicle(vin: string): Promise<Vehicle | undefined> {
    const tokenCheck = await this.api.checkTokenValidity();
    if (!tokenCheck) {
      await this.login();
    }

    const vehicle = await this.api.getVehicle(vin);
    if (!vehicle) {
      throw new Error(`Vehicle with VIN ${vin} not found.`);
    }

    this.cachedVehicles = this.cachedVehicles.map((v) => (v.vin === vin ? { ...v, batteryLevel: vehicle.batteryLevel } : v));

    return vehicle;
  }

  public async actionClimate(vin: string, enable: boolean, temperature: number) : Promise<void> {
    const tokenCheck = await this.api.checkTokenValidity();
    if (!tokenCheck) {
      await this.login();
    }

    const vehicle = await this.getVehicle(vin);
    if (!vehicle) {
      throw new Error(`Vehicle with VIN ${vin} not found.`);
    }

    await this.api.toggleClimate(vin, enable, temperature);
  }

  public async actionTargetSOC(vin: string, targetSOC: number): Promise<void> {
    const tokenCheck = await this.api.checkTokenValidity();
    if (!tokenCheck) {
      await this.login();
    }

    const vehicle = await this.getVehicle(vin);
    if (!vehicle) {
      throw new Error(`Vehicle with VIN ${vin} not found.`);
    }

    await this.api.setTargetSOC(vin, targetSOC);
  }

  public async actionToggleCharging(vin: string, enable: boolean): Promise<void> {
    const tokenCheck = await this.api.checkTokenValidity();
    if (!tokenCheck) {
      await this.login();
    }

    const vehicle = await this.getVehicle(vin);
    if (!vehicle) {
      throw new Error(`Vehicle with VIN ${vin} not found.`);
    }

    await this.api.toggleCharging(vin, enable);
  }
}

export default WeConnectClient;
