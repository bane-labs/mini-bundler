import { encodeFunctionData, type Hex } from "viem";

import { publicClient, account } from "../clients.js";
import { config } from "../config.js";
import { entryPointSimulationsAbi, EntryPointSimulationsCode } from "../abi.js";
import type { UserOperation } from "../types.js";
import { metrics } from "../metrics/index.js";
import { logger } from "../logging/index.js";

/**
 * eth_estimateUserOperationGas — real gas estimation via EntryPoint simulation.
 *
 * Runs simulateValidation and simulateHandleOp (with the simulations bytecode
 * state override) and measures the actual gas consumed, instead of returning
 * hardcoded defaults. A safety buffer is added on top so the returned limits
 * comfortably cover the real execution.
 */
const GAS_BUFFER_PERCENT = 10n;
const BUFFER_DENOM = 100n;
const MIN_VERIFICATION_GAS = 100_000n;
const MIN_CALL_GAS = 100_000n;

/** Estimate gas for simulateValidation/simulateHandleOp against the
 * EntryPoint simulations bytecode, with a map-shaped stateOverride.
 *
 * NeoX RPC only applies a MAP stateOverride (indexed by address); viem's
 * array format is silently ignored. For an EIP-7702 op whose sender is a
 * fresh EOA, we also inject the delegation designator so the simulated
 * call has code at the sender address.
 */
async function estimateSimulationGas(data: Hex, userOp: UserOperation): Promise<bigint> {
    const mapOverride: Record<string, { code: Hex }> = {
        [config.entryPoint.toLowerCase()]: { code: EntryPointSimulationsCode },
    };
    const auth = userOp.eip7702Auth;
    if (auth) {
        mapOverride[userOp.sender.toLowerCase()] = {
            code: `0xef0100${auth.address.slice(2)}` as Hex,
        };
    }
    const result = await publicClient.request({
        method: "eth_estimateGas",
        params: [{ from: account.address, to: config.entryPoint, data }, "latest", mapOverride],
    });
    return BigInt(result as string);
}

export async function estimateUserOperationGas(userOp: UserOperation): Promise<{
    preVerificationGas: `0x${string}`;
    verificationGasLimit: `0x${string}`;
    paymasterVerificationGasLimit?: `0x${string}`;
    callGasLimit: `0x${string}`;
}> {
    const start = Date.now();

    // 1. simulateValidation — measures the account/paymaster validation gas.
    const validationData = encodeFunctionData({
        abi: entryPointSimulationsAbi,
        functionName: "simulateValidation",
        args: [userOp],
    });

    let verificationGasLimit = 300_000n;
    let validationGasUsed = 0n;

    try {
        validationGasUsed = await estimateSimulationGas(validationData, userOp);
    } catch (error: unknown) {
        logger.warn(`Gas estimate: simulateValidation failed: ${error instanceof Error ? error.message : "unknown"}`);
    }

    if (validationGasUsed > 0n) {
        verificationGasLimit = (validationGasUsed * (BUFFER_DENOM + GAS_BUFFER_PERCENT)) / BUFFER_DENOM;
    }

    // 2. simulateHandleOp — measures validation + execution together.
    const handleOpData = encodeFunctionData({
        abi: entryPointSimulationsAbi,
        functionName: "simulateHandleOp",
        args: [userOp, config.entryPoint, "0x"],
    });

    let callGasLimit = 500_000n;
    let handleOpGasUsed = 0n;

    try {
        handleOpGasUsed = await estimateSimulationGas(handleOpData, userOp);
    } catch (error: unknown) {
        logger.warn(`Gas estimate: simulateHandleOp failed: ${error instanceof Error ? error.message : "unknown"}`);
    }

    if (handleOpGasUsed > 0n) {
        // The call (execution) gas is the handleOp gas minus the validation gas.
        const callGasUsed = handleOpGasUsed > validationGasUsed ? handleOpGasUsed - validationGasUsed : 0n;
        callGasLimit = (callGasUsed * (BUFFER_DENOM + GAS_BUFFER_PERCENT)) / BUFFER_DENOM;
    }

    // Enforce safe minimums so a tiny estimate can never starve the bundle.
    if (verificationGasLimit < MIN_VERIFICATION_GAS) verificationGasLimit = MIN_VERIFICATION_GAS;
    if (callGasLimit < MIN_CALL_GAS) callGasLimit = MIN_CALL_GAS;

    // 3. preVerificationGas — estimate calldata cost + overhead.
    const preVerificationGas = estimatePreVerificationGas(userOp);

    const elapsed = Date.now() - start;
    metrics.recordSimulationLatency(elapsed);
    logger.info(
        `Gas estimate: verification=${verificationGasLimit} (valUsed=${validationGasUsed}), call=${callGasLimit} (handleUsed=${handleOpGasUsed}), preVerify=${preVerificationGas} (${elapsed}ms)`,
    );

    const hasPaymaster = userOp.paymasterAndData !== "0x";

    return {
        preVerificationGas: ("0x" + preVerificationGas.toString(16)) as `0x${string}`,
        verificationGasLimit: ("0x" + verificationGasLimit.toString(16)) as `0x${string}`,
        ...(hasPaymaster
            ? { paymasterVerificationGasLimit: ("0x" + verificationGasLimit.toString(16)) as `0x${string}` }
            : {}),
        callGasLimit: ("0x" + callGasLimit.toString(16)) as `0x${string}`,
    };
}

function estimatePreVerificationGas(userOp: UserOperation): bigint {
    const callDataCost = calcCalldataCost(userOp.callData);
    const initCodeCost = calcCalldataCost(userOp.initCode);
    const paymasterCost = calcCalldataCost(userOp.paymasterAndData);
    const sigCost = calcCalldataCost(userOp.signature);

    const base = 21_000n;
    const overhead = 100_000n;

    // A fresh EOA upgraded via EIP-7702 costs an extra 50,000 gas to set its
    // code (GAS_AUTHORIZATION / PER_EMPTY_ACCOUNT_COST). The caller must cover
    // this via preVerificationGas, otherwise the handleOps tx will run out of
    // gas when upgrading the sender.
    const authCost = userOp.eip7702Auth ? 50_000n : 0n;

    return base + overhead + callDataCost + initCodeCost + paymasterCost + sigCost + authCost;
}

function calcCalldataCost(data: `0x${string}`): bigint {
    const zeroGas = 4n;
    const nonZeroGas = 16n;
    const hex = data.slice(2);
    let cost = 0n;
    for (let i = 0; i < hex.length; i += 2) {
        const byte = parseInt(hex.slice(i, i + 2), 16);
        cost += byte === 0 ? zeroGas : nonZeroGas;
    }
    return cost;
}
