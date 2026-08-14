# Mini Bundler

A production-grade ERC-4337 bundler for NeoX, built with TypeScript + viem + Foundry.

Implements the full ERC-4337 lifecycle: receive, validate, simulate, bundle, submit, and track `UserOperation` transactions on NeoX.

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
- **Aggregator** — `handleAggregatedOps` low-level support (not exposed via RPC)
- **EIP-7702** — upgrades fresh EOA senders to smart accounts via ERC-7769 `eip7702Auth`: the bundler signs a type-4 transaction and attaches the authorization so the sender is upgraded in the same transaction that executes its first UserOp

## Architecture

```
src/
├── index.ts                  # Express server entrypoint
├── config.ts                 # Environment config (dotenv)
├── constants.ts              # Shared constants (gas, reputation, pre-verification)
├── rpc.ts                    # JSON-RPC method dispatcher
├── bundler.ts                # Core bundler: mempool → simulate → profit check → submit → track
├── entrypoint.ts             # EntryPoint contract interaction (handleOps, handleAggregatedOps)
├── clients.ts                # viem publicClient / walletClient
├── abi.ts                    # Contract ABIs
├── types.ts                  # TypeScript types (all phases)
├── utils.ts                  # UserOperation validation & parsing
├── aaErrors.ts               # Error decoding via @account-abstraction/utils
├── profit.ts                 # Bundler profit protection (gas cost vs max payment)
├── simulateValidation.ts     # EIP-4337 validation simulation
├── simulateHandleOp.ts       # handleOp execution simulation
├── callEth.ts                # Map-format eth_call (NeoX stateOverride) helper
│
├── rpc/                      # RPC handlers
│   ├── index.ts
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
└── logging/                  # Structured logger

contracts/
└── SimplePaymaster.sol       # Accepts all UserOps (no signature check)

script/
└── DeployPaymaster.s.sol     # Foundry deployment script

test/
└── e2e/
    ├── qa-test-suite.ts      # Comprehensive QA tests
    └── send-user-op-e2e.ts   # ETH transfer E2E with paymaster
```

## Quick Start

```bash
# Install dependencies (packageManager: yarn@1.22.22)
yarn install

# Configure environment
cp .env.example .env        # Fill in your values

# Start bundler on :3000
yarn dev
```

> **Requirements**: Node.js >= 20.0.0

## Testing

```bash
# ETH transfer E2E with paymaster (poll + verify receipt + balances)
npx tsx test/e2e/send-user-op-e2e.ts

# QA test suite (validation, security, rate limiting, metrics, error handling)
npx tsx test/e2e/qa-test-suite.ts
```

### Test Types

| Test                  | Description                                                                                                                                 | Requires                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `send-user-op-e2e.ts` | ETH transfer E2E — polls getUserOperationByHash/getUserOperationReceipt, verifies receipt + EntryPoint deposit + SmartAccount/Owner balance | Bundler running, Paymaster deployed |
| `qa-test-suite.ts`    | QA suite — validation, security, rate limiting, metrics, error handling                                                                     | Bundler running                     |

## Running

```bash
yarn dev       # Development (auto-reload via tsx watch)
yarn build     # Compile TypeScript
yarn start     # Production
```

## Health Check

