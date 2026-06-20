/**
 * @file mint-standalone.ts
 * @license GPL-3.0
 *
 * Non-interactive driver: spins up the local standalone chain (testcontainers),
 * builds the genesis-funded wallet, deploys the kitties contract, mints one kitty,
 * and prints the results. Mirrors the docker setup in standalone.ts and the
 * deploy/createKitty flow in cli.ts, but without the readline menu so it can run
 * unattended.
 */

import path from 'node:path';
import { DockerComposeEnvironment, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';
import {
  StandaloneConfig,
  buildWalletAndWaitForFunds,
  configureProviders,
} from '@repo/kitties-api/node-api';
import { setLogger, KittiesAPI, contractConfig, currentDir, createLogger } from '@repo/kitties-api';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const mapContainerPort = (env: StartedDockerComposeEnvironment, url: string, containerName: string): string => {
  const mappedUrl = new URL(url);
  const container = env.getContainer(containerName);
  mappedUrl.port = String(container.getFirstMappedPort());
  return mappedUrl.toString().replace(/\/+$/, '');
};

const jsonSafe = (obj: unknown): string =>
  JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

const config = new StandaloneConfig();
const dockerEnv = new DockerComposeEnvironment(path.resolve(currentDir, '..'), 'standalone.yml')
  .withWaitStrategy('kitties-proof-server', Wait.forListeningPorts().withStartupTimeout(240000))
  .withWaitStrategy('kitties-indexer', Wait.forListeningPorts().withStartupTimeout(240000));

const logger = await createLogger(config.logDir);
setLogger(logger);

console.log('=== STARTING STANDALONE CHAIN (docker) ===');
const env = await dockerEnv.up();
config.indexer = mapContainerPort(env, config.indexer, 'kitties-indexer');
config.indexerWS = mapContainerPort(env, config.indexerWS, 'kitties-indexer');
config.node = mapContainerPort(env, config.node, 'kitties-node');
config.proofServer = mapContainerPort(env, config.proofServer, 'kitties-proof-server');
console.log('=== CHAIN UP ===');
console.log(`indexer=${config.indexer}`);
console.log(`node=${config.node}`);
console.log(`proofServer=${config.proofServer}`);

let exitCode = 0;
let wallet: Awaited<ReturnType<typeof buildWalletAndWaitForFunds>> | null = null;
try {
  console.log('=== BUILDING GENESIS WALLET (waiting for funds) ===');
  wallet = await buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED, '');
  console.log('=== WALLET FUNDED ===');

  const providers = await configureProviders(
    wallet,
    config,
    new NodeZkConfigProvider(contractConfig.zkConfigPath),
  );

  console.log('=== DEPLOYING KITTIES CONTRACT ===');
  const api = await KittiesAPI.deploy(providers, { value: 0 } as any);
  const contractAddress = api.deployedContractAddress;
  console.log(`>>> CONTRACT_ADDRESS=${contractAddress}`);

  console.log('=== MINTING NEW KITTY (createKitty) ===');
  await api.createKitty();
  console.log('>>> KITTY_MINTED=ok');

  const total = await api.getAllKittiesCount();
  console.log(`>>> TOTAL_KITTIES=${total}`);

  try {
    const kitty = await api.getKitty(1n);
    console.log('>>> KITTY_1_DETAILS_BEGIN');
    console.log(jsonSafe(kitty));
    console.log('>>> KITTY_1_DETAILS_END');
  } catch (e) {
    console.log(`(could not fetch kitty #1: ${e instanceof Error ? e.message : String(e)})`);
  }

  console.log('=== DONE ===');
} catch (e) {
  exitCode = 1;
  console.error('=== FAILED ===');
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  try {
    if (wallet !== null) await wallet.close();
  } catch (e) {
    console.error(`wallet close error: ${e}`);
  }
  try {
    await env.down();
  } catch (e) {
    console.error(`docker down error: ${e}`);
  }
}

process.exit(exitCode);
