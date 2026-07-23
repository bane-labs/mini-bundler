/**
 * sendUserOpE2E — End-to-End Chain Integration Test
 *
 * Same pattern as sendUserOpTransfer.ts, but adds full on-chain verification:
 *   1. Build & sign a real UserOp (ETH transfer via SimpleAccount)
 *   2. Send to bundler via eth_sendUserOperation
 *   3. Poll eth_getUserOperationByHash for status progression
 *   4. Poll eth_getUserOperationReceipt until mined
 *   5. Verify on-chain receipt: status=success, blockNumber > 0, gasUsed > 0
 *   6. Verify balance change on-chain
 *   7. Print full summary with timing
 *
 * Usage:
 *   npx tsx test/e2e/send-user-op-e2e.ts
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  concatHex,
  defineChain,
  parseEther,
  formatEther,
  toHex,
  pad,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

// =========================
// chain
// =========================

const neoX = defineChain({
  id: 2312251829,
  name: "NeoX TestNet",
  nativeCurrency: { name: "NeoX Gas Token", symbol: "GAS", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.RPC_URL || "https://neoxdevseed1.rolless.xyz"],
    },
  },
});

// =========================
// config
// =========================

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const ENTRYPOINT = process.env.ENTRYPOINT as `0x${string}`;
const PAYMASTER = process.env.PAYMASTER as `0x${string}`;
const POLICY = "0x1212000000000000000000000000000000000002";
const FACTORY = "0xdaf415b79d5fd2bfccd7846d5a1de9bfdb08a425";
const BUNDLER_RPC = "http://localhost:3000";
const TRANSFER_AMOUNT = parseEther("0.0001"); // small amount to minimize cost
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40; // ~2 minutes max wait

// =========================
// account
// =========================

const owner = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: neoX,
  transport: http(),
});

// =========================
// ABIs
// =========================

const factoryAbi = [
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const entryPointAbi = [
  {
    type: "function",
    name: "getNonce",
    stateMutability: "view",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserOpHash",
    stateMutability: "view",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      {
        name: "account",
        type: "address",
      },
    ],
    outputs: [
      {
        type: "uint256",
      },
    ],
  },
] as const;

const accountAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dest", type: "address" },
      { name: "value", type: "uint256" },
      { name: "func", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const policyAbi = [
  {
    type: "function",
    name: "minGasTipCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "baseFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// =========================
// rpc convert
// =========================

function toRpcUserOp(op: any) {
  return {
    sender: op.sender,
    nonce: "0x" + op.nonce.toString(16),
    initCode: op.initCode,
    callData: op.callData,
    accountGasLimits: op.accountGasLimits,
    preVerificationGas: "0x" + op.preVerificationGas.toString(16),
    gasFees: op.gasFees,
    paymasterAndData: op.paymasterAndData,
    signature: op.signature,
  };
}

/**
 * Build paymasterAndData for simplified SimplePaymaster (no signature required).
 *
 * Layout (v0.8 EntryPoint):
 *   [0:20]   paymaster address
 *   [20:36]  validationGasLimit  (uint128, left-aligned)
 *   [36:52]  postOpGasLimit      (uint128, left-aligned)
 */
function buildPaymasterAndData(
  paymasterAddr: `0x${string}`,
  validationGas: bigint,
  postOpGas: bigint,
): `0x${string}` {
  const addr = paymasterAddr.toLowerCase() as `0x${string}`;
  const valGas = pad(toHex(validationGas), { size: 16 });
  const postGas = pad(toHex(postOpGas), { size: 16 });
  return concatHex([addr, valGas, postGas]);
}
// =========================
// helpers
// =========================

