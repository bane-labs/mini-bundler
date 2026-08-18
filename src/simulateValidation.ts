import { encodeFunctionData, decodeFunctionResult, type Hex } from "viem";
import { callEth, type AccountOverride } from "./callEth.js";

import { config } from "./config.js";
import { entryPointSimulationsAbi, EntryPointSimulationsCode } from "./abi.js";
import type { UserOperation } from "./types.js";
import { ValidationSimulationResult, extractRevertDataFromError, decodeRevertData } from "./aaErrors.js";

/**
 * Aggregator address encoded in the low 160 bits of accountValidationData
 * when a signature aggregator (or failure marker) is set.
 * SIG_VALIDATION_FAILED (1) means the account signature check failed;
 * SIG_VALIDATION_SUCCESS (0) means it passed.
 */
const SIG_VALIDATION_FAILED = 1n;
const SIG_VALIDATION_SUCCESS = 0n;
const ADDRESS_MASK = (1n << 160n) - 1n;

/**
 * A signature-while-editing / malformed result must never be accepted.
 * Parse the ValidationResult returned by simulateValidation. Even though the
 * contract call does not revert on a failed account signature (EntryPoint
 * surfaces sigFailed via ReturnInfo.accountValidationData), the bundler must
 * reject the op when the low 160 bits equal SIG_VALIDATION_FAILED.
 */
export async function simulateValidation(userOp: UserOperation): Promise<ValidationSimulationResult> {
    const data = encodeFunctionData({
        abi: entryPointSimulationsAbi,
        functionName: "simulateValidation",
        args: [userOp],
    });

    const auth = userOp.eip7702Auth;
    const overrides: Record<string, AccountOverride> = {
        [config.entryPoint.toLowerCase()]: { code: EntryPointSimulationsCode },
    };
    if (auth) {
        overrides[userOp.sender.toLowerCase()] = {
            // Delegation designator (0xef0100 + implementation). eth_call does
            // not execute tx-level authorizations, so we simulate the EOA as
            // already upgraded. Do NOT inject a fake balance — a 0-balance
            // sender with no paymaster must fail AA21 (prefund unpayable).
            code: `0xef0100${auth.address.slice(2)}` as Hex,
        };
    }
    try {
        const result = await callEth(config.entryPoint, data, overrides);
        // A successful (non-reverting) call still carries the account's
        // validation data. Decode it and reject signature-failed results.
        if (!result || result === "0x") {
            return { success: false, reason: "simulateValidation returned no data" };
        }

        const decoded = decodeFunctionResult({
            abi: entryPointSimulationsAbi,
            functionName: "simulateValidation",
            data: result as Hex,
        }) as unknown as {
            returnInfo?: {
                accountValidationData?: bigint;
                paymasterValidationData?: bigint;
            };
        };

        const accountValidationData = decoded?.returnInfo?.accountValidationData ?? 0n;
        const aggregator = accountValidationData & ADDRESS_MASK;

        if (aggregator === SIG_VALIDATION_FAILED) {
            return { success: false, reason: "AA24 signature error" };
        }

        return {
            success: true,
            validationData: decoded,
            aggregated: aggregator !== SIG_VALIDATION_SUCCESS && aggregator !== SIG_VALIDATION_FAILED,
        };
    } catch (error: unknown) {
        const revertData = extractRevertDataFromError(error);

        if (!revertData) {
            return { success: false, reason: "no revert data", rawRevertData: undefined };
        }

        const decoded = decodeRevertData(revertData);

        if (!decoded) {
            return { success: false, reason: "unable to decode revert data", rawRevertData: revertData };
        }

        if (decoded.errorName === "FailedOp" || decoded.errorName === "FailedOpWithRevert") {
            return { success: false, reason: decoded.message, decodedError: decoded, rawRevertData: revertData };
        }

        if (decoded.errorName === "PostOpReverted") {
            return { success: false, reason: decoded.message, decodedError: decoded, rawRevertData: revertData };
        }

        // A reverted simulateValidation call must never be treated as success.
        // Only a clean non-reverting call yields a successful validation result.
        return {
            success: false,
            reason: decoded.message ?? decoded.errorName,
            decodedError: decoded,
            rawRevertData: revertData,
        };
    }
}
