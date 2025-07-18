'use strict';

import { Device } from 'homey';
import { WeConnectClient } from '../../weconnectClient';
import { EventEmitter } from 'events'


const mapChargingState = (state: string): string | null => {
  const cleanedState = state.toLowerCase().trim();
  switch (cleanedState) {
    case 'charging':
      return 'plugged_in_charging';
    case 'discharging':
      return 'plugged_in_discharging';
    case 'readyforcharging':
      return 'plugged_in_paused';
    case 'notreadyforcharging':
      return 'plugged_in';
    case 'conservation':
      return 'plugged_in_paused';
    case 'chargepurposereachedandnotconservationcharging':
      return 'plugged_in_paused';
    case 'chargepurposereachedandconservation':
      return 'plugged_in_paused';
    case 'off':
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
  private soc = 0;
  private client: WeConnectClient | undefined;
  private emitter = new EventEmitter();
  private poller : NodeJS.Timeout | undefined;
  private sentTargetReachedTrigger = true;
  private chargeTimeRemaining = 0;
  private lastSoC: number = 0;

  async onInit(): Promise<void> {
    this.client = (this.homey.app as any).weconnect;
    this.log('Vehicle device initialized');

    await this.pollVehicleState(false);
    this.lastSoC = await this.getCapabilityValue('measure_battery');
    if(this.lastSoC < parseFloat(await this.getCapabilityValue('ev_target_battery_level'))) {
      this.sentTargetReachedTrigger = false;
    }
    this.chargeTimeRemaining = await this.getCapabilityValue('ev_charging_time_remaining') || 0;

    this.poller = setInterval(this.pollVehicleState, 30000, true);
  }

  async onUninit(): Promise<void> {
    this.log('Vehicle device uninitialized');
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = undefined;
    }
  }

  private pollVehicleState = async (executeEvents: boolean): Promise<void> => {
    const vin = this.getData().id;
    const vehicle: any = await this.client?.getVehicle(vin);

    await this.setCapabilityValue('measure_battery', vehicle.batteryLevel);
    await this.setCapabilityValue('ev_charging_state', mapChargingState(vehicle.charging.chargingStatus));

    await this.setCapabilityValue('ev_charging_power', vehicle.charging.chargingPower);
    await this.setCapabilityValue('ev_charging_time_remaining', vehicle.charging.remainingTime);
    await this.setCapabilityValue('ev_target_battery_level', vehicle.charging.target.toString());

    await this.setCapabilityValue('target_temperature', vehicle.climate.target);
    await this.setCapabilityValue('ev_climate_active', vehicle.climate.climateState === 'on');
    await this.setCapabilityValue('ev_climate_time_remaining', vehicle.climate.remainingTime);

    await this.setCapabilityValue('ev_window_heating.front', vehicle.climate.windowHeatingState.front === 'on');
    await this.setCapabilityValue('ev_window_heating.rear', vehicle.climate.windowHeatingState.rear === 'on');

    await this.setCapabilityValue('ev_odometer', vehicle.stats.odometer);

    await this.setCapabilityValue('ev_battery_temp.min', parseFloat(vehicle.stats.temperatureBatteryStatus.min) - 273.15);
    await this.setCapabilityValue('ev_battery_temp.max', parseFloat(vehicle.stats.temperatureBatteryStatus.max) - 273.15);

    await this.setCapabilityValue('ev_next_inspection_days', vehicle.stats.nextInspection);


    if(vehicle.batteryLevel >= vehicle.charging.target && !this.sentTargetReachedTrigger) {
      this.sentTargetReachedTrigger = true;
      if (executeEvents) {
        this.homey.flow.getDeviceTriggerCard('soc_reached')
          .trigger(this, { level: vehicle.charging.target })
          .catch(this.error);
      }
    }
    if(this.chargeTimeRemaining !== vehicle.charging.remainingTime) {
      this.chargeTimeRemaining = vehicle.charging.remainingTime;
      if (executeEvents) {
        this.homey.flow.getDeviceTriggerCard('charging_countdown')
          .trigger(this, { timeRemaining: this.chargeTimeRemaining })
          .catch(this.error);
      }
    }

    if(this.lastSoC < vehicle.charging.target && this.sentTargetReachedTrigger) {
      this.sentTargetReachedTrigger = false;
    }
  }
};
