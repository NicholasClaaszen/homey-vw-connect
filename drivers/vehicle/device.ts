'use strict';

import { Device } from 'homey';
import WeConnectClient from '../../weconnectClient';

const mapChargingState = (state: string): string | null => {
  const cleanedState = state.toLowerCase().trim();
  switch (cleanedState) {
    case 'charging':
      return 'plugged_in_charging';
    case 'discharging':
      return 'plugged_in_discharging';
    case 'notreadyforcharging':
      return 'plugged_in';
    case 'readyforcharging':
    case 'conservation':
    case 'chargepurposereachedandnotconservationcharging':
    case 'chargepurposereachedandconservation':
      return 'plugged_in_paused';
    case 'off':
    case 'disconnected':
      return 'plugged_out';
    case 'error':
    case 'unsupported':
    case 'unknown':
      // No direct match - handle as null or fallback
      return null;
    default:
      return null;
  }
};

module.exports = class VehicleDevice extends Device {
  private client: WeConnectClient | undefined;
  private poller : NodeJS.Timeout | undefined;
  private sentTargetReachedTrigger = true;
  private chargeTimeRemaining = 0;
  private lastSoC: number = 0;
  private lastChargingState: string | null = null;

  async onInit(): Promise<void> {
    this.client = (this.homey.app as any).weconnect;
    this.log('Vehicle device initialized');

    await this.pollVehicleState(false);
    this.lastSoC = await this.getCapabilityValue('measure_battery');
    this.chargeTimeRemaining = await this.getCapabilityValue('ev_charging_time_remaining') || 0;
    if (this.lastSoC < parseFloat(await this.getCapabilityValue('ev_target_battery_level'))) {
      this.sentTargetReachedTrigger = false;
    }

    /* Capability Listeners */
    this.registerCapabilityListener('target_temperature', async (value) => {
      const climateState = await this.getCapabilityValue('ev_climate_active');
      await this.actionClimate(climateState, value);
    });
    this.registerCapabilityListener('ev_climate_active', async (value) => {
      const temp = await this.getCapabilityValue('target_temperature');
      await this.actionClimate(value, temp);
    });
    this.registerCapabilityListener('ev_target_battery_level', async (value) => {
      await this.actionTargetSOC(value);
    });

    /* Action Cards */
    this.homey.flow.getActionCard('activate_climate').registerRunListener(async (args, state) => {
      const temp = await this.getCapabilityValue('target_temperature');
      await this.actionClimate(true, temp);
    });
    this.homey.flow.getActionCard('deactivate_climate').registerRunListener(async (args, state) => {
      const temp = await this.getCapabilityValue('target_temperature');
      await this.actionClimate(false, temp);
    });
    this.homey.flow.getActionCard('set_target_soc').registerRunListener(async (args, state) => {
      await this.actionTargetSOC(args.level);
    });
    this.homey.flow.getActionCard('start_charging').registerRunListener(async (args, state) => {
      await this.actionToggleCharging(true);
    });
    this.homey.flow.getActionCard('stop_charging').registerRunListener(async (args, state) => {
      await this.actionToggleCharging(false);
    });

    this.poller = this.homey.setInterval(this.pollVehicleState, 30000, true);
  }

  async onUninit(): Promise<void> {
    this.log('Vehicle device uninitialized');
    if (this.poller) {
      clearInterval(this.poller);
      this.homey.clearInterval(this.poller);
    }
  }

  async actionClimate(enable?: boolean, temperature?: number): Promise<void> {
    if (enable === undefined) {
      enable = await this.getCapabilityValue('ev_climate_active');
    }
    if (temperature === undefined) {
      temperature = await this.getCapabilityValue('target_temperature');
    }
    const vin = this.getData().id;
    await this.client?.actionClimate(vin, enable || false, temperature || 18);
  }

  async actionTargetSOC(target: string): Promise<void> {
    const vin = this.getData().id;
    const numTarget = parseInt(target, 10);
    if (numTarget < 50 || numTarget > 100) {
      throw new Error('Target SOC must be between 50 and 100');
    }
    await this.client?.actionTargetSOC(vin, numTarget);
  }

  async actionToggleCharging(enable: boolean): Promise<void> {
    const vin = this.getData().id;
    await this.client?.actionToggleCharging(vin, enable);
  }

  private pollVehicleState = async (executeEvents: boolean): Promise<void> => {
    const vin = this.getData().id;
    const vehicle: any = await this.client?.getVehicle(vin);
    const mappedChargingState = mapChargingState(vehicle.charging.chargingStatus);

    await this.setCapabilityValue('measure_battery', vehicle.batteryLevel);
    await this.setCapabilityValue('ev_charging_state', mappedChargingState);

    await this.setCapabilityValue('ev_charging_power', vehicle.charging.chargingPower);
    await this.setCapabilityValue('ev_charging_time_remaining', vehicle.charging.remainingTime || 0);
    await this.setCapabilityValue('ev_target_battery_level', vehicle.charging.target.toString());

    await this.setCapabilityValue('target_temperature', vehicle.climate.target);
    await this.setCapabilityValue('ev_climate_active', vehicle.climate.climateState !== 'off');
    await this.setCapabilityValue('ev_climate_time_remaining', vehicle.climate.remainingTime);

    await this.setCapabilityValue('ev_window_heating.front', vehicle.climate.windowHeatingState.front === 'on');
    await this.setCapabilityValue('ev_window_heating.rear', vehicle.climate.windowHeatingState.rear === 'on');

    await this.setCapabilityValue('ev_odometer', vehicle.stats.odometer);

    await this.setCapabilityValue('ev_battery_temp.min', parseFloat(vehicle.stats.temperatureBatteryStatus.min) - 273.15);
    await this.setCapabilityValue('ev_battery_temp.max', parseFloat(vehicle.stats.temperatureBatteryStatus.max) - 273.15);

    await this.setCapabilityValue('ev_next_inspection_days', vehicle.stats.nextInspection);

    if (vehicle.batteryLevel >= vehicle.charging.target && !this.sentTargetReachedTrigger) {
      this.sentTargetReachedTrigger = true;
      if (executeEvents) {
        this.homey.flow.getDeviceTriggerCard('soc_reached')
          .trigger(this, { level: vehicle.charging.target })
          .catch(this.error);
      }
    }
    if (this.chargeTimeRemaining !== vehicle.charging.remainingTime) {
      this.chargeTimeRemaining = vehicle.charging.remainingTime || 0;
      if (executeEvents) {
        this.homey.flow.getDeviceTriggerCard('charging_countdown')
          .trigger(this, { timeRemaining: this.chargeTimeRemaining })
          .catch(this.error);
      }
    }
    if (this.lastSoC < vehicle.charging.target && this.sentTargetReachedTrigger) {
      this.sentTargetReachedTrigger = false;
    }
    if( this.lastChargingState !== mappedChargingState) {
      this.lastChargingState = mappedChargingState;
      if (executeEvents) {
        this.homey.flow.getDeviceTriggerCard('charging_state_changed')
          .trigger(this, { state: mappedChargingState })
          .catch(this.error);
      }
    }
  }
};
