/**
 * @file types.ts
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
 */

import type { ConnectedAPI, Configuration } from '@midnight-ntwrk/dapp-connector-api';

export type ProviderCallbackAction =
  | 'downloadProverStarted'
  | 'downloadProverDone'
  | 'proveTxStarted'
  | 'proveTxDone'
  | 'balanceTxStarted'
  | 'balanceTxDone'
  | 'submitTxStarted'
  | 'submitTxDone'
  | 'watchForTxDataStarted'
  | 'watchForTxDataDone';

/**
 * Shielded address material returned by the Lace DApp connector (dapp-connector-api 4.x).
 * All values are bech32m strings.
 */
export interface ShieldedAddresses {
  shieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
}

/**
 * Everything the app needs after a successful `connect('preprod')` against Lace.
 * Replaces the old DAppConnectorWalletAPI + ServiceUriConfig shape (removed in 4.0.1).
 */
export interface WalletAPI {
  /** The connected DApp connector API instance (post `connect`). */
  connected: ConnectedAPI;
  /** Shielded addresses / public keys (bech32m). */
  shielded: ShieldedAddresses;
  /** Service URIs reported by the wallet. */
  configuration: Configuration;
  /** Convenience accessor: the shielded coin public key (bech32m). */
  coinPublicKey: string;
}