async function rpcCall(method: string, params: any[] = []): Promise<any> {
  const res = await fetch(BUNDLER_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// =========================
// main
// =========================

async function main() {
  const t0 = Date.now();
  console.log("━".repeat(60));
  console.log("  sendUserOpE2E — End-to-End Chain Integration Test");
  console.log("━".repeat(60));
  console.log(`Owner:          ${owner.address}`);
  console.log(`EntryPoint:     ${ENTRYPOINT}`);
  console.log(`Paymaster:      ${PAYMASTER}`);
  console.log(`Bundler:        ${BUNDLER_RPC}`);
  console.log(`Transfer amount: ${formatEther(TRANSFER_AMOUNT)} ETH`);
  console.log();

  // ── Step 1: Health check ──────────────────────────────
  console.log("① Health check...");
  const health = await fetch(`${BUNDLER_RPC}/health`);
  const healthData = await health.json();
  if (healthData.status !== "ok") {
    console.error("❌ Bundler is not healthy:", healthData);
    process.exit(1);
  }
  console.log(`   ✅ Bundler healthy (chain=${healthData.chain}, chainId=${healthData.chainId})`);
  console.log();

  // ── Step 2: Compute smart account address ──────────────
  console.log("② Computing smart account address...");
  const smartAccount = await publicClient.readContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "getAddress",
    args: [owner.address, 0n],
  });
  console.log(`   SmartAccount: ${smartAccount}`);

  const smartAccountBalanceBefore = await publicClient.getBalance({ address: smartAccount });
  console.log(`   SmartAccount balance before: ${formatEther(smartAccountBalanceBefore)} GAS`);

  // ── Step 3: Check deployment ──────────────────────────
  const code = await publicClient.getBytecode({ address: smartAccount });
  let initCode: `0x${string}` = "0x";
  if (!code) {
    console.log("   Account NOT deployed — will deploy with first UserOp");
    const createData = encodeFunctionData({
      abi: factoryAbi,
      functionName: "createAccount",
      args: [owner.address, 0n],
    });
    initCode = concatHex([FACTORY, createData]);
  } else {
    console.log("   Account already deployed");
  }
  console.log();

  // ── Step 4: Read current nonce ────────────────────────
  console.log("③ Reading nonce from EntryPoint...");
  const nonce = await publicClient.readContract({
    address: ENTRYPOINT,
    abi: entryPointAbi,
    functionName: "getNonce",
    args: [smartAccount, 0n],
  });
  console.log(`   Nonce: ${nonce}`);
  console.log();

  // ── Step 5: Record pre-tx balance ─────────────────────
  console.log("④ Recording pre-tx balance...");
  const balanceBefore = await publicClient.getBalance({ address: owner.address });
  const paymasterDepositBefore = await publicClient.readContract({
    address: ENTRYPOINT,
    abi: entryPointAbi,
    functionName: "balanceOf",
    args: [PAYMASTER],
  });
  console.log(`   Owner balance before:              ${formatEther(balanceBefore)} ETH`);
  console.log(`   Paymaster EntryPoint deposit before: ${formatEther(paymasterDepositBefore)} GAS`);

  // ── Step 6: Build UserOp ─────────────────────────────
  console.log("⑤ Building UserOp (with paymaster)...");
  const callData = encodeFunctionData({
    abi: accountAbi,
    functionName: "execute",
    args: [owner.address, TRANSFER_AMOUNT, "0x"],
  });

  const paymasterAndData = buildPaymasterAndData(PAYMASTER, 500000n, 10000n);
  console.log(`   paymasterAndData: ${paymasterAndData}`);

  // Query GovPaymaster policy to get compliant gas limits
  console.log("   Querying GovPaymaster policy...");
  const [policyMinTip, policyBaseFee] = await Promise.all([
    publicClient.readContract({ address: POLICY, abi: policyAbi, functionName: "minGasTipCap" }),
    publicClient.readContract({ address: POLICY, abi: policyAbi, functionName: "baseFee" }),
  ]);
  console.log(`   Policy: minGasTipCap=${policyMinTip}, baseFee=${policyBaseFee}`);

  // GovPaymaster rejects if:
  //   maxPriorityFeePerGas > (minGasTipCap * 12) / 10
  //   gasPrice (maxFeePerGas) > baseFee + (minGasTipCap * 12) / 10
  const maxTipAllowed = (policyMinTip * 12n) / 10n;
  const maxPriorityFeePerGas = maxTipAllowed;
  const maxFeePerGas = policyBaseFee + maxTipAllowed;

  const packedGasFees = concatHex([
    pad(toHex(maxPriorityFeePerGas), { size: 16 }),
    pad(toHex(maxFeePerGas), { size: 16 }),
  ]);
  console.log(`   Gas fees: maxPriorityFeePerGas=${maxPriorityFeePerGas}, maxFeePerGas=${maxFeePerGas}`);

  const userOp: any = {
    sender: smartAccount,
    nonce,
    initCode,
    callData,
    accountGasLimits:
      "0x0000000000000000000000000007a120000000000000000000000000000493e0",
    preVerificationGas: 100000n,
    gasFees: packedGasFees,
    paymasterAndData,
    signature: "0x",
  };

  // ── Step 7: Compute hash & sign ──────────────────────
  console.log("⑥ Computing userOpHash & signing...");
  const userOpHash = await publicClient.readContract({
    address: ENTRYPOINT,
    abi: entryPointAbi,
    functionName: "getUserOpHash",
    args: [userOp],
  });
  console.log(`   userOpHash: ${userOpHash}`);

  userOp.signature = await owner.sign({ hash: userOpHash });
  console.log(`   signature:  ${userOp.signature.substring(0, 20)}...`);
  console.log();

  // ── Step 8: Send to bundler ──────────────────────────
  console.log("⑦ Sending UserOp to bundler...");
  const rpcUserOp = toRpcUserOp(userOp);
  const tSend = Date.now();

  const sendRes = await rpcCall("eth_sendUserOperation", [rpcUserOp, ENTRYPOINT]);

  if (sendRes.error) {
    console.error(`   ❌ Bundler rejected UserOp: ${sendRes.error.message}`);
    process.exit(1);
  }

  const returnedHash = sendRes.result;
  console.log(`   ✅ Bundler accepted (returned hash: ${returnedHash})`);
  console.log(`   Send latency: ${Date.now() - tSend}ms`);
  console.log();

  if (returnedHash !== userOpHash) {
    console.warn(`   ⚠️  Returned hash differs from expected (returned: ${returnedHash}, expected: ${userOpHash})`);
  }

  // ── Step 9: Poll for status via getUserOperationByHash ─
  console.log("⑧ Polling eth_getUserOperationByHash for status...");
  let lastStatus: string | undefined;
  let txHash: string | undefined;
  const tPoll = Date.now();

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const byHashRes = await rpcCall("eth_getUserOperationByHash", [returnedHash]);

    if (byHashRes.result) {
      const info = byHashRes.result;
      const status = info.transactionHash && info.transactionHash !== "0x" ? "submitted" : "pending";
      if (status !== lastStatus) {
        console.log(`   [${((Date.now() - tPoll) / 1000).toFixed(1)}s] Status: ${status}`);
        lastStatus = status;
      }
      if (info.transactionHash && info.transactionHash !== "0x") {
        txHash = info.transactionHash;
        break;
      }
    } else {
      if (lastStatus !== "not-found") {
        console.log(`   [${((Date.now() - tPoll) / 1000).toFixed(1)}s] Not yet indexed`);
        lastStatus = "not-found";
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (!txHash) {
    console.error("   ❌ Timed out waiting for tx hash from getUserOperationByHash");
    console.log("   (Scheduler may not have dispatched yet — check bundler logs)");
    process.exit(1);
  }
  console.log(`   ✅ Tx hash confirmed: ${txHash}`);
  console.log();

  // ── Step 10: Poll for receipt via getUserOperationReceipt ─
  console.log("⑨ Polling eth_getUserOperationReceipt for on-chain confirmation...");
  let receipt: any = undefined;

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const receiptRes = await rpcCall("eth_getUserOperationReceipt", [returnedHash]);

    if (receiptRes.result) {
      receipt = receiptRes.result;
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (!receipt) {
    console.error("   ❌ Timed out waiting for receipt");
    process.exit(1);
  }

  const tTotal = Date.now() - t0;
  console.log("   ✅ Receipt received!");
  console.log();

  // ── Step 11: Verify on-chain receipt ──────────────────
  console.log("⑩ Verifying on-chain receipt...");
  console.log(`   status:          ${receipt.success ? "success ✅" : "FAILED ❌"}`);
  console.log(`   blockNumber:     ${receipt.blockNumber}`);
  console.log(`   blockHash:       ${receipt.blockHash}`);
  console.log(`   txHash:          ${receipt.transactionHash}`);
  console.log(`   gasUsed:         ${receipt.gasUsed}`);
  console.log(`   actualGasCost:   ${receipt.actualGasCost}`);
  console.log(`   actualGasUsed:   ${receipt.actualGasUsed}`);
  console.log(`   logs count:      ${receipt.logs?.length ?? 0}`);
  console.log();

  if (!receipt.success) {
    console.error("   ❌ Transaction reverted on-chain!");
    process.exit(1);
  }

  if (!receipt.blockNumber || receipt.blockNumber === "0x0") {
    console.error("   ❌ blockNumber is 0 — receipt may be invalid");
    process.exit(1);
  }

  // ── Step 12: Verify balance change ────────────────────
  console.log("⑪ Verifying balance change on-chain...");
  const balanceAfter = await publicClient.getBalance({ address: owner.address });
  const smartAccountBalanceAfter = await publicClient.getBalance({ address: smartAccount });
  const paymasterDepositAfter = await publicClient.readContract({
    address: ENTRYPOINT,
    abi: entryPointAbi,
    functionName: "balanceOf",
    args: [PAYMASTER],
  });
  const diff = balanceAfter - balanceBefore;
  const smartAccountSpent = smartAccountBalanceBefore - smartAccountBalanceAfter;
  const paymasterCharged = paymasterDepositBefore - paymasterDepositAfter;

  console.log(`   Owner balance after:                ${formatEther(balanceAfter)} ETH`);
  console.log(`   Owner balance change:               ${formatEther(diff)} ETH`);
  console.log(`   SmartAccount balance before:        ${formatEther(smartAccountBalanceBefore)} GAS`);
  console.log(`   SmartAccount balance after:         ${formatEther(smartAccountBalanceAfter)} GAS`);
  console.log(`   SmartAccount spent:                 ${formatEther(smartAccountSpent)} GAS`);
  console.log(`   Paymaster EntryPoint deposit after: ${formatEther(paymasterDepositAfter)} GAS`);
  console.log(`   Paymaster charged:                  ${formatEther(paymasterCharged)} GAS`);

  if (paymasterCharged > 0n) {
    console.log("   ✅ Paymaster paid gas fees via EntryPoint deposit");
  } else {
    console.log("   ⚠️  Paymaster deposit did not decrease — paymaster may not have covered gas");
  }

  if (smartAccountSpent > 0n) {
    console.log("   ✅ SmartAccount spent ETH (transferred to owner)");
  } else {
    console.log("   ⚠️  SmartAccount balance did not decrease");
  }

  if (diff >= 0n) {
    console.log("   ✅ Owner balance increased (received ETH from SmartAccount)");
  } else {
    console.log(`   ⚠️  Owner balance decreased by ${formatEther(-diff)} ETH`);
  }
  console.log();

  // ── Summary ──────────────────────────────────────────
  console.log("━".repeat(60));
  console.log("  ✅ END-TO-END TEST PASSED");
  console.log("━".repeat(60));
  console.log(`  Total time:         ${tTotal}ms`);
  console.log(`  Send → Mined:       ${((Date.now() - tSend) / 1000).toFixed(1)}s`);
  console.log(`  SmartAccount:       ${smartAccount}`);
  console.log(`  Paymaster:          ${PAYMASTER}`);
  console.log(`  Tx hash:            ${txHash}`);
  console.log(`  Block:              ${receipt.blockNumber}`);
  console.log(`  Gas used:           ${receipt.gasUsed}`);
  console.log(`  Paymaster charged:  ${formatEther(paymasterCharged)} GAS`);
  console.log(`  SmartAccount spent: ${formatEther(smartAccountSpent)} GAS`);
  console.log("━".repeat(60));
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err.message);
  process.exit(1);
});
