/**
 * Phase 5: Persistent Storage
 *
 * JSON file-based persistence for UserOperations.
 * Stores UserOperation, Receipt, Status, Transaction Hash, Sender, Nonce, Timestamps.
 * Restart restores pending operations.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logging/index.js";
import type { StoredUserOp, UserOperationReceipt, UserOpStatus } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "../../bundler-data.json");

let store: Map<string, StoredUserOp> = new Map();
let loaded = false;

function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
            for (const [key, val] of Object.entries(data)) {
                const op = val as any;
                store.set(key, {
                    ...op,
                    nonce: BigInt(op.nonce),
                    blockNumber: op.blockNumber ? BigInt(op.blockNumber) : undefined,
                    receipt: op.receipt
                        ? {
                              ...op.receipt,
                              nonce: BigInt(op.receipt.nonce),
                              blockNumber: BigInt(op.receipt.blockNumber),
                              gasUsed: BigInt(op.receipt.gasUsed),
                              actualGasCost: BigInt(op.receipt.actualGasCost),
                              actualGasUsed: BigInt(op.receipt.actualGasUsed),
                          }
                        : undefined,
                    userOp: {
                        ...op.userOp,
                        nonce: BigInt(op.userOp.nonce),
                        preVerificationGas: BigInt(op.userOp.preVerificationGas),
                    },
                });
            }
            logger.info(`Storage: loaded ${store.size} ops from ${DB_PATH}`);
        }
    } catch (err: any) {
        logger.error(`Storage: failed to load ${DB_PATH}: ${err.message}`);
    }
}

function persist() {
    const obj: Record<string, any> = {};
    for (const [key, val] of store) {
        obj[key] = {
            ...val,
            nonce: "0x" + val.nonce.toString(16),
            blockNumber: val.blockNumber ? "0x" + val.blockNumber.toString(16) : undefined,
            userOp: {
                ...val.userOp,
                nonce: "0x" + val.userOp.nonce.toString(16),
                preVerificationGas: "0x" + val.userOp.preVerificationGas.toString(16),
            },
            receipt: val.receipt
                ? {
                      ...val.receipt,
                      nonce: "0x" + val.receipt.nonce.toString(16),
                      blockNumber: "0x" + val.receipt.blockNumber.toString(16),
                      gasUsed: "0x" + val.receipt.gasUsed.toString(16),
                      actualGasCost: "0x" + val.receipt.actualGasCost.toString(16),
                      actualGasUsed: "0x" + val.receipt.actualGasUsed.toString(16),
                  }
                : undefined,
        };
    }
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(obj, null, 2));
    } catch (err: any) {
        logger.error(`Storage: failed to persist: ${err.message}`);
    }
}

export function storeUserOp(stored: StoredUserOp): void {
    ensureLoaded();
    store.set(stored.userOpHash, stored);
    persist();
}

export function updateUserOpStatus(userOpHash: `0x${string}`, status: UserOpStatus, txHash?: `0x${string}`): void {
    ensureLoaded();
    const existing = store.get(userOpHash);
    if (existing) {
        existing.status = status;
        if (txHash) existing.txHash = txHash;
        existing.updatedAt = Date.now();
        persist();
    }
}

export function updateReceipt(userOpHash: `0x${string}`, receipt: UserOperationReceipt): void {
    ensureLoaded();
    const existing = store.get(userOpHash);
    if (existing) {
        existing.receipt = receipt;
        existing.status = "included";
        existing.updatedAt = Date.now();
        persist();
    }
}

export function getUserOp(userOpHash: `0x${string}`): StoredUserOp | undefined {
    ensureLoaded();
    return store.get(userOpHash);
}

export function getUserOpsByStatus(status: UserOpStatus): StoredUserOp[] {
    ensureLoaded();
    return Array.from(store.values())
        .filter((op) => op.status === status)
        .sort((a, b) => a.submittedAt - b.submittedAt);
}

export function getPendingUserOps(): StoredUserOp[] {
    return getUserOpsByStatus("pending");
}

export function getSubmittedUserOps(): StoredUserOp[] {
    return getUserOpsByStatus("submitted");
}

export function getAllUserOps(): StoredUserOp[] {
    ensureLoaded();
    return Array.from(store.values()).sort((a, b) => b.submittedAt - a.submittedAt);
}

export function removeUserOp(userOpHash: `0x${string}`): void {
    ensureLoaded();
    store.delete(userOpHash);
    persist();
}

export function closeDb() {
    persist();
    logger.info("Storage: data persisted");
}
