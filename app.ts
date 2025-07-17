'use strict';

import Homey from 'homey';
import { WeConnectClient } from './weconnectClient';

module.exports = class MyApp extends Homey.App {
  public weconnect: WeConnectClient = new WeConnectClient();

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');
  }

};
