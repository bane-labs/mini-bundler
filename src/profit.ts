import { type Hex } from "viem";
import { publicClient } from "./clients.js";
import { logger } from "./logging/index.js";
import type { UserOperation } from "./types.js";

export interface ProfitCheckConfig {
    marginPercent: number;
}

const DEFAULT_CONFIG: ProfitCheckConfig = {
    marginPercent: 5,
};

export interface ProfitCheckResult {
    profitable: boolean;
    effectiveGasPrice?: bigint;
    bundlerGasPrice?: bigint;
    requiredGasPrice?: bigint;
    marginPercent?: number;
    reason?: string;
}

/**
 * Extract gas fees from packed gasFees field (v0.8 format).
 *
 * Layout (32 bytes total):
 *   [0:16]  maxPriorityFeePerGas  (uint128, left-aligned)
 *   [16:32] maxFeePerGas          (uint128, left-aligned)
 */
function extractGasFees(gasFees: Hex): {
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
} {
    const hex = gasFees.slice(2);
    const maxPriorityFeePerGas = BigInt("0x" + hex.slice(0, 32));
    const maxFeePerGas = BigInt("0x" + hex.slice(32, 64));
    return { maxFeePerGas, maxPriorityFeePerGas };
}

/**
 * Check if bundler will profit from including this UserOp.
 *
 * New logic (no simulateHandleOp dependency):
 *   1. Get latest block baseFee
 *   2. Parse UserOp.gasFees → maxFeePerGas, maxPriorityFeePerGas
 *   3. effectiveGasPrice = min(maxFeePerGas, baseFee + maxPriorityFeePerGas)
 *   4. Get bundler's actual gasPrice from chain via getGasPrice()
 *   5. requiredGasPrice = bundlerGasPrice * (100 + marginPercent) / 100
 *   6. profitable if effectiveGasPrice >= requiredGasPrice
 */
export async function checkProfit(
    userOp: UserOperation,
    overrides?: Partial<ProfitCheckConfig>,
): Promise<ProfitCheckResult> {
    const cfg = { ...DEFAULT_CONFIG, ...overrides };

    // 1. Latest block → baseFee
    const block = await publicClient.getBlock({ blockTag: "latest" });
    const baseFee = block.baseFeePerGas ?? 0n;

    // 2. Parse gasFees from packed v0.8 format
    const { maxFeePerGas, maxPriorityFeePerGas } = extractGasFees(userOp.gasFees);

    // 3. effectiveGasPrice = min(maxFeePerGas, baseFee + maxPriorityFeePerGas)
    const effectiveGasPrice =
        maxFeePerGas < baseFee + maxPriorityFeePerGas ? maxFeePerGas : baseFee + maxPriorityFeePerGas;

    // 4. Bundler's current gas price from chain
    const bundlerGasPrice = await publicClient.getGasPrice();

    // 5. requiredGasPrice = bundlerGasPrice * (100 + margin) / 100
    const requiredGasPrice = (bundlerGasPrice * BigInt(100 + cfg.marginPercent)) / 100n;

    // 6. Compare
    const profitable = effectiveGasPrice >= requiredGasPrice;

    // 7. Logging — all bigint, no Number(), no toFixed()
    logger.debug(
        `Profit check: ` +
            `baseFee=${baseFee}, ` +
            `bundlerGasPrice=${bundlerGasPrice}, ` +
            `effectiveGasPrice=${effectiveGasPrice}, ` +
            `requiredGasPrice=${requiredGasPrice}, ` +
            `margin=${cfg.marginPercent}%`,
    );

    if (!profitable) {
        logger.warn(
            `Profit check FAILED: ` + `effectiveGasPrice=${effectiveGasPrice} < requiredGasPrice=${requiredGasPrice}`,
        );
        return {
            profitable: false,
            effectiveGasPrice,
            bundlerGasPrice,
            requiredGasPrice,
            marginPercent: cfg.marginPercent,
            reason: "User gas price below bundler requirement",
        };
    }

    logger.debug(
        `Profit check OK: ` + `effectiveGasPrice=${effectiveGasPrice} >= requiredGasPrice=${requiredGasPrice}`,
    );

    return {
        profitable: true,
        effectiveGasPrice,
        bundlerGasPrice,
        requiredGasPrice,
        marginPercent: cfg.marginPercent,
    };
}