```bash
curl http://localhost:3000/health
# → {"status":"ok","entryPoint":"0x...","chain":"NeoX","chainId":<chain-id>}
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

### Core

| Variable      | Default | Description                                  |
| ------------- | ------- | -------------------------------------------- |
| `RPC_URL`     | —       | NeoX RPC endpoint                             |
| `PRIVATE_KEY` | —       | Bundler signer private key                   |
| `ENTRYPOINT`  | —       | ERC-4337 EntryPoint contract address         |
| `PAYMASTER`   | —       | SimplePaymaster contract address (for tests) |
| `PORT`        | `3000`  | Server port                                  |

### Mempool

| Variable                 | Default  | Description                |
| ------------------------ | -------- | -------------------------- |
| `MEMPOOL_MAX_SIZE`       | `1000`   | Max pending UserOps        |
| `MEMPOOL_MAX_PER_SENDER` | `10`     | Max ops per sender         |
| `MEMPOOL_TIMEOUT_MS`     | `300000` | Pending op expiration (ms) |

### Bundle Builder

| Variable            | Default    | Description                    |
| ------------------- | ---------- | ------------------------------ |
| `BUNDLE_MAX_SIZE`   | `10`       | Max ops per bundle             |
| `BUNDLE_MAX_GAS`    | `10000000` | Max gas per bundle             |
| `BUNDLE_TIMEOUT_MS` | `10000`    | Bundle collection timeout (ms) |

### Gas Manager

| Variable                   | Default       | Description                           |
| -------------------------- | ------------- | ------------------------------------- |
| `MAX_FEE_PER_GAS_CAP`      | `50000000000` | Max fee per gas ceiling (wei)         |
| `MAX_PRIORITY_FEE_CAP`     | `3000000000`  | Max priority fee cap (wei)            |
| `GAS_BUMP_PERCENT`         | `20`          | Gas bump for replacements             |
| `REPLACEMENT_THRESHOLD_MS` | `30000`       | Time before replacement eligible (ms) |
| `PENDING_TX_TIMEOUT_MS`    | `120000`      | Pending tx timeout (ms)               |

### Storage

| Variable  | Default               | Description                |
| --------- | --------------------- | -------------------------- |
| `DB_PATH` | `./bundler-data.json` | JSON persistence file path |

### Rate Limiting

| Variable                      | Default | Description                   |
| ----------------------------- | ------- | ----------------------------- |
| `RATE_LIMIT_IP`               | `100`   | IP requests per window        |
| `RATE_LIMIT_IP_WINDOW_MS`     | `60000` | IP rate limit window (ms)     |
| `RATE_LIMIT_SENDER`           | `20`    | Sender ops per window         |
| `RATE_LIMIT_SENDER_WINDOW_MS` | `60000` | Sender rate limit window (ms) |

### Security

| Variable                    | Default    | Description                    |
| --------------------------- | ---------- | ------------------------------ |
| `MAX_CALLDATA_LENGTH`       | `100000`   | Max callData bytes             |
| `MAX_INITCODE_LENGTH`       | `100000`   | Max initCode bytes             |
| `MAX_PAYMASTER_DATA_LENGTH` | `100000`   | Max paymasterAndData bytes     |
| `MAX_GAS_LIMIT`             | `10000000` | Max total gas limit            |
| `MAX_USEROPS_PER_BUNDLE`    | `30`       | Security cap on ops per bundle |

### Logging & Profit

| Variable                     | Default | Description                   |
| ---------------------------- | ------- | ----------------------------- |
| `LOG_LEVEL`                  | `INFO`  | DEBUG/INFO/WARN/ERROR         |
| `MIN_BUNDLER_MARGIN_PERCENT` | `5`     | Minimum bundler profit margin |

## Deployed Contracts

Deploy the required contracts (EntryPoint, account factory, paymaster, policy) on your target NeoX chain, then configure their addresses in `.env`.

- **EntryPoint** — an ERC-4337 v0.8-compatible EntryPoint implementation
- **Factory / SmartAccount** — the account factory and account implementation used by your senders
- **Paymaster** — optional; required for sponsored UserOps
- **Policy** — NeoX policy contract (if applicable)

> Addresses are environment-specific and must be set via `ENTRYPOINT`, `PAYMASTER`, etc. in `.env`. See [`script/`](script/) for Foundry deployment scripts and `.env.example` for the full variable list.

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
        "signature": "0x...",
        "eip7702Auth": {          # optional — EIP-7702 upgrade (ERC-7769)
          "address": "0x...",     # account implementation to delegate to
          "chainId": "0xba9304",   # must match the bundler chain
          "nonce": "0x0",          # the EOA's own nonce at signing time
          "yParity": "0x0",        # signature parity
          "r": "0x...",           # signature r (32 bytes)
          "s": "0x..."            # signature s (32 bytes)
        }
      },
      "0x..."  # EntryPoint address
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
Profit check (effective gas price vs bundler cost)
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

- **Runtime**: Node.js >= 20.0.0 + TypeScript
- **Blockchain**: viem (ethers-free)
- **Smart Contracts**: Foundry + Solidity 0.8.28
- **Storage**: JSON file-based persistence
- **Server**: Express.js
- **Network**: NeoX

## License

ISC
