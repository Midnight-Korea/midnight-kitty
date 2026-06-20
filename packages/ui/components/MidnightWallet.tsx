/**
 * @file MidnightWallet.tsx
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

/* global console, window, fetch, navigator, setTimeout */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Logger } from 'pino';
import { type ImpureKittiesCircuits, contractConfig } from '@repo/kitties-api';
import {
  type ProofProvider,
  type PublicDataProvider,
  type UnboundTransaction,
} from '@midnight-ntwrk/midnight-js-types';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  Transaction,
  type FinalizedTransaction,
  type TransactionId,
} from '@midnight-ntwrk/ledger-v8';
import { fromHex, toHex } from '@midnight-ntwrk/compact-runtime';
import { useRuntimeConfiguration } from '../config/RuntimeConfiguration';
import { useLocalState } from '../hooks/useLocalState';
import type { ZKConfigProvider, WalletProvider, MidnightProvider } from '@midnight-ntwrk/midnight-js-types';
import { MidnightWalletErrorType, WalletWidget } from './WalletWidget';
import { connectToWallet } from '@repo/kitties-api/browser';
import { noopProofClient, proofClient } from '@repo/kitties-api/browser-api';
import { WrappedPublicDataProvider } from '@repo/kitties-api/browser';
import { WrappedPrivateStateProvider } from '@repo/kitties-api/browser';
import { CachedFetchZkConfigProvider } from '@repo/kitties-api/browser-api';
import type { WalletAPI } from '@repo/kitties-api';

/**
 * Fixed development password for the level-backed private state store. Must be at
 * least 16 characters (midnight-js 4.1.1 enforces a minimum). This only encrypts
 * the locally cached witness/private state in the browser - it is NOT a secret
 * protecting on-chain funds.
 */
const DEV_PRIVATE_STATE_PASSWORD = 'midnight-kitties-dev-password';

// Replace isChromeBrowser and window/fetch usages with safe checks for build/SSR
function isChromeBrowser(): boolean {
  if (typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes('chrome') && !userAgent.includes('edge') && !userAgent.includes('opr');
  }
  return false;
}

interface MidnightWalletState {
  isConnected: boolean;
  proofServerIsOnline: boolean;
  address?: string;
  widget?: React.ReactNode;
  walletAPI?: WalletAPI;
  privateStateProvider: any;
  zkConfigProvider: ZKConfigProvider<ImpureKittiesCircuits>;
  proofProvider: ProofProvider;
  publicDataProvider: PublicDataProvider;
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
  providers: any;
  shake: () => void;
  callback: (action: ProviderCallbackAction) => void;
}

export const getErrorType = (error: Error): MidnightWalletErrorType => {
  if (error.message.includes('Could not find Midnight Lace wallet')) {
    return MidnightWalletErrorType.WALLET_NOT_FOUND;
  }
  if (error.message.includes('Incompatible version of Midnight Lace wallet')) {
    return MidnightWalletErrorType.INCOMPATIBLE_API_VERSION;
  }
  if (error.message.includes('Wallet connector API has failed to respond')) {
    return MidnightWalletErrorType.TIMEOUT_API_RESPONSE;
  }
  if (error.message.includes('Could not find wallet connector API')) {
    return MidnightWalletErrorType.TIMEOUT_FINDING_API;
  }
  if (error.message.includes('Unable to enable connector API')) {
    return MidnightWalletErrorType.ENABLE_API_FAILED;
  }
  if (error.message.includes('Application is not authorized')) {
    return MidnightWalletErrorType.UNAUTHORIZED;
  }
  return MidnightWalletErrorType.UNKNOWN_ERROR;
};
const MidnightWalletContext = createContext<MidnightWalletState | null>(null);

export const useMidnightWallet = (): MidnightWalletState => {
  const walletState = useContext(MidnightWalletContext);
  if (!walletState) {
    throw new Error('MidnightWallet not loaded');
  }
  return walletState;
};

