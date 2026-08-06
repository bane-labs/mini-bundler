import type { Hex } from "viem";

import { walletClient, account } from "./clients.js";
import { config } from "./config.js";
import { entryPointAbi } from "./abi.js";
import type { UserOperation } from "./types.js";
import { HANDLE_OPS_TIMEOUT_MS, DEFAULT_AGGREGATOR_VALIDATION_GAS } from "./constants.js";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
}

/**
 * Submit UserOperations to the EntryPoint via handleOps.
 *
 * Returns the transaction hash of the submitted bundle.
 */
export async function handleOps(ops: UserOperation[]): Promise<`0x${string}`> {
    const hash = await withTimeout(
        walletClient.writeContract({
            address: config.entryPoint,
            abi: entryPointAbi,
            functionName: "handleOps",
            args: [ops, account.address],
        }),
        HANDLE_OPS_TIMEOUT_MS,
        "handleOps",
    );

    return hash;
}

/**
 * Submit aggregated UserOperations via handleAggregatedOps.
 *
 * Used for signature aggregation workflows where multiple UserOperations
 * share a single aggregated signature.
 */
export async function handleAggregatedOps(
    ops: UserOperation[],
    aggregator: `0x${string}`,
    aggregatorSignature: Hex,
): Promise<`0x${string}`> {
    const hash = await withTimeout(
        walletClient.writeContract({
            address: config.entryPoint,
            abi: entryPointAbi,
            functionName: "handleAggregatedOps",
            args: [
                [
                    {
                        aggregator,
                        validationGasLimit: DEFAULT_AGGREGATOR_VALIDATION_GAS,
                        validationData: "0x",
                        signature: aggregatorSignature,
                        userOps: ops,
                    },
                ],
                account.address,
            ],
        }),
        HANDLE_OPS_TIMEOUT_MS,
        "handleAggregatedOps",
    );

    return hash;
}
