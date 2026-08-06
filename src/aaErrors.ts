/** JSON-RPC error raised from bundler logic with a spec-compliant code. */
export class BundlerRpcError extends Error {
    code: number;
    data?: unknown;

    constructor(code: number, message: string, data?: unknown) {
        super(message);
        this.name = "BundlerRpcError";
        this.code = code;
        this.data = data;
    }
}

import { decodeErrorResult, decodeAbiParameters, type Hex } from "viem";
import { decodeErrorReason } from "@account-abstraction/utils";
import { entryPointAbi } from "./abi.js";

export interface DecodedError {
    message: string;
    errorName: string;
    opIndex?: number;
    innerData?: Hex;
}

export interface SimulationResult {
    success: boolean;
    reason?: string;
    decodedError?: DecodedError;
    rawRevertData?: Hex;
}

export interface ValidationSimulationResult extends SimulationResult {
    validationData?: unknown;
    aggregated?: boolean;
}

export interface ExecutionSimulationResult extends SimulationResult {
    targetSuccess?: boolean;
    targetResult?: Hex;
    targetError?: DecodedError;
    gasInfo?: {
        preOpGas: bigint;
        paid: bigint;
        accountValidationData: bigint;
        paymasterValidationData: bigint;
    };
}

const ERROR_STRING_SIG = "0x08c379a0";

export function decodeRevertData(data: Hex): DecodedError | undefined {
    if (!data || data === "0x") return undefined;

    try {
        const result = decodeErrorReason(data);
        if (result) {
            return {
                message: result.message,
                errorName: data.startsWith(ERROR_STRING_SIG) ? "Error" : "FailedOp",
                opIndex: result.opIndex,
            };
        }
    } catch {
        /* fall through */
    }

    try {
        const decoded = decodeErrorResult({ abi: entryPointAbi, data });

        switch (decoded.errorName) {
            case "FailedOp": {
                const args = decoded.args as unknown as { opIndex: bigint; reason: string };
                return { message: `FailedOp: ${args.reason}`, errorName: "FailedOp", opIndex: Number(args.opIndex) };
            }
            case "FailedOpWithRevert": {
                const args = decoded.args as unknown as { opIndex: bigint; reason: string; inner: Hex };
                return {
                    message: `FailedOpWithRevert: ${args.reason}`,
                    errorName: "FailedOpWithRevert",
                    opIndex: Number(args.opIndex),
                    innerData: args.inner,
                };
            }
            case "PostOpReverted": {
                const args = decoded.args as unknown as { returnData: Hex };
                const innerError = decodeRevertData(args.returnData);
                return {
                    message: `PostOpReverted: ${innerError?.message ?? "unknown"}`,
                    errorName: "PostOpReverted",
                    innerData: args.returnData,
                };
            }
            default:
                return { message: decoded.errorName, errorName: decoded.errorName };
        }
    } catch {
        /* fall through */
    }

    try {
        if (data.startsWith(ERROR_STRING_SIG)) {
            const [message] = decodeAbiParameters([{ type: "string" }], ("0x" + data.slice(10)) as Hex);
            return { message, errorName: "Error" };
        }
    } catch {
        /* ignore */
    }

    return { message: `Unknown error: ${data.slice(0, 42)}...`, errorName: "Unknown", innerData: data };
}

export function extractRevertDataFromError(error: unknown): Hex | undefined {
    let e = error as Record<string, unknown> | undefined;

    for (let i = 0; i < 15 && e; i++) {
        const data = e.data;

        if (typeof data === "string" && data.startsWith("0x")) return data as Hex;
        if (typeof (data as Record<string, unknown>)?.data === "string")
            return (data as Record<string, unknown>).data as Hex;
        const cause = (data as Record<string, unknown>)?.cause as Record<string, unknown> | undefined;
        if (typeof cause?.data === "string") {
            return cause.data as Hex;
        }

        e = (e.cause ?? e._originalError ?? e) as Record<string, unknown> | undefined;
    }

    return undefined;
}

export function decodeCallRevert(error: unknown): SimulationResult {
    const revertData = extractRevertDataFromError(error);

    if (!revertData) {
        return { success: false, reason: "no revert data", rawRevertData: undefined };
    }

    const decoded = decodeRevertData(revertData);

    if (!decoded) {
        return { success: false, reason: "unable to decode revert data", rawRevertData: revertData };
    }

    return { success: false, reason: decoded.message, decodedError: decoded, rawRevertData: revertData };
}
