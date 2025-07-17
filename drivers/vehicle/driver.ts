'use strict';

import { Driver } from 'homey';
import { PairSession } from 'homey/lib/Driver';
import { Credentials } from '../../weconnectApi';

module.exports = class VehicleDriver extends Driver {
  async onInit(): Promise<void> {
    this.log('VehicleDriver has been initialized');
  }

  async onPair(session: PairSession): Promise<void> {
    session.setHandler('login', async (creds: Credentials) => {
      await (this.homey.app as any).weconnect.login(creds);
      return true;
    });

    session.setHandler('list_devices', async () => {
      const { vehicles } = (this.homey.app as any).weconnect;
      return vehicles.map((v: any) => ({ name: v.nickname || v.modelName || v.vin, data: { id: v.vin } }));
    });
  }
};
