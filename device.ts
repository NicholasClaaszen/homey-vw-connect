'use strict';
import { Device } from 'homey';
import { WeConnectClient } from '../../weconnectClient';

module.exports = class VehicleDevice extends Device {
  private soc = 0;
  private client: WeConnectClient | undefined;

  async onInit(): Promise<void> {
    this.log('Vehicle device initialized');
    this.client = (this.homey.app as any).weconnect;
    const vin = this.getData().id;
    this.client?.setActiveVin(vin);
    this.client?.startPolling(60000); // poll every 60s
    this.client?.on('currentSOC', async (soc: number) => {
      const oldSoc = this.soc;
      this.soc = soc;
      await this.setCapabilityValue('measure_battery', this.soc);

      const changedTrigger = this.homey.flow.getDeviceTriggerCard('soc_changed');
      changedTrigger.trigger(this, { value: this.soc }).catch(this.error);

      const target = this.getSetting('target_soc') || 80;
      if (oldSoc < target && this.soc >= target) {
        const reachedTrigger = this.homey.flow.getDeviceTriggerCard('soc_reached');
        reachedTrigger.trigger(this, { level: target }).catch(this.error);
      }
    });
  }

  async onUninit(): Promise<void> {
    // no cleanup required
  }
};
