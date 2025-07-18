'use strict';

import Homey from 'homey';
import WeConnectClient from './weconnectClient';

module.exports = class MyApp extends Homey.App {
  public weconnect: WeConnectClient = new WeConnectClient();

  async onInit() {
    const savedUsername = await this.homey.settings.get('vwUsername');
    const savedPassword = await this.homey.settings.get('vwPassword');
    if (savedUsername && savedPassword) {
      this.log('Restoring credentials from settings');
      this.weconnect.setCredentials(savedUsername, savedPassword);
    } else {
      this.log('No credentials found in settings');
    }
    this.log('VW app has been initialized');
  }
};