interface MidnightWalletProviderProps {
  children: React.ReactNode;
  logger: Logger;
}

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

export const MidnightWalletProvider: React.FC<MidnightWalletProviderProps> = ({ logger, children }) => {
  const [isConnecting, setIsConnecting] = React.useState<boolean>(false);
  const [walletError, setWalletError] = React.useState<MidnightWalletErrorType | undefined>(undefined);
  const [address, setAddress] = React.useState<string | undefined>(undefined);
  const [proofServerIsOnline, setProofServerIsOnline] = React.useState<boolean>(false);
  const config = useRuntimeConfiguration();
  const [isRotate, setRotate] = React.useState(false);
  const localState = useLocalState() as ReturnType<typeof useLocalState>;
  const [walletAPI, setWalletAPI] = useState<WalletAPI | undefined>(undefined);
  const [floatingOpen] = React.useState(true);

  const providerCallback: (action: ProviderCallbackAction) => void = (_action: ProviderCallbackAction): void => {
    // no-op
  };

  // Account id scopes the private state store to the connected wallet.
  const accountId = walletAPI?.coinPublicKey || 'kitties-default-account';

  const privateStateProvider = useMemo(
    () =>
      new WrappedPrivateStateProvider(
        levelPrivateStateProvider({
          privateStateStoreName: contractConfig.privateStateStoreName,
          privateStoragePasswordProvider: () => DEV_PRIVATE_STATE_PASSWORD,
          accountId,
        }),
        logger,
      ),
    [logger, accountId],
  );

  const zkConfigProvider = useMemo(
    () =>
      new CachedFetchZkConfigProvider<ImpureKittiesCircuits>(
        window.location.origin,
        fetch.bind(window),
        providerCallback,
      ),
    [],
  );
  const publicDataProvider = useMemo(
    () =>
      new WrappedPublicDataProvider(
        // Prefer the wallet-reported URIs, falling back to runtime config.
        indexerPublicDataProvider(
          walletAPI?.configuration.indexerUri ?? config.INDEXER_URI,
          walletAPI?.configuration.indexerWsUri ?? config.INDEXER_WS_URI,
        ),
        providerCallback,
        logger,
      ),
    [walletAPI],
  );

  function shake(): void {
    setRotate(true);
    setTimeout(() => {
      setRotate(false);
    }, 3000);
  }

  const proofProvider = useMemo<ProofProvider>(() => {
    const proverUri = walletAPI?.configuration.proverServerUri ?? config.PROOF_SERVER_URI;
    if (walletAPI && proverUri) {
      return proofClient<ImpureKittiesCircuits>(proverUri, zkConfigProvider);
    }
    return noopProofClient();
  }, [walletAPI, zkConfigProvider]);

  const walletProvider: WalletProvider = useMemo(() => {
    if (walletAPI) {
      const connected = walletAPI.connected;
      return {
        getCoinPublicKey: () => walletAPI.shielded.shieldedCoinPublicKey,
        getEncryptionPublicKey: () => walletAPI.shielded.shieldedEncryptionPublicKey,
        // zswap is gone: serialize the unbound tx, hand it to the wallet to
        // balance + pay fees, then deserialize the returned sealed transaction.
        async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
          providerCallback('balanceTxStarted');
          try {
            const serialized = toHex(tx.serialize());
            const received = await connected.balanceUnsealedTransaction(serialized);
            return Transaction.deserialize('signature', 'proof', 'binding', fromHex(received.tx));
          } finally {
            providerCallback('balanceTxDone');
          }
        },
      };
    }
    return {
      getCoinPublicKey: () => '',
      getEncryptionPublicKey: () => '',
      balanceTx(_tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
        return Promise.reject(new Error('readonly'));
      },
    };
  }, [walletAPI]);

  const midnightProvider: MidnightProvider = useMemo(() => {
    if (walletAPI) {
      const connected = walletAPI.connected;
      return {
        async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
          providerCallback('submitTxStarted');
          try {
            await connected.submitTransaction(toHex(tx.serialize()));
            return tx.identifiers()[0];
          } finally {
            providerCallback('submitTxDone');
          }
        },
      };
    }
    return {
      submitTx(_tx: FinalizedTransaction): Promise<TransactionId> {
        return Promise.reject(new Error('readonly'));
      },
    };
  }, [walletAPI]);

  const [walletState, setWalletState] = React.useState<MidnightWalletState>({
    isConnected: false,
    proofServerIsOnline: false,
    address: undefined,
    widget: undefined,
    walletAPI,
    privateStateProvider,
    zkConfigProvider,
    proofProvider,
    publicDataProvider,
    walletProvider,
    midnightProvider,
    shake,
    providers: {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    },
    callback: providerCallback,
  });

  async function checkProofServerStatus(proverServerUri?: string): Promise<void> {
    if (typeof fetch === 'undefined' || !proverServerUri) {
      setProofServerIsOnline(false);
      return;
    }
    try {
      const response = await fetch(proverServerUri);
      if (!response.ok) {
        setProofServerIsOnline(false);
      }
      const text = await response.text();
      setProofServerIsOnline(text.includes("We're alive 🎉!"));
    } catch (error) {
      setProofServerIsOnline(false);
    }
  }

  async function connect(_manual: boolean): Promise<void> {
    localState.setLaceAutoConnect(true);
    setIsConnecting(true);
    let connectedWallet: WalletAPI | undefined;
    try {
      connectedWallet = await connectToWallet(logger);
    } catch (e) {
      const walletError = getErrorType(e as Error);
      setWalletError(walletError);
      setIsConnecting(false);
    }
    if (!connectedWallet) {
      setIsConnecting(false);
      return;
    }
    await checkProofServerStatus(connectedWallet.configuration.proverServerUri ?? config.PROOF_SERVER_URI);
    try {
      setAddress(connectedWallet.shielded.shieldedAddress);
      console.log('Connected wallet shielded address:', connectedWallet.shielded.shieldedAddress);
      console.log('Wallet coin public key:', connectedWallet.shielded.shieldedCoinPublicKey);
      setWalletAPI(connectedWallet);
    } catch (e) {
      setWalletError(MidnightWalletErrorType.TIMEOUT_API_RESPONSE);
    }
    setIsConnecting(false);
  }

  useEffect(() => {
    setWalletState((state) => ({
      ...state,
      walletAPI,
      privateStateProvider,
      zkConfigProvider,
      proofProvider,
      publicDataProvider,
      walletProvider,
      midnightProvider,
      providers: {
        privateStateProvider,
        publicDataProvider,
        zkConfigProvider,
        proofProvider,
        walletProvider,
        midnightProvider,
      },
    }));
  }, [
    walletAPI,
    privateStateProvider,
    zkConfigProvider,
    proofProvider,
    publicDataProvider,
    walletProvider,
    midnightProvider,
  ]);

  useEffect(() => {
    setWalletState((state) => ({
      ...state,
      isConnected: !!address,
      proofServerIsOnline,
      address,
      widget: WalletWidget(
        () => connect(true), // manual connect
        isRotate,
        false, // openWallet - always false since dialog is disabled
        isChromeBrowser(),
        proofServerIsOnline,
        isConnecting,
        logger,
        floatingOpen,
        address,
        walletError,
      ),
      shake,
    }));
  }, [isConnecting, walletError, address, isRotate, proofServerIsOnline]);

  useEffect(() => {
    if (!walletState.isConnected && !isConnecting && !walletError && localState.isLaceAutoConnect()) {
      void connect(false); // auto connect
    }
  }, [walletState.isConnected, isConnecting]);

  return <MidnightWalletContext.Provider value={walletState}>{children}</MidnightWalletContext.Provider>;
};
