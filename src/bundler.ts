import { handleOps as submitHandleOps } from "./entrypoint.js";
import { publicClient } from "./clients.js";
import { config, bundleConfig, profitConfig } from "./config.js";
import { entryPointAbi } from "./abi.js";
import type { UserOperation, StoredUserOp, PendingUserOp } from "./types.js";
import { simulateHandleOp } from "./simulateHandleOp.js";
import { simulateValidation } from "./simulateValidation.js";
import { BundlerRpcError } from "./aaErrors.js";
import { Mempool } from "./mempool/index.js";
import { Scheduler } from "./scheduler/index.js";
import { buildBundle } from "./bundle/index.js";
import { estimateGasFees } from "./gas/index.js";
import { storeUserOp, getUserOp, getPendingUserOps } from "./storage/index.js";
import {
    recordSeen,
    recordIncluded,
    recordValidationFailure,
    recordExecutionFailure,
    isBanned,
} from "./reputation/index.js";
import { metrics } from "./metrics/index.js";
import { logger, childLogger } from "./logging/index.js";
import type { MempoolEntry } from "./types.js";
import { checkProfit } from "./profit.js";

const mempool = new Mempool();

function dedupKey(userOp: UserOperation): string {
    const nonceHex = "0x" + userOp.nonce.toString(16);
    return `${userOp.sender.toLowerCase()}:${nonceHex}`;
}

async function getUserOpHash(userOp: UserOperation): Promise<`0x${string}`> {
    return (await publicClient.readContract({
        address: config.entryPoint,
        abi: entryPointAbi,
        functionName: "getUserOpHash",
        args: [userOp],
    })) as `0x${string}`;
}

export class Bundler {
    private scheduler: Scheduler;

    constructor() {
        this.scheduler = new Scheduler(mempool, (batch) => this.processBatch(batch), {
            intervalMs: 3_000,
            batchSize: bundleConfig.maxSize,
        });
    }

    startScheduler() {
        this.scheduler.start();
    }

    stopScheduler() {
        this.scheduler.stop();
    }

    async sendUserOperation(userOp: UserOperation): Promise<`0x${string}`> {
        const log = childLogger({ sender: userOp.sender, nonce: userOp.nonce, method: "sendUserOperation" });

        if (isBanned(userOp.sender, "sender")) {
            throw new Error("Sender is banned due to poor reputation");
        }
        recordSeen(userOp.sender, "sender");

        const now = Date.now();
        const storedOp: StoredUserOp = {
            userOpHash: "0x",
            userOp,
            entryPoint: config.entryPoint,
            status: "pending",
            sender: userOp.sender,
            nonce: userOp.nonce,
            submittedAt: now,
            updatedAt: now,
        };

        const validation = await simulateValidation(userOp);

        if (!validation.success) {
            recordValidationFailure(userOp.sender, "sender");
            metrics.incValidationFailures();
            throw new BundlerRpcError(-32500, validation.reason ?? "rejected by EntryPoint simulateValidation");
        }

        if (validation.aggregated) {
            throw new Error("Aggregator UserOperation not supported (use handleAggregatedOps)");
        }

        const execution = await simulateHandleOp(userOp);

        if (!execution.success) {
            recordExecutionFailure(userOp.sender, "sender");
            metrics.incExecutionFailures();

            const errorDetail = execution.targetError
                ? ` [${execution.targetError.errorName}: ${execution.targetError.message}]`
                : "";
            throw new BundlerRpcError(-32500, `Execution failed: ${execution.reason ?? "unknown"}${errorDetail}`);
        }

        const profitCheck = await checkProfit(userOp, {
            marginPercent: profitConfig.bundlerMarginPercent,
        });

        if (!profitCheck.profitable) {
            throw new Error(`Profit check failed: ${profitCheck.reason}`);
        }

        const userOpHash = await getUserOpHash(userOp);
        storedOp.userOpHash = userOpHash;

        log.info(`UserOp simulated & profit-checked`, { userOpHash });

        await estimateGasFees();

        storeUserOp(storedOp);

        const entry: MempoolEntry = {
            storedOp,
            priority: 0,
            addedAt: now,
        };
        const result = mempool.add(entry);
        if (!result.accepted) {
            throw new Error(`Mempool rejected: ${result.reason}`);
        }

        metrics.incPendingOps();
        metrics.setPendingCount(mempool.size);

        return userOpHash;
    }

    async processBatch(batch: MempoolEntry[]) {
        if (batch.length === 0) return;

        const ops = batch.map((e) => e.storedOp.userOp);
        const bundle = buildBundle(batch.map((e) => e.storedOp));

        logger.info(`Processing bundle ${bundle.id}: ${bundle.ops.length} ops, gas=${bundle.totalGas}`);

        try {
            const txHash = await submitHandleOps(ops);

            metrics.incBundlesSubmitted();
            metrics.incOpsSubmitted(bundle.ops.length);

            for (const entry of batch) {
                entry.storedOp.txHash = txHash;
                entry.storedOp.status = "submitted";
                entry.storedOp.updatedAt = Date.now();
                storeUserOp(entry.storedOp);
                mempool.markSubmitted(entry.storedOp.userOp.sender, entry.storedOp.userOp.nonce, txHash);
                metrics.decPendingOps();
            }

            logger.info(`Bundle ${bundle.id} submitted: tx=${txHash}`);

            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
            logger.info(`Bundle ${bundle.id} confirmed: status=${receipt.status}`);

            for (const entry of batch) {
                if (receipt.status === "success") {
                    recordIncluded(entry.storedOp.userOp.sender, "sender");
                    entry.storedOp.status = "included";
                    metrics.recordConfirmationTime(Date.now() - entry.storedOp.submittedAt);
                } else {
                    recordExecutionFailure(entry.storedOp.userOp.sender, "sender");
                    entry.storedOp.status = "reverted";
                    metrics.incExecutionFailures();
                }
                entry.storedOp.updatedAt = Date.now();
                storeUserOp(entry.storedOp);
            }
        } catch (err: unknown) {
            logger.error(`Bundle ${bundle.id} failed: ${(err as Error).message ?? "unknown"}`);
            for (const entry of batch) {
                entry.storedOp.status = "failed";
                entry.storedOp.updatedAt = Date.now();
                storeUserOp(entry.storedOp);
                mempool.remove(entry.storedOp.userOp.sender, entry.storedOp.userOp.nonce);
                metrics.incExecutionFailures();
            }
        }

        metrics.setPendingCount(mempool.size);
    }

    getByUserOpHash(userOpHash: string): PendingUserOp | undefined {
        const stored = getUserOp(userOpHash as `0x${string}`);
        if (!stored) return undefined;
        return {
            userOp: stored.userOp,
            userOpHash: stored.userOpHash,
            txHash: stored.txHash ?? ("0x" as `0x${string}`),
            sender: stored.sender,
            nonce: "0x" + stored.nonce.toString(16),
            submittedAt: stored.submittedAt,
        };
    }

    getAllPending(): StoredUserOp[] {
        return getPendingUserOps();
    }
}
