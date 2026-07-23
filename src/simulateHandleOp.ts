import { encodeFunctionData, decodeFunctionResult, type Hex } from "viem";

import { publicClient } from "./clients.js";
import { config } from "./config.js";
import { entryPointSimulationsAbi, EntryPointSimulationsCode } from "./abi.js";
import type { UserOperation } from "./types.js";
import {
    ExecutionSimulationResult,
    decodeCallRevert,
    extractRevertDataFromError,
    decodeRevertData,
} from "./aaErrors.js";

export async function simulateHandleOp(userOp: UserOperation): Promise<ExecutionSimulationResult> {
    const data = encodeFunctionData({
        abi: entryPointSimulationsAbi,
        functionName: "simulateHandleOp",
        args: [userOp, config.entryPoint, "0x"],
    });

    try {
        const result = await publicClient.call({
            to: config.entryPoint,
            data,
            stateOverride: [
                {
                    address: config.entryPoint,
                    code: EntryPointSimulationsCode,
                },
            ],
        });

        if (!result.data || result.data === "0x") {
            return { success: true };
        }

        const decoded = decodeFunctionResult({
            abi: entryPointSimulationsAbi,
            functionName: "simulateHandleOp",
            data: result.data,
        }) as unknown as {
            preOpGas: bigint;
            paid: bigint;
            accountValidationData: bigint;
            paymasterValidationData: bigint;
            targetSuccess: boolean;
            targetResult: `0x${string}`;
        };

        const execResult = Array.isArray(decoded) ? decoded[0] : decoded;

        const preOpGas = execResult.preOpGas ?? 0n;
        const paid = execResult.paid ?? 0n;
        const accountValidationData = execResult.accountValidationData ?? 0n;
        const paymasterValidationData = execResult.paymasterValidationData ?? 0n;
        const targetSuccess = execResult.targetSuccess ?? true;
        const targetResult = execResult.targetResult ?? "0x";

        if (targetSuccess) {
            return {
                success: true,
                targetSuccess: true,
                gasInfo: { preOpGas, paid, accountValidationData, paymasterValidationData },
            };
        }

        const targetError = decodeRevertData(targetResult as Hex);

        return {
            success: false,
            reason: targetError?.message ?? "target execution failed",
            targetSuccess: false,
            targetResult: targetResult as Hex,
            targetError: targetError ?? undefined,
            gasInfo: { preOpGas, paid, accountValidationData, paymasterValidationData },
        };
    } catch (error: unknown) {
        const revertData = extractRevertDataFromError(error);

        if (!revertData) {
            return { success: false, reason: "no revert data", rawRevertData: undefined };
        }

        try {
            const decoded = decodeCallRevert(error);

            return {
                success: false,
                reason: decoded.reason,
                decodedError: decoded.decodedError,
                rawRevertData: decoded.rawRevertData,
            };
        } catch {
            return {
                success: false,
                reason: `decode error: ${(error as Error).message ?? "unknown"}`,
                rawRevertData: revertData,
            };
        }
    }
}
