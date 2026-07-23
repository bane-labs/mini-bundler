/**
 * eth_estimateUserOperationGas — real gas estimation via simulation.
 *
 * Uses simulateValidation + simulateHandleOp to estimate actual gas.
 * Returns preVerificationGas, verificationGasLimit, callGasLimit.
 */

import { encodeFunctionData, decodeFunctionResult, type Hex } from "viem";
import { publicClient } from "../clients.js";
import { config } from "../config.js";
import { entryPointSimulationsAbi, EntryPointSimulationsCode, entryPointAbi } from "../abi.js";
import type { UserOperation } from "../types.js";
import { metrics } from "../metrics/index.js";
import { logger } from "../logging/index.js";

function extractRevertData(error: unknown): Hex | undefined {
    let e = error as Record<string, unknown> | undefined;
    for (let i = 0; i < 10 && e; i++) {
        const data = e.data;
        if (typeof data === "string" && data.startsWith("0x")) return data as Hex;
        if (typeof (data as Record<string, unknown>)?.data === "string")
            return (data as Record<string, unknown>).data as Hex;
        e = e.cause as Record<string, unknown> | undefined;
    }
    return undefined;
}

export async function estimateUserOperationGas(userOp: UserOperation): Promise<{
    preVerificationGas: `0x${string}`;
    verificationGasLimit: `0x${string}`;
    callGasLimit: `0x${string}`;
}> {
    const start = Date.now();

    // 1. simulateValidation — get verification gas info
    const validationData = encodeFunctionData({
        abi: entryPointSimulationsAbi,
        functionName: "simulateValidation",
        args: [userOp],
    });

    let verificationGasLimit = 300_000n;

    try {
        await publicClient.call({
            to: config.entryPoint,
            data: validationData,
            stateOverride: [
                {
                    address: config.entryPoint,
                    code: EntryPointSimulationsCode,
                },
            ],
        });
    } catch (error: unknown) {
        const revertData = extractRevertData(error);
        if (revertData) {
            try {
                const decoded = decodeFunctionResult({
                    abi: entryPointSimulationsAbi,
                    functionName: "simulateValidation",
                    data: revertData,
                }) as unknown as { result?: unknown };
                const validationResult = decoded.result as unknown[] | undefined;
                if (validationResult) {
                    verificationGasLimit = BigInt((validationResult[1] as bigint) ?? 300_000);
                }
            } catch {
                // simulation reverted with unknown data, use default
            }
        }
    }

    // 2. simulateHandleOp — get call gas info
    const handleOpData = encodeFunctionData({
        abi: entryPointSimulationsAbi,
        functionName: "simulateHandleOp",
        args: [userOp, config.entryPoint, "0x"],
    });

    let callGasLimit = 500_000n;

    try {
        await publicClient.call({
            to: config.entryPoint,
            data: handleOpData,
            stateOverride: [
                {
                    address: config.entryPoint,
                    code: EntryPointSimulationsCode,
                },
            ],
        });
    } catch (error: unknown) {
        const revertData = extractRevertData(error);
        if (revertData) {
            try {
                const decoded = decodeFunctionResult({
                    abi: entryPointSimulationsAbi,
                    functionName: "simulateHandleOp",
                    data: revertData,
                }) as unknown as { result?: unknown };
                const executionResult = decoded.result as unknown[] | undefined;
                if (executionResult) {
                    callGasLimit = BigInt((executionResult[0] as bigint) ?? 500_000);
                }
            } catch {
                // use defaults
            }
        }
    }

    // 3. preVerificationGas — estimate calldata cost + overhead
    const preVerificationGas = estimatePreVerificationGas(userOp);

    const elapsed = Date.now() - start;
    metrics.recordSimulationLatency(elapsed);
    logger.info(
        `Gas estimate: verification=${verificationGasLimit}, call=${callGasLimit}, preVerify=${preVerificationGas} (${elapsed}ms)`,
    );

    return {
        preVerificationGas: ("0x" + preVerificationGas.toString(16)) as `0x${string}`,
        verificationGasLimit: ("0x" + verificationGasLimit.toString(16)) as `0x${string}`,
        callGasLimit: ("0x" + callGasLimit.toString(16)) as `0x${string}`,
    };
}

function estimatePreVerificationGas(userOp: UserOperation): bigint {
    const zeroGas = 4n;
    const perWordGas = 16n;

    const callDataCost = calcCalldataCost(userOp.callData);
    const initCodeCost = calcCalldataCost(userOp.initCode);
    const paymasterCost = calcCalldataCost(userOp.paymasterAndData);
    const sigCost = calcCalldataCost(userOp.signature);

    const base = 21_000n;
    const overhead = 100_000n;

    return base + overhead + callDataCost + initCodeCost + paymasterCost + sigCost;
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
