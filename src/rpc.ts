import type { Request, Response } from "express";

import { Bundler } from "./bundler.js";
import { config } from "./config.js";
import type { UserOperation } from "./types.js";
import { validateUserOperation, parseUserOperation } from "./utils.js";
import {
    estimateUserOperationGas,
    getUserOperationReceipt,
    getUserOperationByHash,
    getSupportedEntryPoints,
} from "./rpc/index.js";
import { checkIpRateLimit, checkSenderRateLimit, validateUserOpSecurity } from "./security/index.js";
import { metrics } from "./metrics/index.js";
import { logger, childLogger } from "./logging/index.js";

const bundler = new Bundler();

function rpcError(res: Response, id: number | string | null, code: number, message: string) {
    return res.json({
        jsonrpc: "2.0",
        id,
        error: { code, message },
    });
}

function bigIntReplacer(_key: string, value: unknown): unknown {
    if (typeof value === "bigint") {
        return "0x" + value.toString(16);
    }
    return value;
}

function rpcResult(res: Response, id: number | string | null, result: unknown) {
    const body = JSON.stringify(
        {
            jsonrpc: "2.0",
            id,
            result,
        },
        bigIntReplacer,
    );
    res.setHeader("Content-Type", "application/json");
    return res.send(body);
}

export async function rpcHandler(req: Request, res: Response) {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const { id, method, params } = req.body;

    if (id === undefined) {
        return rpcError(res, null, -32600, "Missing required field: id");
    }
    if (typeof method !== "string") {
        return rpcError(res, id, -32600, "Missing or invalid field: method");
    }
    if (!Array.isArray(params)) {
        return rpcError(res, id, -32600, "Missing or invalid field: params (must be array)");
    }

    // IP rate limiting
    const ipCheck = checkIpRateLimit(clientIp);
    if (!ipCheck.allowed) {
        logger.warn(`Rate limit exceeded for IP ${clientIp}`, { method });
        return rpcError(res, id, -32000, `Rate limit exceeded. Retry after ${Math.ceil(ipCheck.retryAfterMs / 1000)}s`);
    }

    try {
        switch (method) {
            // ========================
            // EIP-4337 Standard Methods
            // ========================

            case "eth_supportedEntryPoints": {
                return rpcResult(res, id, getSupportedEntryPoints());
            }

            case "eth_sendUserOperation": {
                const entryPointParam = params[1] as string | undefined;
                if (entryPointParam) {
                    const normalized = entryPointParam.toLowerCase();
                    if (normalized !== config.entryPoint.toLowerCase()) {
                        return rpcError(
                            res,
                            id,
                            -32602,
                            `Unsupported entryPoint: ${entryPointParam}. Supported: ${config.entryPoint}`,
                        );
                    }
                }

                const rawUserOp = params[0];

                // Sender rate limiting
                if (rawUserOp?.sender) {
                    const senderCheck = checkSenderRateLimit(rawUserOp.sender);
                    if (!senderCheck.allowed) {
                        logger.warn(`Rate limit exceeded for sender ${rawUserOp.sender}`, {
                            method: "eth_sendUserOperation",
                        });
                        return rpcError(
                            res,
                            id,
                            -32000,
                            `Sender rate limit exceeded. Retry after ${Math.ceil(senderCheck.retryAfterMs / 1000)}s`,
                        );
                    }
                }

                // Security validation
                if (!rawUserOp || typeof rawUserOp !== "object") {
                    return rpcError(res, id, -32602, "Invalid UserOperation: must be a JSON object");
                }
                const securityViolations = validateUserOpSecurity(rawUserOp);
                if (securityViolations.length > 0) {
                    metrics.incValidationFailures();
                    const details = securityViolations.map((v) => `${v.field}: ${v.message}`).join("; ");
                    return rpcError(res, id, -32602, `Security violation: ${details}`);
                }

                const validationErrors = validateUserOperation(rawUserOp);
                if (validationErrors.length > 0) {
                    metrics.incValidationFailures();
                    const details = validationErrors.map((e) => `${e.field}: ${e.message}`).join("; ");
                    return rpcError(res, id, -32602, `Invalid UserOperation: ${details}`);
                }

                const userOp: UserOperation = parseUserOperation(rawUserOp);

                const log = childLogger({
                    sender: userOp.sender,
                    nonce: userOp.nonce,
                    method: "eth_sendUserOperation",
                });
                log.info("Received UserOp");

                const txHash = await bundler.sendUserOperation(userOp);
                log.info(`UserOp submitted`, { txHash });
                return rpcResult(res, id, txHash);
            }

            case "eth_getUserOperationReceipt": {
                const userOpHash = params[0] as `0x${string}`;
                if (!userOpHash || typeof userOpHash !== "string") {
                    return rpcError(res, id, -32602, "Missing or invalid userOpHash");
                }

                const receipt = await getUserOperationReceipt(userOpHash);
                return rpcResult(res, id, receipt);
            }

            case "eth_getUserOperationByHash": {
                const userOpHash = params[0] as `0x${string}`;
                if (!userOpHash || typeof userOpHash !== "string") {
                    return rpcError(res, id, -32602, "Missing or invalid userOpHash");
                }

                const opByHash = await getUserOperationByHash(userOpHash);
                return rpcResult(res, id, opByHash);
            }

            case "eth_estimateUserOperationGas": {
                const rawOp = params[0];
                const ep = params[1] as string | undefined;

                if (ep && ep.toLowerCase() !== config.entryPoint.toLowerCase()) {
                    return rpcError(res, id, -32602, `Unsupported entryPoint: ${ep}`);
                }

                const errors = validateUserOperation(rawOp);
                if (errors.length > 0) {
                    const details = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
                    return rpcError(res, id, -32602, `Invalid UserOperation: ${details}`);
                }

                const parsedOp = parseUserOperation(rawOp);
                const gasEstimate = await estimateUserOperationGas(parsedOp);
                return rpcResult(res, id, gasEstimate);
            }

            // ========================
            // Fallback
            // ========================

            default:
                return rpcError(res, id, -32601, `Method not found: ${method}`);
        }
    } catch (err) {
        metrics.incExecutionFailures();
        logger.error(`RPC error [${method}]: ${err instanceof Error ? err.message : "Unknown error"}`, { method });

        return rpcError(res, id, -32000, err instanceof Error ? err.message : "Unknown error");
    }
}
