/**
 * Security — rate limiting and input validation.
 *
 * IP-based and sender-based rate limiting with configurable windows.
 * Validates calldata, initCode, and paymasterAndData size constraints.
 */

import type { RateLimitConfig, SecurityConfig, RawUserOperation, Address } from "../types.js";
import { logger } from "../logging/index.js";

// ---- Rate Limiter ----

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
    ipLimit: 100, // 100 requests per window
    ipWindowMs: 60_000, // 1 minute window
    senderLimit: 20, // 20 UserOps per window per sender
    senderWindowMs: 60_000,
};

interface RateBucket {
    count: number;
    windowStart: number;
}

const ipBuckets = new Map<string, RateBucket>();
const senderBuckets = new Map<string, RateBucket>();

function checkBucket(
    buckets: Map<string, RateBucket>,
    key: string,
    limit: number,
    windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now - bucket.windowStart > windowMs) {
        bucket = { count: 1, windowStart: now };
        buckets.set(key, bucket);
        return { allowed: true, retryAfterMs: 0 };
    }

    bucket.count++;

    if (bucket.count > limit) {
        const retryAfterMs = windowMs - (now - bucket.windowStart);
        return { allowed: false, retryAfterMs };
    }

    return { allowed: true, retryAfterMs: 0 };
}

/**
 * Check IP rate limit. Returns { allowed, retryAfterMs }.
 */
export function checkIpRateLimit(ip: string, config?: Partial<RateLimitConfig>) {
    const cfg = { ...DEFAULT_RATE_LIMIT, ...config };
    return checkBucket(ipBuckets, ip, cfg.ipLimit, cfg.ipWindowMs);
}

/**
 * Check sender rate limit. Returns { allowed, retryAfterMs }.
 */
export function checkSenderRateLimit(sender: Address, config?: Partial<RateLimitConfig>) {
    const cfg = { ...DEFAULT_RATE_LIMIT, ...config };
    return checkBucket(senderBuckets, sender.toLowerCase(), cfg.senderLimit, cfg.senderWindowMs);
}

/**
 * Cleanup expired buckets (call periodically).
 */
export function cleanupRateBuckets() {
    const now = Date.now();
    for (const [key, bucket] of ipBuckets) {
        if (now - bucket.windowStart > DEFAULT_RATE_LIMIT.ipWindowMs * 2) {
            ipBuckets.delete(key);
        }
    }
    for (const [key, bucket] of senderBuckets) {
        if (now - bucket.windowStart > DEFAULT_RATE_LIMIT.senderWindowMs * 2) {
            senderBuckets.delete(key);
        }
    }
}

// ---- Security Validation ----

const DEFAULT_SECURITY: SecurityConfig = {
    maxCalldataLength: 100_000, // 100KB
    maxInitCodeLength: 100_000, // 100KB
    maxPaymasterDataLength: 100_000, // 100KB
    maxGasLimit: 10_000_000n, // 10M gas
    maxUserOpsPerBundle: 30, // max 30 UserOps per bundle
};

export interface SecurityViolation {
    field: string;
    message: string;
}

/**
 * Validate UserOperation size constraints.
 */
export function validateUserOpSecurity(raw: RawUserOperation, config?: Partial<SecurityConfig>): SecurityViolation[] {
    const cfg = { ...DEFAULT_SECURITY, ...config };
    const violations: SecurityViolation[] = [];

    // Check calldata size
    if (typeof raw.callData === "string") {
        const calldataBytes = (raw.callData.length - 2) / 2;
        if (calldataBytes > cfg.maxCalldataLength) {
            violations.push({
                field: "callData",
                message: `Calldata too large: ${calldataBytes} bytes (max ${cfg.maxCalldataLength})`,
            });
        }
    }

    // Check initCode size
    if (typeof raw.initCode === "string") {
        const initCodeBytes = (raw.initCode.length - 2) / 2;
        if (initCodeBytes > cfg.maxInitCodeLength) {
            violations.push({
                field: "initCode",
                message: `InitCode too large: ${initCodeBytes} bytes (max ${cfg.maxInitCodeLength})`,
            });
        }
    }

    // Check paymasterAndData size
    if (typeof raw.paymasterAndData === "string") {
        const paymasterBytes = (raw.paymasterAndData.length - 2) / 2;
        if (paymasterBytes > cfg.maxPaymasterDataLength) {
            violations.push({
                field: "paymasterAndData",
                message: `PaymasterAndData too large: ${paymasterBytes} bytes (max ${cfg.maxPaymasterDataLength})`,
            });
        }
    }

    // Check gas overflow (accountGasLimits is bytes32 = verificationGasLimit | callGasLimit packed)
    if (typeof raw.accountGasLimits === "string" && raw.accountGasLimits.length === 66) {
        const verificationGas = BigInt("0x" + raw.accountGasLimits.slice(2, 34));
        const callGas = BigInt("0x" + raw.accountGasLimits.slice(34, 66));
        if (verificationGas + callGas > cfg.maxGasLimit) {
            violations.push({
                field: "accountGasLimits",
                message: `Total gas limit overflow: ${(verificationGas + callGas).toString()} (max ${cfg.maxGasLimit})`,
            });
        }
    }

    return violations;
}

export { DEFAULT_RATE_LIMIT, DEFAULT_SECURITY };
