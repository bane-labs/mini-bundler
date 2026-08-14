import { encodeFunctionData, decodeFunctionResult, type Hex } from "viem";
import { callEth, type AccountOverride } from "./callEth.js";

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

    const auth = userOp.eip7702Auth;
    const overrides: Record<string, AccountOverride> = {
        [config.entryPoint.toLowerCase()]: { code: EntryPointSimulationsCode },
    };
    if (auth) {
        overrides[userOp.sender.toLowerCase()] = {
            // Delegation designator (0xef0100 + implementation). eth_call does
            // not execute tx-level authorizations, so we simulate the EOA as
            // already upgraded. Inject balance so it can cover prefund.
            code: `0xef0100${auth.address.slice(2)}` as Hex,
            balance: 10n * 10n ** 18n,
        };
    }
    try {
        const result = await callEth(config.entryPoint, data, overrides);
        if (!result || result === "0x") {
            return { success: true };
        }

        const decoded = decodeFunctionResult({
            abi: entryPointSimulationsAbi,
            functionName: "simulateHandleOp",
            data: result as Hex,
        }) as unknown as {
            preOpGas: bigint;
            paid: bigint;
            accountValidationData: bigint;
            paymasterValidationData: bigint;
            targetSuccess: boolean;
            targetResult: `0x${string}`;
        };
        const decArr = Array.isArray(decoded) ? decoded : [decoded];
        const d0 = decArr[0] ?? {};
        const execResult = {
            preOpGas: d0.preOpGas ?? 0n,
            paid: d0.paid ?? 0n,
            accountValidationData: d0.accountValidationData ?? 0n,
            paymasterValidationData: d0.paymasterValidationData ?? 0n,
            targetSuccess: d0.targetSuccess ?? true,
            targetResult: d0.targetResult ?? "0x",
        };
        const preOpGas = execResult.preOpGas;
        const paid = execResult.paid;
        const accountValidationData = execResult.accountValidationData;
        const paymasterValidationData = execResult.paymasterValidationData;
        const targetSuccess = execResult.targetSuccess;
        const targetResult = execResult.targetResult;

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
            const decodedErr = decodeCallRevert(error);
            return {
                success: false,
                reason: decodedErr.reason,
                decodedError: decodedErr.decodedError,
                rawRevertData: decodedErr.rawRevertData,
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
