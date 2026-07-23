/**
 * Bundle Builder — assembles UserOperations into bundles for handleOps.
 *
 * Configurable max bundle size, max gas, timeout.
 * Handles partial failures within a bundle.
 */

import type { StoredUserOp, Bundle, BundleConfig, Address } from "../types.js";
import { logger } from "../logging/index.js";
import { metrics } from "../metrics/index.js";

const DEFAULT_BUNDLE_CONFIG: BundleConfig = {
    maxSize: 10,
    maxGas: 10_000_000n,
    timeoutMs: 10_000,
};

let bundleCounter = 0;

export function buildBundle(ops: StoredUserOp[], config?: Partial<BundleConfig>): Bundle {
    const cfg = { ...DEFAULT_BUNDLE_CONFIG, ...config };
    const selected: StoredUserOp[] = [];
    let totalGas = 0n;

    for (const op of ops) {
        if (selected.length >= cfg.maxSize) break;

        const opGas = estimateOpGas(op);
        if (totalGas + opGas > cfg.maxGas) {
            logger.debug(`BundleBuilder: skipping op — would exceed gas limit (${totalGas + opGas} > ${cfg.maxGas})`);
            continue;
        }

        selected.push(op);
        totalGas += opGas;
    }

    metrics.recordBundleSize(selected.length);

    return {
        id: `bundle-${++bundleCounter}-${Date.now()}`,
        ops: selected,
        totalGas,
        createdAt: Date.now(),
    };
}

function estimateOpGas(op: StoredUserOp): bigint {
    const { accountGasLimits } = op.userOp;
    if (accountGasLimits.length === 66) {
        const verificationGas = BigInt("0x" + accountGasLimits.slice(2, 34));
        const callGas = BigInt("0x" + accountGasLimits.slice(34, 66));
        return verificationGas + callGas;
    }
    return 500_000n; // fallback estimate
}

/**
 * Group ops by aggregator for handleAggregatedOps.
 */
export function groupByAggregator(ops: StoredUserOp[]): Map<Address, StoredUserOp[]> {
    const groups = new Map<Address, StoredUserOp[]>();
    for (const op of ops) {
        const key = op.entryPoint; // group by entryPoint for now
        const group = groups.get(key) || [];
        group.push(op);
        groups.set(key, group);
    }
    return groups;
}

/**
 * Handle partial failures: mark failed ops, keep successful ones.
 */
export function handlePartialFailure(
    bundle: Bundle,
    failedIndices: number[],
): { successful: StoredUserOp[]; failed: StoredUserOp[] } {
    const successful: StoredUserOp[] = [];
    const failed: StoredUserOp[] = [];

    for (let i = 0; i < bundle.ops.length; i++) {
        if (failedIndices.includes(i)) {
            bundle.ops[i].status = "failed";
            failed.push(bundle.ops[i]);
        } else {
            successful.push(bundle.ops[i]);
        }
    }

    if (failed.length > 0) {
        logger.warn(`BundleBuilder: ${failed.length}/${bundle.ops.length} ops failed in bundle ${bundle.id}`);
    }

    return { successful, failed };
}
