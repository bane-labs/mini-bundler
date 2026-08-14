import { type Address, type Hex } from "viem";

import { publicClient } from "./clients.js";

/** A single account override conforming to the NeoX RPC map format. */
export interface AccountOverride {
    code?: Hex;
    balance?: bigint;
    nonce?: number;
}

/**
 * Make an ETH call against `to` with `data`, applying account overrides using
 * the **map** stateOverride format required by the NeoX RPC.
 *
 * viem's `publicClient.call` serializes `stateOverride` as an array which NeoX
 * silently ignores, so overrides such as the EIP-7702 delegation designator or
 * the EntryPoint simulation code would be dropped. Sending the raw request here
 * guarantees they take effect.
 *
 * Returns the raw returned hex data (may be `0x`).
 */
export async function callEth(
    to: Address,
    data: Hex,
    overrides: Record<string, AccountOverride>,
): Promise<Hex> {
    const map: Record<string, { code?: Hex; balance?: Hex; nonce?: Hex }> = {};
    for (const [addr, o] of Object.entries(overrides)) {
        const key = addr.toLowerCase();
        if (!map[key]) map[key] = {};
        if (o.code) map[key].code = o.code;
        if (o.balance !== undefined) map[key].balance = `0x${o.balance.toString(16)}`;
        if (o.nonce !== undefined) map[key].nonce = `0x${o.nonce.toString(16)}`;
    }
    const result = await publicClient.request({
        method: "eth_call",
        params: [{ to, data }, "latest", map],
    });
    return (result as { data?: Hex }).data ?? (result as Hex);
}
