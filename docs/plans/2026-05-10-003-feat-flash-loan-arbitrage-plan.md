---
title: "feat: Flash Loan Arbitrage via Balancer V2"
type: feat
status: active
date: 2026-05-10
deepened: 2026-05-10
origin: docs/brainstorms/flash-loan-arbitrage-requirements.md
---

# feat: Flash Loan Arbitrage via Balancer V2

## Overview

Adds zero-capital arbitrage by borrowing USDC from Balancer V2 Vault, executing a two-leg WETH/USDC swap, and repaying within one atomic transaction. The off-chain AI agent detects spread opportunities and triggers execution; an on-chain `ArbitrageExecutor` contract handles the flash loan callback and swap routing.

This replaces `execute_swap` entirely. The agent no longer needs WETH or USDC in the wallet — only ETH for gas.

---

## Problem Frame

The current `execute_swap` tool requires the wallet to hold WETH or USDC before trading. With no capital, no arbitrage is possible. Balancer V2 offers 0%-fee flash loans that allow the agent to borrow up to the Vault's liquidity, execute both legs of a round-trip arbitrage, repay, and keep the profit — all in one transaction. If no profit is captured, the transaction reverts and no funds are lost (only gas).

(see origin: `docs/brainstorms/flash-loan-arbitrage-requirements.md`)

---

## Requirements Trace

- R1. Contract implements `IFlashLoanRecipient.receiveFlashLoan()`
- R2. Contract exposes `quoteArbitrage()` callable via `eth_call` for profit estimation
- R3. Contract parameterized by: `buyOnV2` (bool), `borrowAmount` (uint256), `minProfit` (uint256)
- R4. `executeArbitrage()` restricted to `onlyOwner`
- R5. ArbitrageParams encoded into Balancer `userData` via `abi.encode`, decoded in callback
- R6. Transaction reverts atomically if `profit < minProfit`
- R7. Profit transferred to `owner` within the same transaction
- R8. Separate deployments on ETH mainnet and Arbitrum; addresses in env vars
- R9. `simulate_flash_loan_arbitrage` tool returns `{ expectedProfitRaw, expectedProfitUsd, willSucceed }`
- R10. `execute_flash_loan_arbitrage` tool returns `{ txHash, actualProfitUsd }`
- R11. `execute_swap` removed; `definitions.ts` updated with two new tool entries
- R12. System prompt updated for flash loan workflow
- R13. `MAX_TRADE_USDC` cap enforced in TypeScript tool layer on `borrowAmount`
- R14. Token whitelist (WETH/USDC only) enforced in TypeScript tool layer

**Origin actors:** A1 (AI agent), A2 (ArbitrageExecutor contract), A3 (Balancer V2 Vault), A4 (Owner/EOA wallet)

**Origin flows:** F1 (simulation), F2 (execution)

**Origin acceptance examples:** AE1 (covers R2, R9), AE2 (covers R6, R10), AE3 (covers R4), AE4 (covers R13)

---

## Scope Boundaries

- MEV protection (Flashbots, private mempool) is not included — bot is visible in public mempool
- Multi-hop arbitrage (more than two swap legs) is not included
- Flash loan providers other than Balancer V2 are not included
- Cross-network arbitrage (ETH ↔ Arbitrum) is not included
- Automatic `borrowAmount` optimization in Solidity is not included — the agent decides
- Deploy scripts are not included — manual deployment via `forge create` or Etherscan

### Deferred to Follow-Up Work

- **Full** Mnemos bundle schema update: `bundle.ts` currently uses `SwapParams`/`SwapResult` types. U6 includes a *minimal compatibility shim* — field-level casting so the existing `buildTradeBundle` call receives best-effort data and snapshots continue to work without crashing. A proper `FlashLoanParams`/`FlashLoanResult` schema refactor of `bundle.ts` itself is deferred to follow-up work after this plan ships.

---

## Context & Research

### Relevant Code and Patterns

- `src/tools/swap.ts` — `validateTokenWhitelist`, `validateAmount` move to utils; the `simulateContract → writeContract` pattern is reused exactly in the new flash loan tool
- `src/tools/prices.ts` and `src/tools/gas.ts` — `simulateContract` with dummy account `0x000...001` for `nonpayable` quoter calls; `quoteArbitrage()` follows the same pattern
- `src/config/abis.ts` — minimal inline `as const` ABI arrays; new `arbitrageExecutorAbi` follows the same style
- `src/config/addresses.ts` — `ADDRESSES[network][key]` shape; Balancer Vault key added to both networks
- `src/agent/loop.ts:122–163` — `swapExecuted` guard (filter on tool name) must be renamed and updated to new tool name
- `src/agent/loop.ts:152` — `capturedParams` capture pattern reused for `execute_flash_loan_arbitrage`
- `test/unit/loop.test.ts` — `vi.mock` + dynamic `await import(...)` pattern for mocking tools; new tool tests follow exactly this pattern
- `test/unit/swap.test.ts` — pure helper test pattern; becomes `test/unit/utils.test.ts`

### Institutional Learnings

- No Solidity tooling currently exists in the repo — Foundry must be added as a new toolchain
- `ToolParamSchema` in `providers/types.ts` supports `'string' | 'number' | 'boolean'` — `boolean` covers `buyOnV2`; no type extension needed
- BigInt amounts stay as `bigint` internally, converted to `string` only when passed to AI or stored in result interfaces

### External References

