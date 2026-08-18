import { verifyAuthorization } from "viem/utils";
import { publicClient } from "./clients.js";
import { config } from "./config.js";
import { BundlerRpcError } from "./aaErrors.js";
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

    // eip7702Auth — optional EIP-7702 authorization object
    if (raw.eip7702Auth !== undefined) {
        const auth = raw.eip7702Auth as Record<string, unknown>;
        if (!auth || typeof auth !== "object") {
            errors.push({ field: "eip7702Auth", message: "Must be an object" });
        } else {
            if (!isAddress(auth.address)) {
                errors.push({ field: "eip7702Auth.address", message: `Invalid address: ${JSON.stringify(auth.address)}` });
            }
            if (!isValidNonce(auth.chainId)) {
                errors.push({ field: "eip7702Auth.chainId", message: `Invalid chainId: ${JSON.stringify(auth.chainId)}` });
            }
            if (!isValidNonce(auth.nonce)) {
                errors.push({ field: "eip7702Auth.nonce", message: `Invalid nonce: ${JSON.stringify(auth.nonce)}` });
            }
            if (auth.yParity !== undefined && !isValidNonce(auth.yParity)) {
                errors.push({ field: "eip7702Auth.yParity", message: `Invalid yParity: ${JSON.stringify(auth.yParity)}` });
            }
            if (!isHexString(auth.r, 32)) {
                errors.push({ field: "eip7702Auth.r", message: "Must be 0x + 64 hex chars (32 bytes)" });
            }
            if (!isHexString(auth.s, 32)) {
                errors.push({ field: "eip7702Auth.s", message: "Must be 0x + 64 hex chars (32 bytes)" });
            }
        }
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
        ...(raw.eip7702Auth !== undefined && raw.eip7702Auth !== null
            ? { eip7702Auth: parseEip7702Authorization(raw.eip7702Auth) }
            : {}),
    };
}

/**
 * Convert a raw EIP-7702 authorization (JSON-RPC form) to the typed form.
 */
function parseEip7702Authorization(raw: unknown): import("./types.js").Eip7702Authorization {
    const auth = raw as Record<string, unknown>;
    const toBigInt = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(v as string));
    return {
        address: auth.address as `0x${string}`,
        chainId: toBigInt(auth.chainId),
        nonce: toBigInt(auth.nonce),
        yParity: toBigInt(auth.yParity ?? 0n),
        r: auth.r as `0x${string}`,
        s: auth.s as `0x${string}`,
    };
}

/** secp256k1 curve order n. */
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
/** Enforce low-s (non-malleable) signatures: s must be <= n/2. */
const SECP256K1_N_HALF = SECP256K1_N / 2n;

/**
 * Verify an EIP-7702 authorization attached to a UserOp before simulation.
 *
 * Per ERC-4337 / EIP-7702, `eip7702Auth` MUST be a valid EIP-7702 authorization
 * tuple signed by the sender. We enforce:
 *   1. low-s (s <= n/2) — non-malleable signature
 *   2. chainId matches the bundler chain, or is 0 (valid on any chain)
 *   3. nonce equals the sender's current tx nonce (the one the upgrade spends)
 *   4. recovered signer == userOp.sender
 *   5. if the sender already has code, it must be an EIP-7702 delegation
 *      designator (0xef0100 + delegate) — a contract or otherwise-non-delegated
 *      sender cannot be upgraded, so its op would fail on-chain.
 *
 * Throws a BundlerRpcError (code -32602 invalid params) on any failure.
 */
export async function verifyEip7702Auth(userOp: UserOperation): Promise<void> {
    const auth = userOp.eip7702Auth;
    if (!auth) return;

    // 1. Low-s: reject s > n/2 (malleable) per EIP-2. A real signer via viem/
    //    ethers always produces low-s, so a high-s value is a tampered/forged sig.
    if (BigInt(auth.s) > SECP256K1_N_HALF) {
        throw new BundlerRpcError(-32602, "eip7702Auth.s must be low-s (s <= n/2)");
    }

    // 2. chainId: must equal the bundler chain, or 0 (valid on any chain, EIP-7702).
    if (auth.chainId !== 0n && auth.chainId !== BigInt(config.chain.id)) {
        throw new BundlerRpcError(
            -32602,
            `eip7702Auth.chainId ${auth.chainId} does not match current chain ${config.chain.id}`,
        );
    }

    // 3. nonce: must equal the sender's current tx nonce (the EOA's own nonce
    //    that the type-4 upgrade transaction will spend).
    const senderNonce = await publicClient.getTransactionCount({
        address: userOp.sender,
        blockTag: "pending",
    });
    if (auth.nonce !== BigInt(senderNonce)) {
        throw new BundlerRpcError(
            -32602,
            `eip7702Auth.nonce ${auth.nonce} does not match sender tx nonce ${senderNonce}`,
        );
    }

    // 4. Signer recovery: the recovered address of the authorization signature
    //    must equal the UserOp sender.
    const valid = await verifyAuthorization({
        address: userOp.sender,
        authorization: {
            address: auth.address,
            chainId: Number(auth.chainId),
            nonce: Number(auth.nonce),
            yParity: Number(auth.yParity),
            r: auth.r,
            s: auth.s,
        },
    });
    if (!valid) {
        throw new BundlerRpcError(-32602, "eip7702Auth was not signed by the UserOp sender");
    }

    // 5. Sender code: the EntryPoint reads the sender's code via extcodecopy
    //    and requires it to be an EIP-7702 delegation designator (0xef0100 +
    //    delegate). A sender that already has OTHER code (a deployed contract,
    //    or a non-delegation account) cannot be upgraded by the type-4 auth and
    //    its op would revert on-chain with Eip7702SenderNotDelegate. A fresh EOA
    //    (no code) or an already-delegated account is fine.
    const senderCode = await publicClient.getCode({ address: userOp.sender });
    if (senderCode && senderCode !== "0x" && !senderCode.startsWith("0xef0100")) {
        throw new BundlerRpcError(
            -32602,
            `eip7702Auth cannot upgrade sender ${userOp.sender}: address already has code that is not an EIP-7702 delegation designator`,
        );
    }
}
