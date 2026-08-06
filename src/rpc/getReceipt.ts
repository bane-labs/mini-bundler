/**
 * eth_getUserOperationReceipt — fetches full receipt for a UserOperation.
 *
 * Returns actualGasCost, actualGasUsed, logs, and on-chain confirmation status.
 */

import { publicClient } from "../clients.js";
import { getUserOp } from "../storage/index.js";
import type { UserOperationReceipt, StoredUserOp, Address } from "../types.js";
import { logger } from "../logging/index.js";

export async function getUserOperationReceipt(userOpHash: `0x${string}`): Promise<UserOperationReceipt | null> {
    const stored = getUserOp(userOpHash);
    if (!stored) {
        logger.debug(`Receipt not found for ${userOpHash}`);
        return null;
    }

    // If we already have a cached receipt, return it
    if (stored.receipt) {
        return stored.receipt;
    }

    // If no txHash yet, still pending
    if (!stored.txHash) {
        return null;
    }

    // Fetch from chain
    try {
        const receipt = await publicClient.getTransactionReceipt({ hash: stored.txHash });
        if (!receipt) return null;

        const userOpReceipt: UserOperationReceipt = {
            userOpHash,
            entryPoint: stored.entryPoint,
            sender: stored.userOp.sender,
            nonce: stored.userOp.nonce,
            transactionHash: stored.txHash,
            transactionIndex: receipt.transactionIndex,
            blockHash: receipt.blockHash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
            actualGasCost: receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n),
            actualGasUsed: receipt.gasUsed,
            success: receipt.status === "success",
            reason: receipt.status !== "success" ? "reverted on-chain" : undefined,
            paymaster:
                stored.userOp.paymasterAndData !== "0x"
                    ? (stored.userOp.paymasterAndData.slice(0, 42) as Address)
                    : undefined,
            logs: receipt.logs.map((log) => ({
                address: log.address,
                topics: log.topics as `0x${string}`[],
                data: log.data,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: log.logIndex,
            })),
            receipt: {
                transactionHash: receipt.transactionHash,
                transactionIndex: receipt.transactionIndex,
                blockHash: receipt.blockHash,
                blockNumber: receipt.blockNumber,
                from: receipt.from,
                to: receipt.to,
                cumulativeGasUsed: receipt.cumulativeGasUsed,
                gasUsed: receipt.gasUsed,
                effectiveGasPrice: receipt.effectiveGasPrice,
                contractAddress: receipt.contractAddress,
                logs: receipt.logs,
                logsBloom: receipt.logsBloom,
                status: receipt.status,
            },
        };

        logger.info(`Fetched receipt for ${userOpHash}: success=${userOpReceipt.success}`);
        return userOpReceipt;
    } catch (err: unknown) {
        logger.debug(`Receipt not yet available for ${userOpHash}: ${(err as Error).message ?? "unknown"}`);
        return null;
    }
}