- Balancer V2 `IFlashLoanRecipient` interface: `receiveFlashLoan(IERC20[] tokens, uint256[] amounts, uint256[] feeAmounts, bytes userData)`
- Balancer V2 Vault `flashLoan(IFlashLoanRecipient recipient, IERC20[] tokens, uint256[] amounts, bytes userData)` — tokens must be sorted ascending by address (single-element array is trivially sorted)
- Balancer V2 Vault address: `0xBA12222222228d8Ba445958a75a0704d566BF2C8` confirmed on both ETH mainnet and Arbitrum
- Flash loan fee: currently 0% (governance has not activated fees); `feeAmounts` will be all-zero
- OpenZeppelin v5 `Ownable` constructor requires explicit `Ownable(msg.sender)` — not `Ownable()`
- V3 SwapRouter handles `uniswapV3SwapCallback` internally; calling `SwapRouter.exactInputSingle()` from our contract does NOT require our contract to implement the V3 callback interface
- `viem simulateContract` with dummy account = eth_call — the same pattern already used for QuoterV2 in `prices.ts` and `gas.ts`

---

## Key Technical Decisions

- **Always borrow USDC**: USDC is the "unit of account". `borrowAmount` in 6-decimal USDC maps directly to `MAX_TRADE_USDC` with no price conversion. Token array is always `[USDC]` (single element), eliminating Balancer's token-sort requirement.
- **`quoteArbitrage()` is `external` (non-view), called via eth_call**: Cannot be `view` because it calls V3 QuoterV2 (`nonpayable`). TypeScript calls it via `simulateContract` with dummy account `0x000...001` — the same pattern in `prices.ts`/`gas.ts`.
- **Two-stage simulation**: `simulate_flash_loan_arbitrage` calls `quoteArbitrage()` (fast, DEX-quoter-based estimate). `execute_flash_loan_arbitrage` calls `simulateContract` on `executeArbitrage` as final gate before `writeContract`.
- **Profit via `ArbitrageExecuted(uint256 profit)` event**: Contract emits this event as the last action in `receiveFlashLoan`. TypeScript decodes it from receipt logs by event topic signature — avoids the fragile `receipt.logs.at(-1)?.data` pattern.
- **Executor addresses via env vars `EXECUTOR_ETH` / `EXECUTOR_ARB`**: Required at startup, validated like other required env vars. Allows contract redeployment without code changes.
- **Gas limit for flash loan: 500,000 gas**: Conservative upper bound for two swaps plus Balancer callback overhead (actual: ~300–450K). Replaces per-dex gas limits for profitability calculation.
- **`minProfit` floor enforced at runtime**: Tool layer enforces `minProfit >= 1.5 × gasCostUsdc` (in raw USDC 6-decimal units) before submitting — analogous to the existing `clampMinAmountOut` pattern in `swap.ts`.
- **Pure helpers in `src/tools/utils.ts`**: `validateTokenWhitelist` and `validateAmount` move here from `swap.ts`. All other `swap.ts` code is deleted (quoters, approval, V2/V3 swap execution — all handled by the Solidity contract now).
- **`FlashLoanCallbackParams` struct in `userData`**: Minimal struct `{ bool buyOnV2; uint256 minProfit }` — `borrowAmount` is already known from `amounts[0]`, not re-encoded.

---

## Open Questions

### Resolved During Planning

- **Solidity framework**: Foundry — minimal config, `forge build` only; no Hardhat.
- **`quoteArbitrage` as view or non-view**: Non-view (`external`); called via `simulateContract` eth_call with dummy account. V3 QuoterV2 is `nonpayable` and cannot be called from a `view` function.
- **userData encoding**: `abi.encode(FlashLoanCallbackParams { bool buyOnV2; uint256 minProfit })` — `borrowAmount` taken from `amounts[0]` in callback.
- **V3 callback**: Not required — `ArbitrageExecutor` calls `SwapRouter.exactInputSingle()`, which handles the V3 pool callback internally.
- **Token sort**: Single-element `[USDC]` array — trivially sorted; sorting utility not needed.
- **Borrow token**: Always USDC. `MAX_TRADE_USDC` maps directly to `borrowAmount / 1e6`.
- **Contract address config**: Env vars `EXECUTOR_ETH` and `EXECUTOR_ARB`, required at startup.
- **Balancer Vault address**: `0xBA12222222228d8Ba445958a75a0704d566BF2C8` — confirmed on both networks.

### Deferred to Implementation

- Exact V3 `fee` tier to use in `_swapV3` — currently `500` (0.05%) matches `swap.ts` and `prices.ts`; implementer should confirm against pool liquidity
- Foundry dependency installation order and exact `forge install` commands — determined during setup
- ABI tuple encoding of `FlashLoanCallbackParams` in TypeScript — determined by viem's ABI encoder with the inline ABI definition

---

## Output Structure

    contracts/
      foundry.toml
      .gitignore
      src/
        ArbitrageExecutor.sol
        interfaces/
          IFlashLoanRecipient.sol
          IBalancerVault.sol
    src/
      tools/
        utils.ts             ← new (moved helpers from swap.ts)
        flash_loan.ts        ← new
        swap.ts              ← deleted
        gas.ts               ← modified (add flash_loan Dex type; gas limit imported from flash_loan.ts)
      config/
        addresses.ts         ← modified (balancerVault + executor placeholder)
        abis.ts              ← modified (arbitrageExecutorAbi)
      agent/
        definitions.ts       ← modified (replace execute_swap)
        loop.ts              ← modified (new tool dispatch, guard rename)
        prompt.ts            ← modified (flash loan workflow)
      index.ts               ← modified (EXECUTOR_ETH, EXECUTOR_ARB env vars)
    test/
      unit/
        utils.test.ts        ← renamed + updated from swap.test.ts
        flash_loan.test.ts   ← new
        loop.test.ts         ← modified (mock new tools)
      integration/
        flash_loan.integration.test.ts  ← new

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    participant Agent as AI Agent (off-chain)
    participant FL as flash_loan.ts
    participant Executor as ArbitrageExecutor.sol
    participant Balancer as Balancer Vault
    participant DEX_A as Buy DEX (V2 or V3)
    participant DEX_B as Sell DEX (V3 or V2)

    Note over Agent: get_prices detects spread
    Agent->>FL: simulate_flash_loan_arbitrage(network, buyOnV2, borrowAmount)
    FL->>FL: validateTokenWhitelist + validateAmount cap
    FL->>Executor: eth_call quoteArbitrage(buyOnV2, borrowAmount) [dummy account]
    Executor->>DEX_A: quote leg 1 (USDC→WETH)
    Executor->>DEX_B: quote leg 2 (WETH→USDC)
    Executor-->>FL: int256 expectedProfit (USDC raw)
    FL-->>Agent: {expectedProfitUsd, willSucceed}

    Note over Agent: compare profit vs estimate_gas cost
    Agent->>FL: execute_flash_loan_arbitrage(network, buyOnV2, borrowAmount, minProfit)
    FL->>FL: validateTokenWhitelist + validateAmount + minProfit floor
    FL->>Executor: simulateContract executeArbitrage() [final gate]
    Executor-->>FL: simulation pass
    FL->>Executor: writeContract executeArbitrage(buyOnV2, borrowAmount, minProfit)
    Executor->>Balancer: flashLoan(this, [USDC], [borrowAmount], userData)
    Balancer-->>Executor: receiveFlashLoan([USDC], [amount], [0], userData)
    Note over Executor: require(msg.sender == vault); decode params
    Executor->>DEX_A: swap USDC→WETH
    Executor->>DEX_B: swap WETH→USDC
    Note over Executor: require(profit >= minProfit)
    Executor->>Balancer: USDC.transfer(vault, borrowAmount)
    Executor->>Agent: USDC.transfer(owner, profit)
    Executor-->>Executor: emit ArbitrageExecuted(profit)
    FL->>FL: parse ArbitrageExecuted from receipt logs
    FL-->>Agent: {txHash, actualProfitUsd}
