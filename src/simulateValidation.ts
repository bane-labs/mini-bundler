import { encodeFunctionData, decodeErrorResult, type Hex } from "viem";

import { publicClient } from "./clients.js";
import { config } from "./config.js";
import { entryPointSimulationsAbi, EntryPointSimulationsCode } from "./abi.js";
import type { UserOperation } from "./types.js";
import { ValidationSimulationResult, extractRevertDataFromError, decodeRevertData } from "./aaErrors.js";

export async function simulateValidation(userOp: UserOperation): Promise<ValidationSimulationResult> {
    const data = encodeFunctionData({
        abi: entryPointSimulationsAbi,
        functionName: "simulateValidation",
        args: [userOp],
    });

    try {
        await publicClient.call({
            to: config.entryPoint,
            data,
            stateOverride: [
                {
                    address: config.entryPoint,
                    code: EntryPointSimulationsCode,
                },
            ],
        });

        return { success: true };
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

        return {
            success: true,
            validationData: decoded,
            aggregated: decoded.errorName === "ValidationResultWithAggregation",
        };
    }
}
