/**
 * @file api.ts
 * @author Ricardo Rius
 * @license GPL-3.0
 *
 * Copyright (C) 2025 Ricardo Rius
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

// Browser-only API for Midnight Kitties App
// This file contains browser-specific provider setup for the Kitties App

import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import {
  PublicDataProvider,
  WalletProvider,
  MidnightProvider,
  PrivateStateProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { proofClient, noopProofClient } from './proof-client.js';
import { CachedFetchZkConfigProvider } from './zk-config-provider.js';
import { KittiesPrivateState } from '@midnight-ntwrk/kitties-contract';
import { ImpureKittiesCircuits, KittiesProviders } from '../common/types.js';
import { contractConfig } from '../common/config.js';
import { WalletAPI, ProviderCallbackAction } from './types.js';

export { proofClient, noopProofClient } from './proof-client.js';
export { CachedFetchZkConfigProvider } from './zk-config-provider.js';

/**
 * Fixed development password for the in-browser level-backed private state store.
 * midnight-js 4.1.1's `levelPrivateStateProvider` requires a password of at least
 * 16 characters. This is NOT a secret protecting on-chain funds - it only encrypts
 * the locally-cached witness/private state in the browser's IndexedDB.
 */
// Must satisfy the level provider's strength policy: >=16 chars AND >=3 of
// {uppercase, lowercase, digits, special}. This one has all 4.
export const DEV_PRIVATE_STATE_PASSWORD = 'Midnight-Kitties-Dev-2026';

/**
 * Build the full set of providers used by the Kitties dApp.
 *
 * @param publicDataProvider Indexer-backed public data provider (already wrapped).
 * @param walletProvider     Lace-backed wallet provider (balanceTx + public keys).
 * @param midnightProvider   Lace-backed submit provider.
 * @param walletAPI          Connected wallet info; its shielded coin public key is
 *                           used to scope (account-id) the private state store.
 * @param callback           UI progress callback.
 */
export const createKittiesProviders = (
  publicDataProvider: PublicDataProvider,
  walletProvider: WalletProvider,
  midnightProvider: MidnightProvider,
  walletAPI: WalletAPI,
  callback: (action: ProviderCallbackAction) => void,
): KittiesProviders => {
  const zkConfigProvider = new CachedFetchZkConfigProvider<ImpureKittiesCircuits>(
    window.location.origin,
    fetch.bind(window),
    callback,
  );

  const privateStateProvider: PrivateStateProvider<'kittiesPrivateState', KittiesPrivateState> =
    levelPrivateStateProvider({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => DEV_PRIVATE_STATE_PASSWORD,
      // Scope the store per connected wallet (account). Falls back to a fixed id
      // if no coin public key is available.
      accountId: walletAPI.coinPublicKey || 'kitties-default-account',
    });

  // Proving is delegated to the wallet-configured proof server, using the ZK
  // config provider to resolve prover/verifier keys + ZKIR.
  const proofProvider = walletAPI.configuration.proverServerUri
    ? proofClient<ImpureKittiesCircuits>(walletAPI.configuration.proverServerUri, zkConfigProvider)
    : noopProofClient();

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
};
