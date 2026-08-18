import { type Hex, encodeFunctionData, SignedAuthorization } from "viem";

import { publicClient, walletClient, account } from "./clients.js";
import { config } from "./config.js";
import { entryPointAbi } from "./abi.js";
import type { UserOperation } from "./types.js";
import { estimateGasFees } from "./gas/index.js";
import { HANDLE_OPS_TIMEOUT_MS, DEFAULT_AGGREGATOR_VALIDATION_GAS } from "./constants.js";
import { logger } from "./logging/index.js";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
}

/**
 * Collect EIP-7702 authorizations from a batch of UserOperations, deduplicated
 * by sender. An authorization spends the EOA's own nonce, so only the first
 * op per sender may carry one — later ops from the same sender are dropped
 * from the authorization list (their eip7702Auth nonce is already consumed).
 */
function collectAuthorizations(ops: UserOperation[]): SignedAuthorization[] {
    const seen = new Set<string>();
    const auths: SignedAuthorization[] = [];
    for (const op of ops) {
        if (!op.eip7702Auth) continue;
        const key = op.sender.toLowerCase();
        if (seen.has(key)) {
            // A later op from the same sender carries an auth that is silently
            // dropped (only the first auth per sender is used). This is an edge
            // case worth surfacing for inspection — the dropped auth may be the
            // one the user actually intended.
            logger.warn(`Dropping duplicate eip7702Auth for sender ${op.sender} (op nonce=${op.nonce}): only the first auth per sender is attached to the type-4 tx`);
            continue;
        }
        seen.add(key);
        const a = op.eip7702Auth;
        auths.push({
            address: a.address,
            chainId: Number(a.chainId),
            nonce: Number(a.nonce),
            yParity: Number(a.yParity),
            r: a.r,
            s: a.s,
        });
    }
    return auths;
}

/**
 * Submit UserOperations to the EntryPoint via handleOps.
 *
 * When any op carries `eip7702Auth`, the transaction is signed as an EIP-7702
 * (type-4) transaction with the authorizations attached at the transaction
 * level, so fresh EOA senders are upgraded to smart accounts in the same
 * transaction that executes their first UserOp. Otherwise the standard
 * writeContract path is used.
 *
 * Returns the transaction hash of the submitted bundle.
 */
export async function handleOps(ops: UserOperation[]): Promise<`0x${string}`> {
    const auths = collectAuthorizations(ops);

    if (auths.length === 0) {
        const hash = await withTimeout(
            walletClient.writeContract({
                address: config.entryPoint,
                abi: entryPointAbi,
                functionName: "handleOps",
                args: [ops, account.address],
            }),
            HANDLE_OPS_TIMEOUT_MS,
            "handleOps",
        );
        return hash;
    }

    // EIP-7702 path: sign a type-4 transaction because writeContract does not
    // support attaching authorizationList.
    const data = encodeFunctionData({
        abi: entryPointAbi,
        functionName: "handleOps",
        args: [ops, account.address],
    });

    // EIP-7702: estimateGas does not execute tx-level authorizations, so the
    // fresh EOA senders have no code during estimation. The NeoX RPC only
    // accepts a map-shaped stateOverride (indexed by address), so build one
    // and inject the delegation designator for each upgraded sender.
    const seenSenders = new Set<string>();
    const mapOverride: Record<string, { code: Hex }> = {};
    for (const op of ops) {
        if (!op.eip7702Auth) continue;
        const key = op.sender.toLowerCase();
        if (seenSenders.has(key)) continue;
        seenSenders.add(key);
        mapOverride[key] = { code: `0xef0100${op.eip7702Auth.address.slice(2)}` as Hex };
    }
    const useAuth = Object.keys(mapOverride).length > 0;

    const [nonce, fees, gas] = await Promise.all([
        publicClient.getTransactionCount({ address: account.address }),
        estimateGasFees(),
        useAuth
            ? (async () => {
                  const g = await publicClient.request({
                      method: "eth_estimateGas",
                      params: [{ from: account.address, to: config.entryPoint, data }, "latest", mapOverride],
                  });
                  const estimated = BigInt(g as string);
                  // The simulated stateOverride injects the delegation code for free; a
                  // real type-4 tx pays extra to upgrade each sender EOA and to refund
                  // unspent prefund. Add a safety multiplier to cover that overhead.
                  return (estimated * 3n) / 2n;
              })()
            : publicClient.estimateGas({ account, to: config.entryPoint, data }),
    ]);


    const serialized = await withTimeout(
        walletClient.signTransaction({
            account,
            chain: config.chain,
            type: "eip7702",
            to: config.entryPoint,
            data,
            nonce,
            gas,
            maxFeePerGas: fees.maxFeePerGas,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
            authorizationList: auths,
        }),
        HANDLE_OPS_TIMEOUT_MS,
        "handleOps sign (eip7702)",
    );

    const hash = await withTimeout(
        walletClient.sendRawTransaction({ serializedTransaction: serialized }),
        HANDLE_OPS_TIMEOUT_MS,
        "handleOps (eip7702)",
    );
    return hash;
}

/**
 * Submit aggregated UserOperations via handleAggregatedOps.
 *
 * Used for signature aggregation workflows where multiple UserOperations
 * share a single aggregated signature.
 */
export async function handleAggregatedOps(
    ops: UserOperation[],
    aggregator: `0x${string}`,
    aggregatorSignature: Hex,
): Promise<`0x${string}`> {
    const hash = await withTimeout(
        walletClient.writeContract({
            address: config.entryPoint,
            abi: entryPointAbi,
            functionName: "handleAggregatedOps",
            args: [
                [
                    {
                        aggregator,
                        validationGasLimit: DEFAULT_AGGREGATOR_VALIDATION_GAS,
                        validationData: "0x",
                        signature: aggregatorSignature,
                        userOps: ops,
                    },
                ],
                account.address,
            ],
        }),
        HANDLE_OPS_TIMEOUT_MS,
        "handleAggregatedOps",
    );

    return hash;
}
