import { EventEmitter } from 'events';
import { WeConnectApi, Credentials, Vehicle } from './weconnectApi';

class Log {
  error(...args: any[]): void { console.error(...args); }
  log(...args: any[]): void { console.log(...args); }
}



export class WeConnectClient {
  private log = new Log();
  private api = new WeConnectApi();
  private loggedIn = false;
  private emitter = new EventEmitter();

  async login(creds: Credentials): Promise<void> {
    await this.api.login(creds);
    this.loggedIn = true;
    await this.pollOnce();
  }

  get vehicles() {
    return this.cachedVehicles;
  }

  private cachedVehicles: Vehicle[] = [];

  setActiveVin(vin: string): void {
    // not needed in new api
  }

  startPolling(intervalMs = 60000): void {
    if (!this.loggedIn) {
      this.log.error('Cannot start polling: not logged in');
      return;
    }
    this.pollOnce().catch(err => this.log.error('Polling error', err));
    setInterval(() => {
      this.pollOnce().catch(err => this.log.error('Polling error', err));
    }, intervalMs);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.emitter.on(event, handler);
  }

  private async pollOnce(): Promise<void> {
    const vehicles = await this.api.getVehicles();
    this.cachedVehicles = vehicles;
    const active = vehicles[0];
    if (active && active.batteryLevel !== undefined) {
      this.emitter.emit('currentSOC', active.batteryLevel);
    }
  }
}
