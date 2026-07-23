/**
 * Gas Manager — dynamic gas pricing based on latest block.
 *
 * Computes maxFeePerGas / maxPriorityFeePerGas, supports gas bump
 * for replacement transactions, and monitors pending tx timeouts.
 */

import { publicClient } from "../clients.js";
import { logger } from "../logging/index.js";
import type { GasConfig, GasEstimate } from "../types.js";
import { BASE_FEE_CACHE_TTL_MS, FALLBACK_BASE_FEE } from "../constants.js";

const DEFAULT_GAS_CONFIG: GasConfig = {
    maxFeePerGasCap: BigInt("50000000000"), // 50 gwei
    maxPriorityFeePerGasCap: BigInt("3000000000"), // 3 gwei
    gasBumpPercent: 20,
    replacementThresholdMs: 30_000,
    pendingTxTimeoutMs: 120_000,
};

// Cached baseFee to avoid excessive RPC calls
let cachedBaseFee: bigint | null = null;
let baseFeeCacheTime = 0;

/**
 * Get the latest baseFee from the network, with caching.
 *
 * Returns a cached value if the cache is still valid (~1 block).
 * Falls back to 10 gwei if the RPC call fails.
 */
export async function getLatestBaseFee(): Promise<bigint> {
    const now = Date.now();
    if (cachedBaseFee !== null && now - baseFeeCacheTime < BASE_FEE_CACHE_TTL_MS) {
        return cachedBaseFee;
    }

    try {
        const block = await publicClient.getBlock({ blockTag: "latest" });
        const baseFee = block.baseFeePerGas ?? 0n;
        cachedBaseFee = baseFee;
        baseFeeCacheTime = now;
        logger.debug(`Base fee updated: ${baseFee}`);
        return baseFee;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to fetch base fee: ${message}`);
        return cachedBaseFee ?? FALLBACK_BASE_FEE;
    }
}

/**
 * Estimate gas fees for the next transaction.
 *
 * Returns dynamic maxFeePerGas and maxPriorityFeePerGas based on
 * the latest block's baseFee, capped at configured maximums.
 */
export async function estimateGasFees(overrides?: Partial<GasConfig>): Promise<GasEstimate> {
    const cfg = { ...DEFAULT_GAS_CONFIG, ...overrides };
    const baseFee = await getLatestBaseFee();

    const suggestedPriority = baseFee / 10n;
    const maxPriorityFeePerGas =
        suggestedPriority > cfg.maxPriorityFeePerGasCap ? cfg.maxPriorityFeePerGasCap : suggestedPriority;

    const suggestedMaxFee = baseFee * 2n + maxPriorityFeePerGas;
    const maxFeePerGas = suggestedMaxFee > cfg.maxFeePerGasCap ? cfg.maxFeePerGasCap : suggestedMaxFee;

    logger.debug(`Gas estimate: baseFee=${baseFee}, maxFee=${maxFeePerGas}, priorityFee=${maxPriorityFeePerGas}`);

    return { maxFeePerGas, maxPriorityFeePerGas, baseFee };
}

/**
 * Bump gas price for replacement transactions.
 *
 * Increases maxFeePerGas and maxPriorityFeePerGas by gasBumpPercent,
 * capped at configured maximums.
 */
export function bumpGasPrice(
    currentMaxFee: bigint,
    currentPriorityFee: bigint,
    overrides?: Partial<GasConfig>,
): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
    const cfg = { ...DEFAULT_GAS_CONFIG, ...overrides };
    const bumpMultiplier = BigInt(100 + cfg.gasBumpPercent);
    const denominator = 100n;

    let newMaxFee = (currentMaxFee * bumpMultiplier) / denominator;
    let newPriorityFee = (currentPriorityFee * bumpMultiplier) / denominator;

    if (newMaxFee > cfg.maxFeePerGasCap) newMaxFee = cfg.maxFeePerGasCap;
    if (newPriorityFee > cfg.maxPriorityFeePerGasCap) newPriorityFee = cfg.maxPriorityFeePerGasCap;

    logger.info(
        `Gas bumped: maxFee ${currentMaxFee} -> ${newMaxFee}, priorityFee ${currentPriorityFee} -> ${newPriorityFee}`,
    );

    return { maxFeePerGas: newMaxFee, maxPriorityFeePerGas: newPriorityFee };
}

/**
 * Determine if a pending transaction should be replaced
 * based on how long it has been pending.
 */
export function shouldReplaceTx(submittedAtMs: number, overrides?: Partial<GasConfig>): boolean {
    const cfg = { ...DEFAULT_GAS_CONFIG, ...overrides };
    return Date.now() - submittedAtMs > cfg.replacementThresholdMs;
}

/**
 * Determine if a pending transaction has timed out.
 */
export function isTxTimedOut(submittedAtMs: number, overrides?: Partial<GasConfig>): boolean {
    const cfg = { ...DEFAULT_GAS_CONFIG, ...overrides };
    return Date.now() - submittedAtMs > cfg.pendingTxTimeoutMs;
}

export { DEFAULT_GAS_CONFIG };