```

---

## Implementation Units

- U1. **Foundry project setup**

**Goal:** Create a Foundry project in `contracts/` that compiles `ArbitrageExecutor.sol` and provides ABI output for TypeScript.

**Requirements:** R1 (prerequisite infrastructure)

**Dependencies:** None

**Files:**
- Create: `contracts/foundry.toml`
- Create: `contracts/.gitignore`
- Create: `contracts/src/` (directory)
- Create: `contracts/src/interfaces/IFlashLoanRecipient.sol`
- Create: `contracts/src/interfaces/IBalancerVault.sol`
- Modify: `package.json` (add `build:contracts` script)

**Approach:**
- `foundry.toml` sets `src = "contracts/src"`, `out = "contracts/out"`, `libs = ["contracts/lib"]`, `solc = "0.8.24"`
- Install OpenZeppelin v5 via `forge install OpenZeppelin/openzeppelin-contracts --no-git`
- Balancer interfaces are minimal copies (not full monorepo dependency): `IFlashLoanRecipient.sol` and `IBalancerVault.sol` with only the `flashLoan()` function signature
- `.gitignore` excludes `contracts/out/` and `contracts/cache/`
- `package.json` adds `"build:contracts": "forge build --config-file foundry.toml"` — TypeScript sources do not import from `contracts/out/`; ABI is maintained inline in `src/config/abis.ts`

**Test scenarios:**
- Test expectation: none — this is scaffolding only; correctness verified when U2 compiles successfully via `forge build`

**Verification:**
- `npm run build:contracts` exits 0 with no errors after U2 is implemented

---

- U2. **ArbitrageExecutor.sol**

**Goal:** Solidity contract that implements `IFlashLoanRecipient`, executes a two-leg WETH/USDC arbitrage funded by Balancer flash loan, and emits `ArbitrageExecuted(profit)` on success.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** U1

**Files:**
- Create: `contracts/src/ArbitrageExecutor.sol`
- Create: `contracts/test/ArbitrageExecutor.t.sol`

**Approach:**

*State variables (all `immutable`):* `vault`, `weth`, `usdc`, `v2Router`, `v3Router`, `v3Quoter`

*Constructor:* `constructor(address vault, address weth, address usdc, address v2Router, address v3Router, address v3Quoter) Ownable(msg.sender)` — stores all six as `immutable`

*`executeArbitrage(bool buyOnV2, uint256 borrowAmount, uint256 minProfit) external onlyOwner`:*
- Build `IERC20[] tokens = [IERC20(usdc)]`, `uint256[] amounts = [borrowAmount]`
- Encode `userData = abi.encode(FlashLoanCallbackParams({ buyOnV2: buyOnV2, minProfit: minProfit }))`
- Call `vault.flashLoan(IFlashLoanRecipient(this), tokens, amounts, userData)`

*`receiveFlashLoan(IERC20[] tokens, uint256[] amounts, uint256[] feeAmounts, bytes userData) external override`:*
- `require(msg.sender == address(vault), "Not vault")`
- Decode `FlashLoanCallbackParams p = abi.decode(userData, (FlashLoanCallbackParams))`
- Execute two swaps based on `p.buyOnV2`: if true → `_swapV2(usdc→weth, amounts[0])` then `_swapV3(weth→usdc, wethOut)`; if false → `_swapV3(usdc→weth, amounts[0])` then `_swapV2(weth→usdc, wethOut)`
- `uint256 repay = amounts[0] + feeAmounts[0]`; `uint256 finalUsdc = IERC20(usdc).balanceOf(address(this))`
- `require(finalUsdc >= repay + p.minProfit, "Insufficient profit")`
- `IERC20(usdc).transfer(address(vault), repay)` — repay Balancer
- `uint256 profit = IERC20(usdc).balanceOf(address(this))`
- `IERC20(usdc).transfer(owner(), profit)` — profit to owner
- `emit ArbitrageExecuted(profit)`

*`quoteArbitrage(bool buyOnV2, uint256 borrowAmount) external returns (int256 expectedProfit)`:*
- Leg 1 quote: if `buyOnV2` → call `IUniV2Router(v2Router).getAmountsOut(borrowAmount, [usdc, weth])[1]`; else → call `IQuoterV2(v3Quoter).quoteExactInputSingle(usdc, weth, borrowAmount, 500, 0)`
- Leg 2 quote: reverse direction with leg 1 result
- Return `int256(finalUsdc) - int256(borrowAmount)` — positive means profitable, negative means loss

*Internal helpers:*
- `_swapV2(address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256)` — approves V2 router, calls `swapExactTokensForTokens`
- `_swapV3(address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256)` — approves V3 router, calls `exactInputSingle` with `fee=500`, `recipient=address(this)`, `deadline=block.timestamp`

*Event:* `event ArbitrageExecuted(uint256 profit)` — indexed on nothing (simple log, no filter needed)

*Struct:* `struct FlashLoanCallbackParams { bool buyOnV2; uint256 minProfit; }` — defined at file scope

**Patterns to follow:**
- Existing `swapV2` / `swapV3` logic in `src/tools/swap.ts` for router calls (same router addresses used)
- OpenZeppelin `Ownable` v5 constructor pattern: `Ownable(msg.sender)`

**Test scenarios:**
- Happy path: Fork Arbitrum, deploy with live addresses, borrow 10,000 USDC, execute arbitrage when V2/V3 spread exists — `ArbitrageExecuted` emitted with `profit > 0`
- Happy path: `quoteArbitrage(buyOnV2=true, 10000_000000)` returns `int256` matching expected round-trip profit within ±2% of actual
- Edge case: `borrowAmount = 0` — both swaps receive 0 input; `finalUsdc >= repay` likely fails; transaction reverts (no profit, no loss)
- Error path: `minProfit` set to a value larger than actual profit — transaction reverts with "Insufficient profit"; no USDC lost from caller wallet
- Error path: Non-owner calls `executeArbitrage()` — reverts with `OwnableUnauthorizedAccount` (Covers AE3)
- Error path: `receiveFlashLoan` called by non-vault address — reverts with "Not vault"
- Error path: Flash loan with spread that reverses mid-execution (simulated by forking at a known block and using an unfavorable buyOnV2 setting) — whole transaction reverts atomically
- Integration: After successful `executeArbitrage`, check `IERC20(usdc).balanceOf(owner)` increased by `profit`; Vault balance unchanged
- Fork test: Non-zero `feeAmounts[0]` — manually inject a mock vault that sets `feeAmounts[0] = 1_000_000` (1 USDC); confirm repayment formula `amounts[0] + feeAmounts[0]` correctly accounts for fee and profit check still applies
- Fork test: Adverse second swap slippage — fork at a block where leg-2 output is less than `borrowAmount + minProfit`; confirm whole tx reverts without losing USDC from caller wallet
- Fork test: Non-whitelisted token in callback — deploy a mock vault that calls `receiveFlashLoan` with a different token address; confirm contract reverts (only USDC should be processed)
- Fork test: Ownership transfer — after `transferOwnership(newOwner)`, confirm `newOwner` can call `executeArbitrage` and old owner cannot

**Verification:**
- `forge build` compiles without warnings
- `forge test --fork-url $ARB_RPC_URL` passes all test cases

---

- U3. **Config updates — addresses and ABIs**

**Goal:** Add Balancer Vault address to both network configs, add `arbitrageExecutorAbi` and `balancerVaultAbi` inline ABIs, and add `EXECUTOR_ETH` / `EXECUTOR_ARB` env var reading at startup.

**Requirements:** R8, R13, R14

**Dependencies:** U2 interface must be frozen first — `arbitrageExecutorAbi` in `abis.ts` must match the exact Solidity function signatures (parameter names, types, `stateMutability`). Proceed to this unit after U2 compiles successfully.

**Sequencing note — two-pass implementation:** U3 is implemented in two passes:
1. **Pass 1 (after U2 compiles):** Implement all changes except actual contract addresses. Use placeholder `'0x0000000000000000000000000000000000000000' as Address` for `EXECUTOR_ETH`/`EXECUTOR_ARB` in `addresses.ts` and `index.ts`. ABI entries can be finalized now (they are code, not deployment-specific).
2. **Manual deployment step** (see Documentation/Operational Notes): Run `forge create` on both networks. Obtain live addresses.
3. **Pass 2:** Replace placeholder addresses with actual deployed addresses. Update `.env.example` with real example format.

U5 cannot be started until Pass 2 is complete (real executor addresses required for integration tests).

**Files:**
- Modify: `src/config/addresses.ts`
- Modify: `src/config/abis.ts`
- Modify: `src/index.ts`
- Modify: `.env.example`

**Approach:**

*`addresses.ts`:*
- Add `balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address` to both `ethereum` and `arbitrum` objects

*`abis.ts`:*
- Add `arbitrageExecutorAbi` with three entries:
  - `executeArbitrage(bool buyOnV2, uint256 borrowAmount, uint256 minProfit)` — `stateMutability: 'nonpayable'`
  - `quoteArbitrage(bool buyOnV2, uint256 borrowAmount) returns (int256)` — `stateMutability: 'nonpayable'` (called via eth_call)
  - `ArbitrageExecuted(uint256 profit)` — event entry for receipt log parsing
- Add `balancerVaultAbi` with one entry: `flashLoan(address recipient, address[] tokens, uint256[] amounts, bytes userData)` — `stateMutability: 'nonpayable'`

*`index.ts`:*
- Add two `requireEnv` calls: `EXECUTOR_ETH` and `EXECUTOR_ARB`, cast as `` `0x${string}` ``
- Build `executorAddresses = { ethereum: EXECUTOR_ETH, arbitrum: EXECUTOR_ARB }`
- Pass `executorAddresses` to `runIteration`
- Add to startup log: `console.log('  EXECUTOR_ETH:', EXECUTOR_ETH)` and `EXECUTOR_ARB`

*`.env.example`:*
- Add two commented-out entries with descriptions for `EXECUTOR_ETH` and `EXECUTOR_ARB`

**Patterns to follow:**
- Existing `ADDRESSES` shape and `as const` style in `addresses.ts`
- Existing minimal ABI inline `as const` style in `abis.ts`
- `requireEnv` + cast pattern already used for `PRIVATE_KEY`

**Test scenarios:**
- Test expectation: none — this is pure configuration; correctness verified at compile time via TypeScript strict mode and at runtime when `npm start` fails fast if env vars are missing

**Verification:**
- TypeScript compiles without errors after changes
- `npm start` without `EXECUTOR_ETH` / `EXECUTOR_ARB` in env exits with `Missing required env var: EXECUTOR_ETH`

---

- U4. **Shared utils module — extract pure helpers, remove swap.ts**

**Goal:** Move `validateTokenWhitelist` and `validateAmount` to a shared `src/tools/utils.ts`. Delete `src/tools/swap.ts` and all imports of it. Rename and update the corresponding tests.

**Requirements:** R11, R13, R14 (shared validation logic reused without duplication)

**Dependencies:** U3 (addresses.ts must exist for whitelist), but no runtime dependency on U5

**Files:**
- Create: `src/tools/utils.ts`
- Delete: `src/tools/swap.ts`
- Delete: `test/unit/swap.test.ts`
- Create: `test/unit/utils.test.ts`
- Modify: `src/agent/loop.ts` (remove `import ... from '../tools/swap.js'`; replace `SwapParams`/`SwapResult` type references with `any` or stub types as compile placeholders until U5 ships — or do U4 and U5 together if sequencing allows)

**Approach:**
- `utils.ts` exports `validateTokenWhitelist(tokenIn, tokenOut, network)` and `validateAmount(amountUsd, maxTradeUsdc)` — identical logic to current `swap.ts`, zero behavior change
- `swap.ts` is deleted in full — no other exports (`buildDeadline`, `clampMinAmountOut`, `quoteV3`, `swapV2`, `swapV3`, `ensureApproval`, `executeSwap`) are needed anywhere after U5
- `test/unit/utils.test.ts` reproduces all existing `validateTokenWhitelist` and `validateAmount` test cases from `swap.test.ts` with updated import path; `buildDeadline` and `clampMinAmountOut` tests are dropped (functions deleted)
- Remove `import { executeSwap } from '../tools/swap.js'` from `loop.ts` and also remove any `SwapParams`/`SwapResult` type imports; replace the `swapContext` variable type with a compile-safe placeholder — final types land in U5. This prevents a broken compile state between U4 and U5.

**Patterns to follow:**
- `test/unit/swap.test.ts` — copy test structure, update imports from `'../../src/tools/swap.js'` to `'../../src/tools/utils.js'`

**Test scenarios:**
- Happy path: `validateTokenWhitelist(ETH_WETH, ETH_USDC, 'ethereum')` does not throw
- Happy path: `validateTokenWhitelist(ARB_USDC, ARB_WETH, 'arbitrum')` does not throw
- Edge case: ETH tokens on Arbitrum network — throws `/token_in.*not whitelisted/`
- Error path: Unknown `token_out` — throws `/token_out.*not whitelisted/`
- Happy path: `validateAmount(50, 100)` passes; `validateAmount(100, 100)` passes
- Edge case: `validateAmount(100.01, 100)` throws `/$100\.01.*exceeds/`
- (All 7 existing tests from `test/unit/swap.test.ts` for these two functions, updated import path)

**Verification:**
- `npm run test:unit` passes with `utils.test.ts` covering all cases
- TypeScript compiles with `swap.ts` deleted (no remaining imports)

---

- U5. **Flash loan tools**

**Goal:** Implement `src/tools/flash_loan.ts` with three exports: a pure profit-floor calculator, an async quote function (calls `quoteArbitrage` via eth_call), and an async execution function (simulate gate + write + receipt parse).

**Requirements:** R2, R3, R6, R9, R10, R13, R14

**Dependencies:** U3 (ABIs, addresses), U4 (utils)

**Files:**
- Create: `src/tools/flash_loan.ts`
- Create: `test/unit/flash_loan.test.ts`
- Create: `test/integration/flash_loan.integration.test.ts`

**Approach:**

*`flash_loan.ts` exports (including gas constant — kept here to avoid layer violation with `gas.ts`):*

`export const FLASH_LOAN_GAS_LIMIT = 500_000n` — used by both `execute_flash_loan_arbitrage` (`writeContract` gasLimit) and `estimateGas` (which reads it from this module). This avoids the layer violation of placing a flash_loan-specific constant in `gas.ts` which predates this feature.

`computeMinProfitRaw(gasCostUsdc: number, boostFactor = 1.5): bigint`
- Pure function: converts `gasCostUsdc * boostFactor` to raw USDC units (`BigInt(Math.ceil(gasCostUsdc * boostFactor * 1e6))`)
- Returns minimum acceptable USDC profit in 6-decimal raw units
- `boostFactor` default 1.5 = profit must be at least 1.5× gas cost

`export interface FlashLoanParams { network: Network; buyOnV2: boolean; borrowAmount: string; }`

`export interface FlashLoanResult { txHash: string; profitRaw: string; profitUsd: number; }`

`quoteFlashLoanArbitrage(params: FlashLoanParams, clients: Clients, executorAddress: Address): Promise<{ expectedProfitRaw: bigint; expectedProfitUsd: number; willSucceed: boolean; revertReason?: string }>`
- Validate via `validateTokenWhitelist(usdc, weth, params.network)` and `validateAmount(Number(BigInt(params.borrowAmount)) / 1e6, maxTradeUsdc)`... actually `validateAmount` needs `maxTradeUsdc` — this is a caller responsibility, done in `dispatchTool`
- Call `publicClient.simulateContract({ address: executorAddress, abi: arbitrageExecutorAbi, functionName: 'quoteArbitrage', args: [params.buyOnV2, BigInt(params.borrowAmount)], account: '0x0000000000000000000000000000000000000001' })`
- On success: `result[0]` is `int256 expectedProfit`; convert to USD (`Number(expectedProfit) / 1e6`); return `{ expectedProfitRaw: expectedProfit, expectedProfitUsd, willSucceed: expectedProfit > 0n }`
- On `simulateContract` throw: catch, return `{ expectedProfitRaw: 0n, expectedProfitUsd: 0, willSucceed: false, revertReason: error.message }`

`executeFlashLoanArbitrage(params: FlashLoanParams & { minProfit: string }, maxTradeUsdc: number, clients: Clients, walletAddress: Address, executorAddress: Address): Promise<FlashLoanResult>`
- Validate: `validateTokenWhitelist(wethAddr, usdcAddr, params.network)`, `validateAmount(Number(BigInt(params.borrowAmount)) / 1e6, maxTradeUsdc)`
- Enforce minProfit floor: caller provides `minProfit`; if `BigInt(params.minProfit) < computeMinProfitRaw(gasCostUsdc)` the tool raises it (requires `gasCostUsdc` passed from caller — see loop.ts approach below)
- `simulateContract` on `executeArbitrage(params.buyOnV2, BigInt(params.borrowAmount), BigInt(params.minProfit))` with `account: walletAddress` — throws if would revert (wrapError returned to agent)
- `writeContract(request)` → `hash`
- `waitForTransactionReceipt({ hash })` → `receipt`
- Parse `ArbitrageExecuted` event from `receipt.logs`: find log where `topics[0] == keccak256("ArbitrageExecuted(uint256)")`, decode `data` as `uint256` → `profitRaw`
- Return `{ txHash: hash, profitRaw: profitRaw.toString(), profitUsd: Number(profitRaw) / 1e6 }`

*Note on minProfit floor ownership:* `flash_loan.ts`'s `executeFlashLoanArbitrage` receives `gasCostUsdc: number` from its caller. **`loop.ts` is responsible for providing this value** — it passes `latestGasCostUsd ?? 5.0` where `5.0` is the conservative fallback for when the agent skipped `estimate_gas`. `flash_loan.ts` does not implement the null-fallback logic; it simply calls `computeMinProfitRaw(gasCostUsdc)` on whatever value it receives.

**Patterns to follow:**
- `simulateContract → writeContract → waitForTransactionReceipt` chain in `src/tools/swap.ts:swapV3`
- Dummy account `'0x0000000000000000000000000000000000000001'` for `quoteArbitrage` eth_call, exactly as in `prices.ts:52` and `gas.ts:43`
- `wrapResult`/`wrapError` JSON envelope in `loop.ts:18–25`

**Test scenarios:**
- Unit — Happy path: `computeMinProfitRaw(5.00)` returns `7_500_000n` (7.5 USDC raw = 1.5 × $5)
- Unit — Happy path: `computeMinProfitRaw(0.50, 2.0)` returns `1_000_000n`
- Unit — Edge case: `computeMinProfitRaw(0)` returns `0n`
- Unit — `FlashLoanParams` validation in `quoteFlashLoanArbitrage`: unknown `network` value causes `validateTokenWhitelist` to throw → function throws
- Unit — `willSucceed: false` returned with `revertReason` when `simulateContract` throws (mock the client to throw)
- Unit — `willSucceed: false` when `expectedProfit <= 0n` (negative profit = loss)
- Integration — `quoteFlashLoanArbitrage` with real ETH/ARB RPC: returns `{ willSucceed, expectedProfitUsd }` without sending any tx (Covers AE1 partially)
- Integration — Actual amounts: borrow 10,000 USDC (`10_000_000_000n`), check `expectedProfitUsd` is a finite number, not NaN or Infinity
- Unit — Balancer fee in profit: if `feeAmounts[0] = 500_000n` (0.5 USDC), confirm repayment is `borrowAmount + 500_000n` and `computeMinProfitRaw` still applies correctly on top of repayment
- Unit — MAX_TRADE_USDC regression: `validateAmount(100.01, 100)` called inside `quoteFlashLoanArbitrage` throws before any RPC call is made (prevents over-limit amounts reaching the contract)
- Unit — Network mismatch: `quoteFlashLoanArbitrage` with `network: 'ethereum'` but Arbitrum executor address → `simulateContract` mock returns revert; `willSucceed: false` returned, no throw
- Unit — Negative `gasCostUsdc` boundary: `computeMinProfitRaw(-1)` — either returns `0n` (clamped) or a negative bigint; implementer must pick one and document it in a comment
- Unit — `int256` overflow boundary: `expectedProfit = 2n ** 255n - 1n` (max int256) converts to `Number` as `Infinity`; confirm tool handles gracefully (cap at `Number.MAX_SAFE_INTEGER / 1e6` USD or similar) rather than returning `expectedProfitUsd: Infinity` to the agent

**Verification:**
- `npm run test:unit` passes all unit tests in `flash_loan.test.ts`
- `npm run test:integration` passes `flash_loan.integration.test.ts` when `ETH_RPC_URL`, `ARB_RPC_URL`, `EXECUTOR_ETH`, `EXECUTOR_ARB` are set

---

- U6. **Agent layer updates — loop, definitions, prompt, gas**

**Goal:** Wire the two new flash loan tools into the agent dispatch loop, replace `execute_swap` in tool definitions, update the system prompt for the flash loan workflow, and add a flash-loan gas limit constant.

**Requirements:** R11, R12, R13

**Dependencies:** U3, U4, U5

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `src/agent/definitions.ts`
- Modify: `src/agent/prompt.ts`
- Modify: `src/tools/gas.ts`
- Modify: `test/unit/loop.test.ts`

**Approach:**

*`gas.ts`:*
- Extend `Dex` type to `'v2' | 'v3' | 'flash_loan'`
- When `dex === 'flash_loan'`, `estimateGas` imports `FLASH_LOAN_GAS_LIMIT` from `'../tools/flash_loan.js'` and uses it instead of a locally-defined constant. Do NOT add `flash_loan` to `GAS_LIMIT` in this file — the constant lives in `flash_loan.ts` (see U5 approach).

*`loop.ts`:*
- Add `executorAddresses: { ethereum: Address; arbitrum: Address }` parameter to both `dispatchTool` and `runIteration`
- In `dispatchTool`, replace `case 'execute_swap'` with two new cases:
  - `case 'simulate_flash_loan_arbitrage'`: calls `quoteFlashLoanArbitrage(params, clients, executorAddresses[params.network])` after `validateTokenWhitelist` + `validateAmount` (delegated to the tool)
  - `case 'execute_flash_loan_arbitrage'`: calls `executeFlashLoanArbitrage(params, maxTradeUsdc, clients, walletAddress, executorAddresses[params.network], latestGasCostUsd ?? 5.0)` — the fallback `5.0` (USD) is provided here in `loop.ts`, not inside `flash_loan.ts`
- Rename `swapExecuted` → `flashLoanExecuted`; update guard filter from `c.name !== 'execute_swap'` to `c.name !== 'execute_flash_loan_arbitrage'`. **The guard applies only to `execute_flash_loan_arbitrage` — `simulate_flash_loan_arbitrage` may be called multiple times per iteration and must NOT be blocked by this guard.**
- Rename `swapContext` → `flashLoanContext`; change type from `{ params: SwapParams; result: SwapResult }` to `{ params: FlashLoanParams; result: FlashLoanResult }`
- Import `FlashLoanParams`, `FlashLoanResult` from `../tools/flash_loan.js` instead of `SwapParams`, `SwapResult` from swap
- In the Mnemos section at end of `runIteration`: update `buildTradeBundle` call to pass `flashLoanContext.params` and `flashLoanContext.result` — `buildTradeBundle` is updated minimally (see note in Scope Boundaries: full schema update is deferred; for now, cast or adapt the fields so existing Mnemos snapshot still works with best-effort data)

*`definitions.ts`:*
- Remove `execute_swap` entry
- Add `simulate_flash_loan_arbitrage`:
  ```
  params: {
    network: { type: 'string', enum: ['ethereum', 'arbitrum'] }
    buyOnV2: { type: 'boolean', description: 'true = buy on V2/SushiSwap, sell on V3; false = buy on V3, sell on V2' }
    borrowAmount: { type: 'string', description: 'USDC amount to borrow in 6-decimal raw units (e.g. "10000000000" = 10,000 USDC)' }
  }
  ```
- Add `execute_flash_loan_arbitrage`:
  ```
  params: {
    network: ...,
    buyOnV2: ...,
    borrowAmount: ...,
    minProfit: { type: 'string', description: 'Minimum USDC profit in 6-decimal raw units. Runtime raises to 1.5x gas cost if lower.' }
  }
  ```

*`prompt.ts`:*
- Replace "Step 5: If profitable, call execute_swap for the buy leg..." with flash loan workflow:
  - Step 3: call `estimate_gas` with `dex: 'flash_loan'` to get accurate flash-loan gas cost
  - Step 4: call `simulate_flash_loan_arbitrage` to get expected profit via quote
  - Step 5: compare `expectedProfitUsd` against gas cost; execute only if clearly positive
  - Step 6: if profitable, call `execute_flash_loan_arbitrage` with `minProfit` in raw USDC units
- Remove single-swap-per-iteration instruction (still applies: one flash loan per iteration — already enforced by runtime guard)
- Remove `min_amount_out` slippage section (not a parameter for flash loans)
- Add section: "Both legs of arbitrage execute atomically inside a single on-chain transaction — you do not need to call the tool twice."
- Keep token address table, intra-network constraint, and skip conditions

**Patterns to follow:**
- `case 'execute_swap'` dispatch pattern in current `loop.ts` for the two new cases
- `swapExecuted` guard logic — same pattern, new tool name
- `makeToolCall` / `makeEndTurn` test factories in `loop.test.ts`
- **Existing `loop.test.ts` calls to `dispatchTool` must be updated** to pass the new `executorAddresses` parameter. Any test that previously called `dispatchTool(...)` without this param will fail to compile after this change — update all existing call sites in `loop.test.ts` as part of this unit.

**Test scenarios (loop.ts):**
- Happy path: `dispatchTool` with `simulate_flash_loan_arbitrage` → returns wrapped result with `expectedProfitUsd`
- Happy path: `dispatchTool` with `execute_flash_loan_arbitrage` → returns wrapped result with `txHash`
- Error path: `dispatchTool` with unknown tool name → `wrapError` "Unknown tool"
- Integration (loop): `runIteration` with agent calling `simulate_flash_loan_arbitrage` then `execute_flash_loan_arbitrage` in sequence — `executeFlashLoanArbitrage` called once
- Guard: agent calls `execute_flash_loan_arbitrage` twice in same turn → second call returns `wrapError("execute_flash_loan_arbitrage already called this iteration")` (Covers existing AE2 analog)
- Guard: `flashLoanExecuted` stays false if only `simulate_flash_loan_arbitrage` is called
- Mnemos: after successful flash loan, `snapshot` called with bundle containing `flashLoanContext.result.txHash`
- Mnemos: snapshot error → no crash, stats unchanged
- Integration (full loop wiring): `runIteration` with mocked flash loan tools returning a successful result — confirm `flashLoanExecuted` guard is set, second `execute_flash_loan_arbitrage` call in same turn returns `wrapError`, and Mnemos snapshot is attempted with the correct `txHash`

**Test scenarios (gas.ts — `estimate_gas` with `dex='flash_loan'`)**:
- `calculateGasCostUsd(500_000n, 20n * 10n**9n, 3000)` returns ≈ $30 (500k × 20 gwei × $3000/ETH)
- `FLASH_LOAN_GAS_LIMIT` (imported from `flash_loan.ts`) is `500_000n` — confirm `gas.ts` reads from there, not a local copy

**Verification:**
- `npm run test:unit` passes all test cases including updated `loop.test.ts` and new gas limit test
- Agent workflow in the system prompt is consistent with tool definitions (no mention of `execute_swap`)

---

## System-Wide Impact

- **Interaction graph:** `dispatchTool` now handles two new tool names; `flashLoanExecuted` guard replaces `swapExecuted`; `runIteration` signature gains `executorAddresses` parameter
- **Error propagation:** Both new tools follow `wrapResult`/`wrapError` JSON envelope — errors surface to AI agent as `{ error: "..." }` strings, same as existing tools
- **State lifecycle risks:** `flashLoanContext` holds flash loan result for Mnemos snapshot; if `execute_flash_loan_arbitrage` reverts on-chain (tx not mined), `flashLoanContext` remains null and no snapshot is taken
- **API surface parity:** `dispatchTool` export signature changes (new `executorAddresses` param) — only caller is `runIteration` in the same file; no external consumers
- **Integration coverage:** The `simulateContract → writeContract` pattern is tested at integration level in `flash_loan.integration.test.ts` against real RPC; unit tests mock the client
- **Unchanged invariants:** `get_prices`, `get_wallet_balance`, `estimate_gas` tools and their tests are unchanged. `getPrices`, `getWalletBalance`, `estimateGas` function signatures are unchanged. Mnemos client and bundle structure remain unchanged in this plan (full schema update deferred).
- **Reentrancy note:** Balancer V2 Vault does not re-enter the callback, but adding `nonReentrant` modifier from OpenZeppelin `ReentrancyGuard` to `receiveFlashLoan` is recommended at negligible gas cost (~200 gas). Implementer's call — not required for correctness but hardens the contract.
- **MEV / userData information leak:** `buyOnV2` flag and `minProfit` are encoded in `userData` and are visible in the public mempool before the transaction is mined. An observer can infer trade direction. This is accepted per scope boundaries (no MEV protection). Implementer should not add obfuscation — it would conflict with the "no MEV protection" scope decision.

---

## Risks & Dependencies

| Risk | Severity | Mitigation |
|------|----------|------------|
| MEV competition — 30s polling interval likely too slow for mainnet spreads | Low (accepted) | Arbitrum has lower gas and smaller competition; accepted per scope boundaries |
| Balancer V2 governance activates flash loan fees | Low | `feeAmounts[0]` already used in repay calculation; non-zero fees automatically reduce profit with no code change |
| Contract deployment fails or address not set in env | Low | Startup validation catches missing `EXECUTOR_ETH`/`EXECUTOR_ARB` before any iteration runs |
| `quoteArbitrage` estimate diverges from `executeArbitrage` actual result (price moved) | Medium | `simulateContract` final gate in `execute_flash_loan_arbitrage` re-checks at latest block; contract `require(profit >= minProfit)` as last-resort atomicity guard |
| Arbitrage contract holds no balance but must approve tokens during swap | Low | Approval happens inside `receiveFlashLoan` callback (tokens already in contract); standard ERC20 `approve` then swap pattern, same as existing `swap.ts` |
| Fork test flakiness on Arbitrum due to RPC rate limits | Low | Use a dedicated RPC URL with `testTimeout: 30000` (already set in integration project config) |
| **USDC blacklisting (HIGH):** Circle can blacklist `ArbitrageExecutor` contract address via USDC's `_blacklist` function, permanently preventing the contract from sending or receiving USDC | **High** | No on-chain mitigation possible (USDC is a permissioned token). Operational mitigation: if blacklisting occurs, redeploy contract to a new address and update `EXECUTOR_ETH`/`EXECUTOR_ARB` env vars. Monitor Circle's blacklist feed if operating at scale. |
| **Balancer V2 governance pause (MEDIUM):** Balancer governance multisig can pause the Vault, causing `flashLoan()` to revert with no clear error message | **Medium** | No on-chain mitigation. Agent will log undifferentiated failures; operator should check Balancer governance status if flash loans start failing without apparent reason. No code change needed — the `simulateContract` gate will catch the revert before spending gas. |

---

## Documentation / Operational Notes

- `.env.example` must document `EXECUTOR_ETH` and `EXECUTOR_ARB` with deployment instructions
- CLAUDE.md "Setup" table needs two new rows for `EXECUTOR_ETH` and `EXECUTOR_ARB`
- CLAUDE.md "Safety Rails" section: replace `min_amount_out floor` with `minProfit floor (1.5x gas cost)`
- **Manual deployment step (between U2 and U3):** After `forge build` passes in U2, the operator must deploy the contract on both networks before U3 ABIs can be finalized against a live contract. The deployment command is:
  ```
  forge create contracts/src/ArbitrageExecutor.sol:ArbitrageExecutor \
    --constructor-args <vault> <weth> <usdc> <v2Router> <v3Router> <v3Quoter> \
    --rpc-url $ETH_RPC_URL --private-key $PRIVATE_KEY
  ```
  Run once for ETH mainnet and once for Arbitrum. Save the resulting `Deployed to:` addresses as `EXECUTOR_ETH` and `EXECUTOR_ARB`. This step is a hard prerequisite for end-to-end integration tests in U5.

---

## Sources & References

- **Origin document:** [docs/brainstorms/flash-loan-arbitrage-requirements.md](docs/brainstorms/flash-loan-arbitrage-requirements.md)
- Balancer V2 IFlashLoanRecipient: `receiveFlashLoan(IERC20[] tokens, uint256[] amounts, uint256[] feeAmounts, bytes userData)`
- Balancer V2 Vault address (ETH mainnet + Arbitrum): `0xBA12222222228d8Ba445958a75a0704d566BF2C8`
- Existing quoter pattern: `src/tools/prices.ts:52` — dummy account `0x000...001` for `nonpayable` eth_call
- Existing simulate-before-write pattern: `src/tools/swap.ts:169,225`
- `src/agent/loop.ts:122–163` — `swapExecuted` guard to rename and update
- `src/tools/gas.ts:9–12` — `GAS_LIMIT` constants to extend
- OpenZeppelin Ownable v5: `Ownable(msg.sender)` constructor required
