import type { UserOperation, RawUserOperation } from "./types.js";

/**
 * Validate that a value is a 0x-prefixed hex string of exactly N bytes.
 */
function isHexString(value: unknown, byteLength?: number): value is string {
    if (typeof value !== "string" || !value.startsWith("0x")) return false;
    const hex = value.slice(2);
    if (hex.length % 2 !== 0) return false;
    if (!/^[0-9a-fA-F]*$/.test(hex)) return false;
    if (byteLength !== undefined && hex.length !== byteLength * 2) return false;
    return true;
}

/**
 * Validate that a value is a valid Ethereum address (0x + 40 hex chars).
 */
function isAddress(value: unknown): value is string {
    return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Validate that a value is a valid bigint-compatible nonce (bigint or hex string).
 */
function isValidNonce(value: unknown): value is bigint | string {
    if (typeof value === "bigint") return true;
    if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return true;
    return false;
}

export interface ValidationError {
    field: string;
    message: string;
}

/**
 * Validate a raw UserOperation object (as received from JSON-RPC).
 * Returns an array of validation errors. Empty array = valid.
 */
export function validateUserOperation(raw: RawUserOperation): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!raw || typeof raw !== "object") {
        return [{ field: "userOp", message: "UserOperation must be a JSON object" }];
    }

    // sender — required address
    if (!isAddress(raw.sender)) {
        errors.push({ field: "sender", message: `Invalid address: ${JSON.stringify(raw.sender)}` });
    }

    // nonce — required bigint/hex
    if (!isValidNonce(raw.nonce)) {
        errors.push({ field: "nonce", message: `Invalid nonce: ${JSON.stringify(raw.nonce)}` });
    }

    // initCode — required hex string
    if (!isHexString(raw.initCode)) {
        errors.push({ field: "initCode", message: `Invalid hex: ${JSON.stringify(raw.initCode)}` });
    }

    // callData — required hex string
    if (!isHexString(raw.callData)) {
        errors.push({ field: "callData", message: `Invalid hex: ${JSON.stringify(raw.callData)}` });
    }

    // accountGasLimits — required bytes32 (32 bytes = 64 hex chars)
    if (!isHexString(raw.accountGasLimits, 32)) {
        errors.push({
            field: "accountGasLimits",
            message: `Must be 0x + 64 hex chars (bytes32), got: ${JSON.stringify(raw.accountGasLimits)}`,
        });
    }

    // preVerificationGas — required bigint/hex
    if (!isValidNonce(raw.preVerificationGas)) {
        errors.push({
            field: "preVerificationGas",
            message: `Invalid value: ${JSON.stringify(raw.preVerificationGas)}`,
        });
    }

    // gasFees — required bytes32
    if (!isHexString(raw.gasFees, 32)) {
        errors.push({
            field: "gasFees",
            message: `Must be 0x + 64 hex chars (bytes32), got: ${JSON.stringify(raw.gasFees)}`,
        });
    }

    // paymasterAndData — required hex string
    if (!isHexString(raw.paymasterAndData)) {
        errors.push({
            field: "paymasterAndData",
            message: `Invalid hex: ${JSON.stringify(raw.paymasterAndData)}`,
        });
    }

    // signature — required hex string
    if (!isHexString(raw.signature)) {
        errors.push({
            field: "signature",
            message: `Invalid hex: ${JSON.stringify(raw.signature)}`,
        });
    }

    return errors;
}

/**
 * Convert a raw UserOperation (with hex string nonce/preVerificationGas) to the
 * typed UserOperation with bigint fields.
 */
export function parseUserOperation(raw: RawUserOperation): UserOperation {
    return {
        sender: raw.sender as `0x${string}`,
        nonce: typeof raw.nonce === "bigint" ? raw.nonce : BigInt(raw.nonce as string),
        initCode: raw.initCode as `0x${string}`,
        callData: raw.callData as `0x${string}`,
        accountGasLimits: raw.accountGasLimits as `0x${string}`,
        preVerificationGas:
            typeof raw.preVerificationGas === "bigint"
                ? raw.preVerificationGas
                : BigInt(raw.preVerificationGas as string),
        gasFees: raw.gasFees as `0x${string}`,
        paymasterAndData: raw.paymasterAndData as `0x${string}`,
        signature: raw.signature as `0x${string}`,
    };
}
