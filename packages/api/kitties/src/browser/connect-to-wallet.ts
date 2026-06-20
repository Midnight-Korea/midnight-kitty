/**
 * @file connect-to-wallet.ts
 * @license GPL-3.0
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * DISCLAIMER: This software is provided "as is" without any warranty.
 * Use at your own risk. The author assumes no responsibility for any
 * damages or losses arising from the use of this software.
 */

/* global console, globalThis */
import type { Logger } from 'pino';
import type { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import semver from 'semver';
import type { ShieldedAddresses, WalletAPI } from './types.js';

/**
 * The network id hint passed to the Lace connector. The preprod stack uses 'preprod'.
 */
export const PREPROD_NETWORK_ID = 'preprod';

/**
 * The dapp-connector-api version range this app is built against (4.x).
 */
const COMPATIBLE_CONNECTOR_API_VERSION = '4.x';

/**
 * `window.midnight` is a record of injected connectors, keyed by a discovery key
 * (e.g. a UUID). Each value is an {@link InitialAPI}. We find the first one that
 * exposes a compatible `apiVersion`.
 */
function findInitialAPI(): InitialAPI | undefined {
  if (typeof globalThis === 'undefined' || typeof (globalThis as any).window === 'undefined') {
    return undefined;
  }
  const midnight = (globalThis as any).window.midnight as Record<string, unknown> | undefined;
  if (!midnight) {
    return undefined;
  }
  return Object.values(midnight).find(
    (w): w is InitialAPI =>
      !!w &&
      typeof w === 'object' &&
      'apiVersion' in (w as Record<string, unknown>) &&
      typeof (w as InitialAPI).apiVersion === 'string' &&
      typeof (w as InitialAPI).connect === 'function' &&
      semver.satisfies((w as InitialAPI).apiVersion, COMPATIBLE_CONNECTOR_API_VERSION),
  );
}

/**
 * Poll `window.midnight` until a compatible connector appears (or we time out).
 */
async function waitForInitialAPI(logger: Logger, timeoutMs = 5_000, intervalMs = 100): Promise<InitialAPI> {
  const start = Date.now();
  for (;;) {
    const api = findInitialAPI();
    if (api) {
      logger.info({ rdns: api.rdns, name: api.name, apiVersion: api.apiVersion }, 'Compatible wallet connector found');
      return api;
    }
    if (Date.now() - start > timeoutMs) {
      logger.error('Could not find wallet connector API');
      throw new Error('Could not find Midnight Lace wallet. Extension installed and on the preprod network?');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Connect to the Lace DApp connector on the 'preprod' network and gather the
 * information the dApp needs to build providers.
 */
export const connectToWallet = async (logger: Logger): Promise<WalletAPI> => {
  const initialAPI = await waitForInitialAPI(logger);

  let connected: ConnectedAPI;
  try {
    connected = await initialAPI.connect(PREPROD_NETWORK_ID);
  } catch (e) {
    logger.error(e, 'Unable to connect to wallet connector API');
    throw new Error('Application is not authorized');
  }

  const status = await connected.getConnectionStatus();
  if (status.status !== 'connected') {
    logger.error({ status }, 'Wallet reported disconnected status after connect');
    throw new Error('Midnight Lace wallet is not connected.');
  }
  logger.info({ networkId: status.networkId }, 'Connected to wallet');

  const shielded: ShieldedAddresses = await connected.getShieldedAddresses();
  const configuration = await connected.getConfiguration();
  logger.info(
    { indexerUri: configuration.indexerUri, networkId: configuration.networkId },
    'Retrieved wallet service configuration',
  );

  return {
    connected,
    shielded,
    configuration,
    coinPublicKey: shielded.shieldedCoinPublicKey,
  };
};
