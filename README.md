# Mini Bundler

A production-grade ERC-4337 bundler for NeoX TestNet, built with TypeScript + viem + Foundry.

Implements the full ERC-4337 lifecycle: receive, validate, simulate, bundle, submit, and track `UserOperation` transactions on NeoX TestNet.

## Features

- **ERC-4337 JSON-RPC** — `eth_sendUserOperation`, `eth_estimateUserOperationGas`, `eth_getUserOperationReceipt`, `eth_getUserOperationByHash`, `eth_supportedEntryPoints`
- **Error Handling** — Decodes revert data via `@account-abstraction/utils`, distinguishes validation vs execution failures
- **Profit Protection** — Rejects UserOps where `maxFeePerGas` is too low to cover bundler costs
- **Mempool** — FIFO queue with priority, sender+nonce dedup, replacement policy, expiration timeout
- **Bundle Builder** — Multi-UserOp bundling, configurable max size/gas, partial failure handling
- **Gas Manager** — Dynamic `maxFeePerGas` / `maxPriorityFeePerGas` based on latest block, gas bump, replacement transactions
- **Persistent Storage** — JSON file-based, restart restores pending operations
- **Reputation System** — ERC-4337 compliant, tracks sender/factory/paymaster, temporary banning
- **Rate Limiting** — IP-based and sender-based, configurable windows
- **Security** — Calldata/initCode/paymasterAndData size limits, gas overflow protection
- **Monitoring** — Prometheus-format metrics at `/metrics`
- **Structured Logging** — INFO/WARN/ERROR/DEBUG levels with UserOp context
- **Aggregator** — `handleAggregatedOps` support for signature aggregation

## Architecture

```
src/
├── index.ts                  # Express server entrypoint
├── config.ts                 # Environment config (dotenv)
├── rpc.ts                    # JSON-RPC method dispatcher
├── bundler.ts                # Core bundler: mempool → simulate → profit check → submit → track
├── entrypoint.ts             # EntryPoint contract interaction
├── clients.ts                # viem publicClient / walletClient
├── abi.ts                    # Contract ABIs
├── types.ts                  # TypeScript types (all phases)
├── utils.ts                  # UserOperation validation & parsing
├── aaErrors.ts               # Error decoding via @account-abstraction/utils
├── profit.ts                 # Bundler profit protection (gas cost vs max payment)
├── simulateValidation.ts     # EIP-4337 validation simulation
├── simulateValidationO.ts    # handleOp execution simulation
│
├── rpc/                      # RPC handlers
│   ├── estimateGas.ts        # Real gas estimation via simulation
│   ├── getReceipt.ts         # Full receipt with gas costs & logs
│   ├── getByHash.ts          # UserOp lookup by hash
│   └── supportedEntryPoints.ts
│
├── mempool/                  # Pending queue with priority
├── scheduler/                # Batch dispatch timer
├── bundle/                   # Bundle builder
├── gas/                      # Dynamic gas pricing
├── storage/                  # JSON persistence
├── reputation/               # ERC-4337 reputation tracking
├── security/                 # Rate limiting + validation
├── metrics/                  # Prometheus metrics
├── logging/                  # Structured logger
│
├── contracts/                # Solidity contracts
│   ├── SimplePaymaster.sol   # Accepts all UserOps (no signature check)
│   └── TestToken.sol
│
├── script/
│   └── DeployPaymaster.s.sol
│
└── test/                     # Integration tests
    ├── sendTestNocall.ts            # Initialize SmartAccount (deploy via UserOp)
    ├── sendUserOpE2E.ts             # ETH transfer E2E with paymaster
    ├── sendUserOpERC20Transfer.ts   # ERC20 transfer E2E with paymaster
    ├── qaTestSuite.ts               # Comprehensive QA tests
    └── deployFactory.ts             # Factory deployment script
```

## Quick Start

```bash
npm install
cp .env.example .env        # Fill in your values
npm run dev                  # Start bundler on :3000
```

## Testing

```bash
# Step 1: Initialize SmartAccount (deploy via UserOp, no call)
npx tsx src/test/sendTestNocall.ts

# Step 2: ETH transfer E2E with paymaster (poll + verify receipt + balances)
npx tsx src/test/sendUserOpE2E.ts

# Step 3: ERC20 transfer E2E with paymaster (deploy token + mint + transfer)
npx tsx src/test/sendUserOpERC20Transfer.ts

# QA test suite
npx tsx src/test/qaTestSuite.ts
```

### Test Types

| Test | Description | Requires |
|---|---|---|
| `sendTestNocall.ts` | Initialize SmartAccount — deploy via UserOp with empty callData | Bundler running, NeoX GAS |
| `sendUserOpE2E.ts` | ETH transfer E2E — polls getUserOperationByHash/getUserOperationReceipt, verifies receipt + EntryPoint deposit + SmartAccount/Owner balance | Bundler running, Paymaster deployed |
| `sendUserOpERC20Transfer.ts` | ERC20 E2E — deploys TestToken, mints, transfers via SmartAccount, verifies all balances + paymaster deposit | Bundler running, Paymaster deployed |
| `qaTestSuite.ts` | QA suite — validation, security, rate limiting, metrics, error handling | Bundler running |

