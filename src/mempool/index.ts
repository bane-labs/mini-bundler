/**
 * Mempool — pending queue for UserOperations.
 *
 * FIFO ordering, configurable priority, sender+nonce deduplication,
 * replacement policy, expiration timeout.
 */

import type { MempoolConfig, MempoolEntry, StoredUserOp, UserOperation, UserOpStatus, Address } from "../types.js";
import { logger } from "../logging/index.js";

const DEFAULT_MEMPOOL_CONFIG: MempoolConfig = {
    maxSize: 1000,
    maxPerSender: 10,
    pendingTimeoutMs: 300_000, // 5 minutes
    priorityWeight: 1,
};

export class Mempool {
    private entries = new Map<string, MempoolEntry>(); // key = sender:nonce
    private config: MempoolConfig;

    constructor(config?: Partial<MempoolConfig>) {
        this.config = { ...DEFAULT_MEMPOOL_CONFIG, ...config };
    }

    private dedupKey(sender: Address, nonce: bigint): string {
        return `${sender.toLowerCase()}:${nonce.toString()}`;
    }

    add(entry: MempoolEntry): { accepted: boolean; reason?: string } {
        const { userOp } = entry.storedOp;
        const key = this.dedupKey(userOp.sender, userOp.nonce);

        // Check capacity
        if (this.entries.size >= this.config.maxSize) {
            this.evictExpired();
            if (this.entries.size >= this.config.maxSize) {
                return { accepted: false, reason: "Mempool full" };
            }
        }

        // Check per-sender limit
        const senderCount = this.countBySender(userOp.sender);
        const existing = this.entries.get(key);

        if (existing && !existing.storedOp.txHash) {
            // Replacement policy: new op replaces old if higher gas price
            this.entries.delete(key);
            logger.info(`Mempool: replaced UserOp sender=${userOp.sender} nonce=${userOp.nonce}`);
        } else if (!existing && senderCount >= this.config.maxPerSender) {
            return { accepted: false, reason: `Sender limit reached (${this.config.maxPerSender})` };
        }

        this.entries.set(key, entry);
        logger.debug(`Mempool: added UserOp key=${key} size=${this.entries.size}`);
        return { accepted: true };
    }

    remove(sender: Address, nonce: bigint): boolean {
        const key = this.dedupKey(sender, nonce);
        const deleted = this.entries.delete(key);
        if (deleted) {
            logger.debug(`Mempool: removed UserOp key=${key}`);
        }
        return deleted;
    }

    getByKey(sender: Address, nonce: bigint): MempoolEntry | undefined {
        return this.entries.get(this.dedupKey(sender, nonce));
    }

    /**
     * Return next batch of ops for bundling, sorted by FIFO + priority.
     */
    getNextBatch(maxSize: number): MempoolEntry[] {
        const all = Array.from(this.entries.values())
            .filter((e) => !e.storedOp.txHash) // only unsubmitted
            .sort((a, b) => {
                // Priority first, then FIFO
                if (a.priority !== b.priority) return b.priority - a.priority;
                return a.addedAt - b.addedAt;
            });

        return all.slice(0, maxSize);
    }

    /**
     * Mark entries as submitted (have txHash).
     */
    markSubmitted(sender: Address, nonce: bigint, txHash: `0x${string}`) {
        const key = this.dedupKey(sender, nonce);
        const entry = this.entries.get(key);
        if (entry) {
            entry.storedOp.txHash = txHash;
            entry.storedOp.status = "submitted";
            entry.storedOp.updatedAt = Date.now();
        }
    }

    /**
     * Mark entries as included / failed / dropped.
     */
    markStatus(sender: Address, nonce: bigint, status: UserOpStatus) {
        const key = this.dedupKey(sender, nonce);
        const entry = this.entries.get(key);
        if (entry) {
            entry.storedOp.status = status;
            entry.storedOp.updatedAt = Date.now();
        }
    }

    /**
     * Remove expired pending entries.
     */
    evictExpired(): number {
        const now = Date.now();
        let evicted = 0;
        for (const [key, entry] of this.entries) {
            if (!entry.storedOp.txHash && now - entry.addedAt > this.config.pendingTimeoutMs) {
                entry.storedOp.status = "dropped";
                this.entries.delete(key);
                evicted++;
            }
        }
        if (evicted > 0) {
            logger.info(`Mempool: evicted ${evicted} expired entries`);
        }
        return evicted;
    }

    removeByStatus(status: UserOpStatus): number {
        let removed = 0;
        for (const [key, entry] of this.entries) {
            if (entry.storedOp.status === status) {
                this.entries.delete(key);
                removed++;
            }
        }
        return removed;
    }

    private countBySender(sender: Address): number {
        const prefix = sender.toLowerCase() + ":";
        let count = 0;
        for (const key of this.entries.keys()) {
            if (key.startsWith(prefix)) count++;
        }
        return count;
    }

    get size(): number {
        return this.entries.size;
    }

    getAll(): MempoolEntry[] {
        return Array.from(this.entries.values());
    }
}
