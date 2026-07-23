import { createPublicClient, createWalletClient, http } from "viem";

import { privateKeyToAccount } from "viem/accounts";

import { config } from "./config.js";

const account = privateKeyToAccount(config.privateKey);

export const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
});

export const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
});

export { account };
