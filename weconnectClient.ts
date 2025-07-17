import { VwWeConnect, Log, idStatusEmitter } from 'npm-vwconnectidapi';

export interface Credentials {
  username: string;
  password: string;
}

export class WeConnectClient {
  private log = new Log();
  private conn = new VwWeConnect();
  private loggedIn = false;

  async login(creds: Credentials): Promise<void> {
    this.conn.setLogLevel('ERROR');
    this.conn.setCredentials(creds.username, creds.password);
    await this.conn.getData();
    this.loggedIn = true;
  }

  get vehicles() {
    return this.conn.vehicles?.data || [];
  }

  setActiveVin(vin: string): void {
    this.conn.setActiveVin(vin);
  }

  startPolling(intervalMs = 60000): void {
    if (!this.loggedIn) {
      this.log.error('Cannot start polling: not logged in');
      return;
    }

    // initial fetch
    this.conn.getData().catch((err: any) => this.log.error('Polling error', err));

    // repeat
    setInterval(() => {
      this.conn.getData().catch((err: any) => this.log.error('Polling error', err));
    }, intervalMs);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    idStatusEmitter.on(event, handler);
  }
}
