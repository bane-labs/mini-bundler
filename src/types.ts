/**
 * Type definitions for the ERC-4337 bundler.
 *
 * Covers all domains: UserOperation, RPC, Mempool, Bundle, Gas,
 * Reputation, Rate Limiting, Metrics, Logging, Security, Aggregation.
 */

import { type Hex, type Address } from "viem";
export type { Hex, Address };

/** ERC-4337 v0.8 UserOperation with bigint fields. */
export interface UserOperation {
    sender: Address;
    nonce: bigint;
    initCode: Hex;
    callData: Hex;
    accountGasLimits: Hex;
    preVerificationGas: bigint;
    gasFees: Hex;
    paymasterAndData: Hex;
    signature: Hex;
}

/** Raw UserOperation as received from JSON-RPC (all fields as strings/hex). */
export interface RawUserOperation {
    sender?: unknown;
    nonce?: unknown;
    initCode?: unknown;
    callData?: unknown;
    accountGasLimits?: unknown;
    preVerificationGas?: unknown;
    gasFees?: unknown;
    paymasterAndData?: unknown;
    signature?: unknown;
}

/** JSON-RPC 2.0 request envelope. */
export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number | string;
    method: string;
    params: unknown[];
}

/** JSON-RPC 2.0 response envelope. */
export interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number | string | null;
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
}

/** Result of a simulation call (validation or execution). */
export interface SimulationResult {
    success: boolean;
    reason?: string;
    result?: unknown;
}

/** A UserOperation pending in the mempool. */
export interface PendingUserOp {
    userOp: UserOperation;
    userOpHash: `0x${string}`;
    txHash: `0x${string}`;
    sender: string;
    nonce: string;
    submittedAt: number;
}

/** Full receipt from eth_getUserOperationReceipt. */
export interface UserOperationReceipt {
    userOpHash: `0x${string}`;
    entryPoint: Address;
    sender: Address;
    nonce: bigint;
    transactionHash: `0x${string}`;
    transactionIndex: number;
    blockHash: `0x${string}`;
    blockNumber: bigint;
    gasUsed: bigint;
    actualGasCost: bigint;
    actualGasUsed: bigint;
    success: boolean;
    reason?: string;
    paymaster?: Address;
    logs: LogEntry[];
    receipt?: unknown;
}

/** Individual log entry within a transaction receipt. */
export interface LogEntry {
    address: Address;
    topics: `0x${string}`[];
    data: `0x${string}`;
    blockNumber: bigint;
    transactionHash: `0x${string}`;
    logIndex: number;
}

/** Response from eth_getUserOperationByHash. */
export interface UserOperationByHash {
    userOp: UserOperation;
    entryPoint: Address;
    transactionHash: `0x${string}` | null;
    blockHash: `0x${string}` | null;
    blockNumber: bigint | null;
}

/** Lifecycle status of a UserOperation. */
export type UserOpStatus = "pending" | "submitted" | "included" | "failed" | "reverted" | "dropped";

/** Persisted UserOperation with full lifecycle metadata. */
export interface StoredUserOp {
    userOpHash: `0x${string}`;
    userOp: UserOperation;
    entryPoint: Address;
    status: UserOpStatus;
    txHash?: `0x${string}`;
    blockNumber?: bigint;
    blockHash?: `0x${string}`;
    sender: Address;
    nonce: bigint;
    submittedAt: number;
    updatedAt: number;
    receipt?: UserOperationReceipt;
}

/** Configuration for the mempool queue. */
export interface MempoolConfig {
    maxSize: number;
    maxPerSender: number;
    pendingTimeoutMs: number;
    priorityWeight: number;
}

/** Entry in the mempool queue with priority metadata. */
export interface MempoolEntry {
    storedOp: StoredUserOp;
    priority: number;
    addedAt: number;
}

/** Configuration for the bundle builder. */
export interface BundleConfig {
    maxSize: number;
    maxGas: bigint;
    timeoutMs: number;
}

/** A built bundle ready for on-chain submission. */
export interface Bundle {
    id: string;
    ops: StoredUserOp[];
    totalGas: bigint;
    createdAt: number;
}

/** Configuration for the gas manager. */
export interface GasConfig {
    maxFeePerGasCap: bigint;
    maxPriorityFeePerGasCap: bigint;
    gasBumpPercent: number;
    replacementThresholdMs: number;
    pendingTxTimeoutMs: number;
}

/** Estimated gas fees for the next transaction. */
export interface GasEstimate {
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    baseFee: bigint;
}

/** Reputation status per ERC-4337 spec. */
export type ReputationStatus = "ok" | "warn" | "banned";

/** Reputation tracking entry for an address. */
export interface ReputationEntry {
    address: Address;
    kind: "sender" | "factory" | "paymaster";
    opsSeen: number;
    opsIncluded: number;
    lastSeen: number;
    status: ReputationStatus;
    banUntil?: number;
}

/** Configuration for rate limiting. */
export interface RateLimitConfig {
    ipLimit: number;
    ipWindowMs: number;
    senderLimit: number;
    senderWindowMs: number;
}

/** Bundler operational metrics snapshot. */
export interface BundlerMetrics {
    pendingUserOps: number;
    simulationLatencyMs: number;
    validationFailures: number;
    executionFailures: number;
    totalGasUsed: bigint;
    bundleSize: number;
    avgConfirmationTimeMs: number;
}

/** Log level for structured logging. */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Context fields attached to structured log entries. */
export interface LogContext {
    userOpHash?: `0x${string}`;
    sender?: Address;
    nonce?: bigint;
    method?: string;
    [key: string]: unknown;
}

/** Security validation configuration. */
export interface SecurityConfig {
    maxCalldataLength: number;
    maxInitCodeLength: number;
    maxPaymasterDataLength: number;
    maxGasLimit: bigint;
    maxUserOpsPerBundle: number;
}

/** An aggregated bundle for handleAggregatedOps. */
export interface AggregatedBundle {
    aggregator: Address;
    signature: `0x${string}`;
    ops: StoredUserOp[];
}