## Running

```bash
npm run dev    # Development (auto-reload)
npm run build  # Compile TypeScript
npm start      # Production
```

## Health Check

```bash
curl http://localhost:3000/health
# → {"status":"ok","entryPoint":"0x...","chain":"NeoX TestNet","chainId":2312251829}
```

## Metrics

```bash
curl http://localhost:3000/metrics
# → Prometheus text format
```

## Deploy Paymaster (Foundry)

```bash
# Deploy SimplePaymaster
forge script script/DeployPaymaster.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --with-gas-price 50000000000 \
  --priority-gas-price 25000000000

# Fund paymaster with ETH for gas coverage
cast send $PAYMASTER \
  --value 1000000000000000000 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --gas-price 50000000000 \
  --priority-gas-price 25000000000
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `RPC_URL` | — | NeoX TestNet RPC endpoint |
| `PRIVATE_KEY` | — | Bundler signer private key |
| `ENTRYPOINT` | — | ERC-4337 EntryPoint contract address |
| `PAYMASTER` | — | SimplePaymaster contract address (for paymaster tests) |
| `PORT` | `3000` | Server port |
| `MEMPOOL_MAX_SIZE` | `1000` | Max pending UserOps |
| `MEMPOOL_MAX_PER_SENDER` | `10` | Max ops per sender |
| `BUNDLE_MAX_SIZE` | `10` | Max ops per bundle |
| `BUNDLE_MAX_GAS` | `10000000` | Max gas per bundle |
| `GAS_BUMP_PERCENT` | `20` | Gas bump for replacements |
| `LOG_LEVEL` | `INFO` | DEBUG/INFO/WARN/ERROR |
| `MAX_CALLDATA_LENGTH` | `100000` | Max callData bytes |
| `MAX_INITCODE_LENGTH` | `100000` | Max initCode bytes |
| `MAX_GAS_LIMIT` | `10000000` | Max total gas limit |
| `RATE_LIMIT_IP` | `100` | IP requests per window |
| `RATE_LIMIT_SENDER` | `20` | Sender ops per window |

## Deployed Contracts (NeoX TestNet)

| Contract | Address |
|---|---|
| EntryPoint | `0x433709009B8330FDa32311DF1C2AFA402eD8D009` |
| SimplePaymaster | `0xc44DD8e895162F56c1c3e3D40e0aE6Ec67345408` |
| SmartAccount | `0x36622A7314d9C2f47149e66C9Dd42763686Aab0E` |
| Factory | `0xdaf415b79d5fd2bfccd7846d5a1de9bfdb08a425` |
| Policy | `0x1212000000000000000000000000000000000002` |

---

## Environment Variables (.env)

> **Never commit `.env`** — it contains your private key.

See [`.env.example`](.env.example) for the full template.

## ERC-4337 JSON-RPC Methods

### eth_sendUserOperation

```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "eth_sendUserOperation",
    "params": [
      {
        "sender": "0x...",
        "nonce": "0x0",
        "initCode": "0x",
        "callData": "0x...",
        "accountGasLimits": "0x...",
        "preVerificationGas": "0xc350",
        "gasFees": "0x...",
        "paymasterAndData": "0x",
        "signature": "0x..."
      },
      "0x4337084d9e255ff0702461cf8895ce9e3b5ff108"
    ]
  }'
```

### eth_estimateUserOperationGas

Returns realistic gas estimates via simulation:
```json
{
  "preVerificationGas": "0x...",
  "verificationGasLimit": "0x...",
  "callGasLimit": "0x..."
}
```

### eth_getUserOperationReceipt

Returns full receipt with `actualGasCost`, `actualGasUsed`, `logs`, `blockNumber`, etc.

### eth_getUserOperationByHash

Returns the `UserOperation`, `entryPoint`, `transactionHash`, and block info.

## Request Flow

```
Client → POST /
  ↓
IP Rate Limit check
  ↓
Method dispatch (eth_sendUserOperation, etc.)
  ↓
Sender Rate Limit check
  ↓
Security validation (calldata size, gas overflow, etc.)
  ↓
UserOperation field validation
  ↓
ERC-4337 simulation (simulateValidation + simulateHandleOp)
  ↓
Reputation check (sender banned?)
  ↓
JSON file persistence
  ↓
Mempool enqueue (FIFO + priority)
  ↓
Return userOpHash to client
  ↓
[Background] Scheduler → Bundle Builder → handleOps → on-chain
  ↓
[Background] Wait for receipt → Update status → Record reputation
```

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Blockchain**: viem (ethers-free)
- **Smart Contracts**: Foundry + Solidity 0.8.28
- **Storage**: JSON file-based persistence
- **Server**: Express.js
- **Network**: NeoX TestNet

## License

ISC
