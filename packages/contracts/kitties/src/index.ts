/**
 * @file index.ts
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

import * as ContractModule from "./managed/kitties/contract/index.js";
import type {
  Kitty,
  Ledger,
  Gender,
  Offer
} from "./managed/kitties/contract/index.js";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { witnesses as kittiesWitnesses } from "./witnesses.js";
import type { KittiesPrivateState as KittiesPrivateStateT } from "./witnesses.js";

export const pureCircuits = ContractModule.pureCircuits;
export * as Kitties from "./managed/kitties/contract/index.js";

/**
 * The compiled contract object midnight-js 4.x expects in
 * `deployContract`/`findDeployedContract` ({ compiledContract }). It wraps the
 * generated `Contract` constructor with the off-chain witnesses and the path to
 * the compiled ZK assets (keys/zkir under ./managed/kitties). Mirrors the
 * official example-bboard `CompiledContract.make(...).pipe(...)` pattern.
 */
export const CompiledKittiesContract = CompiledContract.make<
  ContractModule.Contract<KittiesPrivateStateT>
>("Kitties", ContractModule.Contract as never).pipe(
  CompiledContract.withWitnesses(kittiesWitnesses),
  CompiledContract.withCompiledFileAssets("./managed/kitties"),
);

export * from "./witnesses.js";
export type { KittiesPrivateState } from "./witnesses.js";
export { witnesses } from "./witnesses.js";
export { createKittiesPrivateState } from "./witnesses.js";
// Re-export the types explicitly
export type { Ledger, Kitty, Gender, Offer };
