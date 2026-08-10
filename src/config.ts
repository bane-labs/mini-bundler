/**
 * Application configuration loaded from environment variables.
 *
 * All configurable values are read from .env via dotenv.
 * See .env.example for the full list of supported variables.
 */

import dotenv from "dotenv";
import { defineChain, createPublicClient, http } from "viem";
import { logger } from "./logging/index.js";

dotenv.config();

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function validateAddress(label: string, value: string): `0x${string}` {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
        throw new Error(`Invalid ${label}: expected 0x-prefixed 40 hex chars, got "${value}"`);
    }
    return value as `0x${string}`;
}

const rpcUrl = requireEnv("RPC_URL");
const privateKey = requireEnv("PRIVATE_KEY") as `0x${string}`;
const entryPoint = validateAddress("ENTRYPOINT", requireEnv("ENTRYPOINT"));

// Chain identity is discovered from the configured RPC node at startup.
// Fields are mutated by initChainConfig() so eth_chainId reflects the real network.
const chainConfig = defineChain({
    id: Number(process.env.CHAIN_ID ?? 2312251829),
    name: process.env.CHAIN_NAME ?? "NeoX TestNet",
    nativeCurrency: {
        name: "NeoX Gas Token",
        symbol: "GAS",
        decimals: 18,
    },
    rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] },
    },
    blockExplorers: {
        default: {
            name: "NeoX Explorer",
            url: "https://neoxscan.rolless.xyz",
        },
    },
});

/** Core bundler configuration. */
export const config = {
    port: Number(process.env.PORT ?? 3000),
    rpcUrl,
    privateKey,
    entryPoint,
    chain: chainConfig,
};

/**
 * Query the configured RPC node for its actual EIP-155 chain id and update
 * config.chain in place, so eth_chainId reflects the live network instead of
 * a hardcoded default. Called once at server startup.
 */
export async function initChainConfig(): Promise<number> {
    const client = createPublicClient({ chain: chainConfig, transport: http(rpcUrl) });
    try {
        const id = Number(await client.getChainId());
        chainConfig.id = id;
        logger.info(`Chain configured from RPC: id=${id}`);
        return id;
    } catch (err: unknown) {
        logger.error(`Failed to fetch chain id from RPC: ${err instanceof Error ? err.message : "unknown"}`);
        return chainConfig.id;
    }
}

/** Mempool configuration — controls pending queue behavior. */
export const mempoolConfig = {
    maxSize: Number(process.env.MEMPOOL_MAX_SIZE ?? 1000),
    maxPerSender: Number(process.env.MEMPOOL_MAX_PER_SENDER ?? 10),
    pendingTimeoutMs: Number(process.env.MEMPOOL_TIMEOUT_MS ?? 300_000),
};

/** Bundle builder configuration — controls multi-UserOp bundling. */
export const bundleConfig = {
    maxSize: Number(process.env.BUNDLE_MAX_SIZE ?? 10),
    maxGas: BigInt(process.env.BUNDLE_MAX_GAS ?? "10000000"),
    timeoutMs: Number(process.env.BUNDLE_TIMEOUT_MS ?? 10_000),
};

/** Gas manager configuration — controls dynamic gas pricing. */
export const gasConfig = {
    maxFeePerGasCap: BigInt(process.env.MAX_FEE_PER_GAS_CAP ?? "50000000000"),
    maxPriorityFeePerGasCap: BigInt(process.env.MAX_PRIORITY_FEE_CAP ?? "3000000000"),
    gasBumpPercent: Number(process.env.GAS_BUMP_PERCENT ?? 20),
    replacementThresholdMs: Number(process.env.REPLACEMENT_THRESHOLD_MS ?? 30_000),
    pendingTxTimeoutMs: Number(process.env.PENDING_TX_TIMEOUT_MS ?? 120_000),
};

/** Rate limiting configuration — IP-based and sender-based limits. */
export const rateLimitConfig = {
    ipLimit: Number(process.env.RATE_LIMIT_IP ?? 100),
    ipWindowMs: Number(process.env.RATE_LIMIT_IP_WINDOW_MS ?? 60_000),
    senderLimit: Number(process.env.RATE_LIMIT_SENDER ?? 20),
    senderWindowMs: Number(process.env.RATE_LIMIT_SENDER_WINDOW_MS ?? 60_000),
};

/** Log level for structured logging (DEBUG, INFO, WARN, ERROR). */
export const logLevel = process.env.LOG_LEVEL || "INFO";

/** Security validation configuration — size limits and gas bounds. */
export const securityConfig = {
    maxCalldataLength: Number(process.env.MAX_CALLDATA_LENGTH ?? 100_000),
    maxInitCodeLength: Number(process.env.MAX_INITCODE_LENGTH ?? 100_000),
    maxPaymasterDataLength: Number(process.env.MAX_PAYMASTER_DATA_LENGTH ?? 100_000),
    maxGasLimit: BigInt(process.env.MAX_GAS_LIMIT ?? "10000000"),
    maxUserOpsPerBundle: Number(process.env.MAX_USEROPS_PER_BUNDLE ?? 30),
};

/** Profit checker configuration — bundler margin requirements. */
export const profitConfig = {
    bundlerMarginPercent: Number(process.env.MIN_BUNDLER_MARGIN_PERCENT ?? 5),
};
