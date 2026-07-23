// abi.ts

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const EntryPointArtifact = require("@account-abstraction/contracts/artifacts/EntryPoint.json");

const EntryPointSimulationsArtifact = require("@account-abstraction/contracts/artifacts/EntryPointSimulations.json");

export const entryPointAbi = EntryPointArtifact.abi;

export const entryPointSimulationsAbi = EntryPointSimulationsArtifact.abi;

export const EntryPointSimulationsCode = EntryPointSimulationsArtifact.deployedBytecode;
