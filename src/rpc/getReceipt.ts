/**
 * eth_getUserOperationReceipt — fetches full receipt for a UserOperation.
 *
 * Returns actualGasCost, actualGasUsed, logs, and on-chain confirmation status.
 */

import { publicClient } from "../clients.js";
import { getUserOp } from "../storage/index.js";
import type { UserOperationReceipt, StoredUserOp, Address } from "../types.js";
import { logger } from "../logging/index.js";
import { decodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

const UOP_EVENT_TOPIC = keccak256(toBytes("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)"));
const REVERT_REASON_TOPIC = keccak256(toBytes("UserOperationRevertReason(bytes32,address,uint256,bytes)"));
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

        // ERC-4337 v0.9: a handleOps tx can be mined (status=success) even when
        // an individual UserOp's execution failed — the per-op result is only
        // recorded in the EntryPoint UserOperationEvent log. Match it by the
        // indexed userOpHash (topic[1]) and use its success/gas fields.
        const opLog = receipt.logs.find((l) => l.topics[0] === UOP_EVENT_TOPIC && l.topics[1]?.toLowerCase() === userOpHash.toLowerCase());
        const revertLog = receipt.logs.find((l) => l.topics[0] === REVERT_REASON_TOPIC && l.topics[1]?.toLowerCase() === userOpHash.toLowerCase());

        let success: boolean;
        let actualGasCost: bigint;
        let actualGasUsed: bigint;
        if (opLog) {
            const [evNonce, evSuccess, evGasCost, evGasUsed] = decodeAbiParameters(
                [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
                opLog.data as Hex,
            );
            success = evSuccess;
            actualGasCost = evGasCost;
            actualGasUsed = evGasUsed;
        } else {
            success = receipt.status === "success";
            actualGasCost = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
            actualGasUsed = receipt.gasUsed;
        }

        let reason: string | undefined;
        if (!success) {
            if (revertLog) {
                const [, evRevertReason] = decodeAbiParameters(
                    [{ type: "uint256" }, { type: "bytes" }],
                    revertLog.data as Hex,
                );
                reason = evRevertReason;
            } else {
                reason = "reverted on-chain";
            }
        }

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
            actualGasCost,
            actualGasUsed,
            success,
            reason,
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
