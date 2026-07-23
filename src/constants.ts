/**
 * Shared constants used across the bundler.
 *
 * Values here are defaults; most can be overridden via environment variables
 * in config.ts. Constants that must remain fixed (not configurable) live here.
 */

// --- Gas ---
/** HandleOps transaction timeout in milliseconds. */
export const HANDLE_OPS_TIMEOUT_MS = 60_000;

/** Base fee cache time-to-live in milliseconds (~1 block interval). */
export const BASE_FEE_CACHE_TTL_MS = 12_000;

/** Fallback base fee when RPC call fails (10 gwei). */
export const FALLBACK_BASE_FEE = 10_000_000_000n;

// --- Reputation ---
/** Minimum ops seen before ban consideration. */
export const REPUTATION_BAN_THRESHOLD = 10;

/** Duration of a reputation ban in milliseconds (1 hour). */
export const REPUTATION_BAN_DURATION_MS = 60 * 60 * 1000;

/** ops_seen / ops_included ratio above which a warning is issued. */
export const REPUTATION_WARN_MULTIPLIER = 5;

/** Inclusion rate below which an address is banned (5%). */
export const REPUTATION_BAN_RATE = 0.05;

// --- Pre-verification Gas ---
/** Gas cost per zero byte in calldata. */
export const ZERO_BYTE_GAS = 4n;

/** Gas cost per non-zero byte in calldata. */
export const NON_ZERO_BYTE_GAS = 16n;

/** Fixed base gas overhead for every transaction. */
export const TX_BASE_GAS = 21_000n;

/** Additional gas overhead for ERC-4337 processing. */
export const ERC4337_OVERHEAD_GAS = 100_000n;

/** Default pre-verification gas estimate when simulation fails. */
export const DEFAULT_PRE_VERIFICATION_GAS = 500_000n;

/** Default verification gas limit when simulation fails. */
export const DEFAULT_VERIFICATION_GAS_LIMIT = 300_000n;

// --- Default Gas Limits ---
/** Default verification gas limit (0.5 ETH). */
export const DEFAULT_ACCOUNT_GAS_LIMITS = "0x0000000000000000000000000007a120000000000000000000000000000493e0";

/** Default pre-verification gas for test UserOperations. */
export const DEFAULT_PRE_VERIFICATION_GAS_HEX = 100000n;

// --- Aggregator ---
/** Default validation gas limit for aggregated ops. */
export const DEFAULT_AGGREGATOR_VALIDATION_GAS = 500000n;
