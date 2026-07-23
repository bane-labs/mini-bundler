/**
 * eth_getUserOperationByHash — lookup UserOperation by its hash.
 *
 * Returns the UserOperation, EntryPoint, transactionHash, and block info.
 */

import { publicClient } from "../clients.js";
import { getUserOp } from "../storage/index.js";
import type { UserOperationByHash } from "../types.js";
import { logger } from "../logging/index.js";

export async function getUserOperationByHash(userOpHash: `0x${string}`): Promise<UserOperationByHash | null> {
    const stored = getUserOp(userOpHash);
    if (!stored) {
        logger.debug(`UserOp not found for hash ${userOpHash}`);
        return null;
    }

    // Per ERC-7769: failed/dropped ops should return null (not found)
    if (stored.status === "failed" || stored.status === "dropped") {
        logger.debug(`UserOp ${userOpHash} status=${stored.status}, returning null`);
        return null;
    }

    let blockHash: `0x${string}` | undefined = stored.blockHash;
    let blockNumber: bigint | undefined = stored.blockNumber;

    if (stored.txHash && !blockNumber) {
        try {
            const receipt = await publicClient.getTransactionReceipt({ hash: stored.txHash });
            if (receipt) {
                blockHash = receipt.blockHash;
                blockNumber = receipt.blockNumber;
            }
        } catch {
            // tx may still be pending
        }
    }

    return {
        userOp: stored.userOp,
        entryPoint: stored.entryPoint,
        transactionHash: stored.txHash ?? ("0x" as `0x${string}`),
        blockHash: blockHash ?? ("0x" as `0x${string}`),
        blockNumber: blockNumber ?? 0n,
    };
}
