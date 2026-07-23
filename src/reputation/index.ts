/**
 * Reputation System — ERC-4337 compliant reputation tracking.
 *
 * Tracks sender, factory, and paymaster reputation.
 * Metrics: ops seen, ops included, validation failures, execution failures.
 * Supports temporary banning for addresses with poor inclusion rates.
 */

import {
    REPUTATION_BAN_THRESHOLD,
    REPUTATION_BAN_DURATION_MS,
    REPUTATION_WARN_MULTIPLIER,
    REPUTATION_BAN_RATE,
} from "../constants.js";
import { logger } from "../logging/index.js";
import type { Address, ReputationEntry, ReputationStatus } from "../types.js";

const entries = new Map<string, ReputationEntry>();

function keyOf(address: Address, kind: ReputationEntry["kind"]): string {
    return `${kind}:${address.toLowerCase()}`;
}

/**
 * Get or create reputation entry.
 */
export function getReputation(address: Address, kind: ReputationEntry["kind"]): ReputationEntry {
    const k = keyOf(address, kind);
    let entry = entries.get(k);
    if (!entry) {
        entry = {
            address: address.toLowerCase() as Address,
            kind,
            opsSeen: 0,
            opsIncluded: 0,
            lastSeen: Date.now(),
            status: "ok",
        };
        entries.set(k, entry);
    }
    return entry;
}

/**
 * Record that an op was seen (validation started).
 */
export function recordSeen(address: Address, kind: ReputationEntry["kind"]): void {
    const entry = getReputation(address, kind);
    entry.opsSeen++;
    entry.lastSeen = Date.now();
    evaluateStatus(entry);
}

/**
 * Record that an op was successfully included on-chain.
 */
export function recordIncluded(address: Address, kind: ReputationEntry["kind"]): void {
    const entry = getReputation(address, kind);
    entry.opsIncluded++;
    entry.lastSeen = Date.now();
    evaluateStatus(entry);
}

/**
 * Record a validation failure.
 */
export function recordValidationFailure(address: Address, kind: ReputationEntry["kind"]): void {
    const entry = getReputation(address, kind);
    entry.opsSeen++;
    entry.lastSeen = Date.now();
    evaluateStatus(entry);
}

/**
 * Record an execution failure.
 */
export function recordExecutionFailure(address: Address, kind: ReputationEntry["kind"]): void {
    const entry = getReputation(address, kind);
    entry.opsSeen++;
    entry.lastSeen = Date.now();
    evaluateStatus(entry);
}

function evaluateStatus(entry: ReputationEntry): void {
    // Check if ban period expired
    if (entry.status === "banned" && entry.banUntil && Date.now() > entry.banUntil) {
        entry.status = "ok";
        entry.banUntil = undefined;
        logger.info(`Reputation: ${entry.kind} ${entry.address} ban expired, reset to ok`);
    }

    if (entry.opsSeen < REPUTATION_BAN_THRESHOLD) {
        entry.status = "ok";
        return;
    }

    const inclusionRate = entry.opsIncluded / entry.opsSeen;

    if (inclusionRate <= REPUTATION_BAN_RATE) {
        // Less than 5% inclusion → ban
        entry.status = "banned";
        entry.banUntil = Date.now() + REPUTATION_BAN_DURATION_MS;
        logger.warn(
            `Reputation: ${entry.kind} ${entry.address} banned for 1h (inclusion rate ${(inclusionRate * 100).toFixed(1)}%)`,
        );
    } else if (entry.opsSeen / Math.max(entry.opsIncluded, 1) > REPUTATION_WARN_MULTIPLIER) {
        entry.status = "warn";
        logger.warn(
            `Reputation: ${entry.kind} ${entry.address} warn (seen=${entry.opsSeen}, included=${entry.opsIncluded})`,
        );
    } else {
        entry.status = "ok";
    }
}

/**
 * Check if an address is banned.
 */
export function isBanned(address: Address, kind: ReputationEntry["kind"]): boolean {
    const entry = getReputation(address, kind);
    if (entry.status === "banned") {
        if (entry.banUntil && Date.now() > entry.banUntil) {
            entry.status = "ok";
            entry.banUntil = undefined;
            return false;
        }
        return true;
    }
    return false;
}

/**
 * Get all reputation entries (for debug / monitoring).
 */
export function getAllReputations(): ReputationEntry[] {
    return Array.from(entries.values());
}

/**
 * Manually set reputation status (for testing / admin).
 */
export function setReputationStatus(
    address: Address,
    kind: ReputationEntry["kind"],
    status: ReputationStatus,
    banUntil?: number,
): void {
    const entry = getReputation(address, kind);
    entry.status = status;
    entry.banUntil = banUntil;
}
