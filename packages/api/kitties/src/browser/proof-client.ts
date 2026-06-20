/**
 * @file proof-client.ts
 * @license GPL-3.0
 *
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

// Proof provider utilities for browser environment.
//
// midnight-js 4.1.1: the `ProofProvider` interface is no longer generic and
// `httpClientProofProvider` now REQUIRES a ZKConfigProvider as its second
// argument (proving is delegated to the proof server circuit-by-circuit using
// the prover/verifier keys + ZKIR resolved by the ZK config provider).
import type {
  ProofProvider,
  ProveTxConfig,
  UnboundTransaction,
  ZKConfigProvider,
} from '@midnight-ntwrk/midnight-js-types';
import type { UnprovenTransaction } from '@midnight-ntwrk/ledger-v8';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';

export const proofClient = <K extends string>(
  url: string,
  zkConfigProvider: ZKConfigProvider<K>,
): ProofProvider => {
  const httpClientProvider = httpClientProofProvider<K>(url.trim(), zkConfigProvider);
  return {
    proveTx(tx: UnprovenTransaction, proveTxConfig?: ProveTxConfig): Promise<UnboundTransaction> {
      return httpClientProvider.proveTx(tx, proveTxConfig);
    },
  };
};

export const noopProofClient = (): ProofProvider => {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async proveTx(_tx: UnprovenTransaction, _proveTxConfig?: ProveTxConfig): Promise<UnboundTransaction> {
      throw new Error('Proof client not implemented');
    },
  };
};
