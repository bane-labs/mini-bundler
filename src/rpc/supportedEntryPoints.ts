/**
 * eth_supportedEntryPoints — returns the configured EntryPoint address.
 */

import { config } from "../config.js";

export function getSupportedEntryPoints(): `0x${string}`[] {
    return [config.entryPoint];
}
