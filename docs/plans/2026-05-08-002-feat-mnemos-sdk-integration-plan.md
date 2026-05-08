---
title: feat: Mnemos SDK Integration — On-Chain Agent Memory
type: feat
status: active
date: 2026-05-08
origin: docs/brainstorms/mnemos-sdk-integration-requirements.md
---

# feat: Mnemos SDK Integration — On-Chain Agent Memory

## Overview

Wire `@mnemos/sdk` into the arbitrage agent so every confirmed swap automatically produces an encrypted on-chain memory snapshot (minted as NFT on 0G network) and an auto-listing on MemoryMarketplace. `MnemosClient` is initialized once at startup and injected into `runIteration()` as an optional fifth parameter; snapshot logic lives inside the agent loop and fires after the `while` loop exits (capturing Claude's final reasoning summary). All existing behavior is preserved — Mnemos is purely additive.

---

## Problem Frame

The arbitrage agent is stateless — each restart loses all trade history with no tamper-proof record of Claude's decisions. Integrating Mnemos gives every successful trade an immutable on-chain trace that includes price context and Claude's full reasoning, readable by external agents and operators, and monetizable via marketplace buy/rent/fork flows.

(see origin: docs/brainstorms/mnemos-sdk-integration-requirements.md)

---

## Requirements Trace

- R1. Snapshot only after `execute_swap` confirms on-chain (`SwapResult` returned, no error). Skip iterations produce no snapshot.
- R2. `MemoryBundle.data` contains trade params, price context at trade time, Claude reasoning text, and in-memory cumulative stats.
- R3. All `text` blocks from Claude during the iteration are appended to `reasoningLog[]` and joined for the bundle.
- R4. After `snapshot()` succeeds, `list(tokenId, terms)` is called automatically.
- R5. Missing Mnemos env vars cause `process.exit(1)` with a clear error — same treatment as `ANTHROPIC_API_KEY`.
- R6. `snapshot()` or `list()` errors are caught and logged; agent continues.
- R7. `MnemosClient` initialized once in `index.ts`, injected into `runIteration()`.
- R8. Nine new required env vars + optional `MNEMOS_STORAGE_MOCK`.
- R9. Reuse existing `PRIVATE_KEY` — no separate key for Mnemos.
- R10. Log `[mnemos] Snapshot minted — tokenId: X, tx: 0x..., storage: 0g://...` and `[mnemos] Listed — tokenId: X, tx: 0x...` after success.

**Origin actors:** A1 (Claude), A2 (Runtime), A3 (Operator), A4 (External agent/buyer)
**Origin flows:** F1 (trade → snapshot → list), F2 (snapshot fails after trade), F3 (listing fails after snapshot)

---

## Scope Boundaries

- Loading chain memory into Claude context — write-only integration.
- Periodic snapshot (non-trade iteration) — only triggered by confirmed swap.
- `autoSnapshot()` API — timing controlled manually via F1.
- `buy()`, `rent()`, `fork()`, `payRoyalty()` from the agent itself.
- Configurable `agentId` — hardcoded `'arbitrage-agent-v1'` in bundle metadata.
- Token-level access control or private sharing.
- Retry logic for failed snapshots.

---

## Context & Research

### Relevant Code and Patterns

- `src/agent/loop.ts:77` — `runIteration()` signature to extend; tool results already serialized as `{ tool, data }` JSON envelopes via `wrapResult()`
- `src/tools/swap.ts:22-33` — `SwapParams`, `SwapResult` already exported — reuse directly; no type duplication
- `src/tools/prices.ts:5-10` — `PriceResult` already exported — reuse directly
- `src/tools/gas.ts:17-22` — `GasEstimateResult` exported; `gasCostUsd: number` is the field to capture
- `backend/packages/sdk/src/client.ts` — `MnemosClient` with `snapshot(bundle) → SnapshotResult` and `list(tokenId, terms) → txHash`
- `backend/packages/sdk/src/types.ts` — `MnemosClientConfig`, `MemoryBundle`, `ListingTerms`, `SnapshotResult`
- `backend/packages/sdk/dist/` — SDK dist already built; `package.json` exports point to it

### SDK Behavior Notes

- `MnemosClient.snapshot()` dynamically imports `@0gfoundation/0g-ts-sdk` for real 0G Storage uploads. Not installed → throws at runtime in non-mock mode. `storageMock: true` bypasses this.
- SDK `package.json` peerDeps and source code both reference `@0gfoundation/0g-ts-sdk`; SDK `CLAUDE.md` says `@0glabs/0g-ts-sdk`. Verify correct npm name before installing.

---

## Key Technical Decisions

- **`@mnemos/sdk` as local path dep**: `"file:../backend/packages/sdk"` — dist built, no publish needed for hackathon.
- **Return type unchanged**: `runIteration()` stays `Promise<void>`. Backward-compatible with all existing tests.
- **Capture via JSON envelope parsing**: After each `dispatchTool()` call, parse the `{ tool, data }` JSON envelope to extract `latestPrices`, `latestGasCostUsd`, and `swapContext`. No changes to `dispatchTool()` interface or signature.
- **Post-loop snapshot**: Snapshot fires after the `while (true)` loop exits — not inline with the swap turn — so Claude's final summary text block is included in `reasoningLog`.
- **`CumulativeStats` mutated in place**: Passed by reference from `index.ts`; loop increments it after successful snapshot + list pair.
- **No type duplication**: `SwapParams`, `SwapResult` from `swap.ts`; `PriceResult` from `prices.ts`. New types: `CumulativeStats`, `MnemosEnv`, `MnemosContext` only.
- **`gasCostUsd: null` fallback**: If Claude skips `estimate_gas`, `latestGasCostUsd` stays `null` — maps directly to `trade.gasCostUsd: number | null` per R2.

---

## Open Questions

### Resolved During Planning

- **Reasoning aggregation**: `reasoningLog: string[]` inside `runIteration()` — append each text block during the loop. Join with `'\n\n'` before passing to bundle builder. No return type change.
- **Prices at trade time**: Parse `get_prices` JSON result envelope in-loop to capture `latestPrices`. Same pattern for `estimate_gas` (gasCostUsd) and `execute_swap` (swapContext).
- **Loop signature**: Optional 5th param `mnemos?: MnemosContext` — backward-compatible; existing tests and index.ts unaffected unless they opt in.

### Deferred to Implementation

- **0G SDK npm package name**: Verify whether `@0gfoundation/0g-ts-sdk` or `@0glabs/0g-ts-sdk` is the correct npm package before running `npm install` in U1.
- **OG_CHAIN_ID value**: Confirm 0G testnet/mainnet chain ID from 0G documentation for `.env.example` entry and CLAUDE.md.

---

## Output Structure

    src/
      mnemos/
        bundle.ts     # buildTradeBundle() pure function + CumulativeStats type
        client.ts     # createMnemosClient() + buildListingTerms() + MnemosContext type
    test/
      unit/
        bundle.test.ts
        mnemos_client.test.ts
        (loop.test.ts extended with mnemos scenarios)

---

## Implementation Units

- U1. **Dependency Installation**

**Goal:** Add `@mnemos/sdk` (local path) and `@0gfoundation/0g-ts-sdk` (npm) to `package.json` so subsequent units can import them.

**Requirements:** R7, R9

**Dependencies:** None

**Files:**
- Modify: `package.json`

**Approach:**
- Add `"@mnemos/sdk": "file:../backend/packages/sdk"` to `dependencies`.
- Add `"@0gfoundation/0g-ts-sdk": "*"` to `dependencies` — verify package name on npm before installing (see Deferred question).
- Run `npm install` to link the local package and fetch the 0G SDK.
- Baseline check: run `npm run test:unit` after install to confirm existing suite passes before touching loop logic.

**Test scenarios:**
Test expectation: none — pure dependency configuration.

**Verification:**
- `import { MnemosClient } from '@mnemos/sdk'` resolves in TypeScript without error.
- `npm run test:unit` passes with no regressions (baseline).

---

- U2. **Bundle Builder (`src/mnemos/bundle.ts`)**

**Goal:** Pure function `buildTradeBundle()` that assembles a `MemoryBundle` from swap params, result, price context, reasoning, and cumulative stats. Fully testable without RPC or SDK network calls.

**Requirements:** R2, R3

**Dependencies:** U1

**Files:**
- Create: `src/mnemos/bundle.ts`
- Create: `test/unit/bundle.test.ts`

**Approach:**
- Export `CumulativeStats` type: `{ totalTrades: number; totalGasCostUsd: number }`.
- Import `SwapParams`, `SwapResult` from `'../tools/swap.js'`. Import `PriceResult` from `'../tools/prices.js'`. Import `MemoryBundle` from `'@mnemos/sdk'`.
- Export `buildTradeBundle(params: SwapParams, result: SwapResult, prices: PriceResult | null, gasCostUsd: number | null, reasoning: string, stats: CumulativeStats): MemoryBundle`.
- `MemoryBundle.data` follows R2 exactly:
  - `trade`: `{ network: params.network, dex: params.dex, tokenIn: params.token_in, tokenOut: params.token_out, amountIn: params.amount_in, amountOut: result.amountOut, txHash: result.txHash, gasCostUsd, timestamp: Date.now() }`
  - `context`: `{ pricesAtTrade: prices, claudeReasoning: reasoning }`
  - `cumulative`: `{ totalTrades: stats.totalTrades, totalGasCostUsd: stats.totalGasCostUsd }` — copy values at call time, not a reference to `stats`. **This records the count before this trade** (e.g., the first trade's bundle has `totalTrades: 0`). The increment happens in the loop after snapshot+list succeed, not inside `buildTradeBundle`.
- `MemoryBundle.metadata`: `{ category: 'trading', agentId: 'arbitrage-agent-v1', version: '1.0.0', createdAt: Date.now(), tags: ['arbitrage', 'weth-usdc', params.network, params.dex] }`

**Test scenarios:**
- **Happy path:** All fields populated → bundle matches expected structure; `metadata.tags` includes `params.network` and `params.dex`.
- **Null prices:** `prices: null` → `bundle.data.context.pricesAtTrade === null`.
- **Null gasCostUsd:** `gasCostUsd: null` → `bundle.data.trade.gasCostUsd === null`.
- **Stats snapshot (pre-increment):** Call `buildTradeBundle` with `stats = { totalTrades: 0, ... }` → `bundle.data.cumulative.totalTrades === 0`. After returning, mutate `stats.totalTrades++` → bundle is unchanged (snapshot, not reference). The first trade's bundle always contains `totalTrades: 0`.
- **JSON-serializable:** `JSON.stringify(bundle)` does not throw (no BigInt values in output).
- **Tags completeness:** For `network: 'arbitrum'`, `dex: 'v2'` → tags include `'arbitrage'`, `'weth-usdc'`, `'arbitrum'`, `'v2'`.

**Verification:**
- `npm run test:unit` — bundle.test.ts passes.
- All fields in `bundle.data` match R2 spec.

---

- U3. **MnemosClient Factory (`src/mnemos/client.ts`)**

**Goal:** Factory functions to construct `MnemosClient` and `ListingTerms` from parsed env, plus `MnemosContext` type shared by `loop.ts` and `index.ts`.

**Requirements:** R5, R7, R8, R9

**Dependencies:** U1, U2

**Files:**
- Create: `src/mnemos/client.ts`
- Create: `test/unit/mnemos_client.test.ts`

**Approach:**
- Define `MnemosEnv` interface with all 9 required fields plus optional `storageMock?: boolean`. Fields use camelCase; env reading stays in `index.ts`.
- Export `MnemosContext` type: `{ client: MnemosClient; terms: ListingTerms; stats: CumulativeStats }`. Import `CumulativeStats` from `'./bundle.js'`, `MnemosClient` and `ListingTerms` from `'@mnemos/sdk'`.
- Export `createMnemosClient(env: MnemosEnv): MnemosClient` — constructs `new MnemosClient({ privateKey: env.privateKey, chainId: Number(env.ogChainId), rpcUrl: env.ogRpcUrl, storageNodeUrl: env.ogStorageNode, registryAddress: env.registryAddress as 0x${string}, marketplaceAddress: env.marketplaceAddress as 0x${string}, storageMock: env.storageMock ?? false })`.
- Export `buildListingTerms(env: MnemosEnv): ListingTerms` — `BigInt(env.mnemoBuyPrice)`, `BigInt(env.mnemoRentPricePerDay)`, `BigInt(env.mnemoForkPrice)`, `royaltyBps: Number(env.mnemoRoyaltyBps)`.
- These functions do not read `process.env` directly — env parsing and validation lives in `index.ts`.

**Test scenarios:**
- **Happy path:** `createMnemosClient(validEnv)` returns a `MnemosClient` instance.
- **ListingTerms BigInt parse:** `buildListingTerms({ mnemoBuyPrice: '1000000000000000000', ... }).buyPrice === 1000000000000000000n`.
- **storageMock default false:** Omitting `storageMock` from `MnemosEnv` → constructed client has `storageMock: false` (verify via constructor arg if accessible, or trust TypeScript default).
- **storageMock propagated:** `storageMock: true` → passed through to `MnemosClient` constructor.
- **royaltyBps as number:** `mnemoRoyaltyBps: '500'` → `terms.royaltyBps === 500` (number, not bigint).

**Verification:**
- `npm run test:unit` — mnemos_client.test.ts passes.
- TypeScript compiles: `MnemosContext` type resolves with no errors in both `loop.ts` and `index.ts`.

---

- U4. **Agent Loop Modification (`src/agent/loop.ts`)**

**Goal:** Add optional `mnemos?: MnemosContext` fifth parameter to `runIteration()`; collect reasoning, prices, gas cost, and swap context during the loop; trigger snapshot + listing after the loop exits if a swap succeeded.

**Requirements:** R1, R3, R4, R6, R7, R10

**Dependencies:** U2, U3

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `test/unit/loop.test.ts`

**Approach:**

Add to `runIteration()` scope before the while loop:
- `const reasoningLog: string[] = []`
- `let latestPrices: PriceResult | null = null`
- `let latestGasCostUsd: number | null = null`
- `let swapContext: { params: SwapParams; result: SwapResult } | null = null`

**Reorder the while-loop top**: move the text-block pass (where `console.log('[Claude]', block.text)` runs) to the very top of each loop iteration — BEFORE all `stop_reason` checks. Also push `block.text` to `reasoningLog` there. This ensures reasoning from `max_tokens` responses is captured before the early-break, not silently dropped.

In the execute_swap dispatch branch (where `swapBlocks` are dispatched), capture `block.input as SwapParams` before calling `dispatchTool`. After receiving the result string, parse the JSON envelope with an explicit guard:
```
const parsed = JSON.parse(content) as { tool: string; data?: unknown; error?: string }
if (!parsed.error && parsed.data != null) { ... }
```
Only set `swapContext` when `!parsed.error && parsed.data != null` — a `wrapError` envelope has no `data` field, so this guards against treating a failed swap as a successful one. Note: `block.input` captures Claude's *requested* params (pre-floor adjustment) — this is intentional for the audit trail; `result.amountOut` records what was actually received.

After each non-swap tool result (in the `parallelResults` map), parse the envelope with the same explicit guard (`!parsed.error && parsed.data != null`) and update:
- `get_prices` → `latestPrices = parsed.data as PriceResult`
- `estimate_gas` → `latestGasCostUsd = (parsed.data as { gasCostUsd: number }).gasCostUsd`

After the while loop exits, if `mnemos && swapContext`:
```
try {
  const bundle = buildTradeBundle(swapContext.params, swapContext.result, latestPrices, latestGasCostUsd, reasoningLog.join('\n\n'), mnemos.stats)
  const snap = await mnemos.client.snapshot(bundle)
  const listTx = await mnemos.client.list(snap.tokenId, mnemos.terms)
  console.log(`[mnemos] Snapshot minted — tokenId: ${snap.tokenId}, tx: ${snap.txHash}, storage: ${snap.storageUri}`)
  console.log(`[mnemos] Listed — tokenId: ${snap.tokenId}, tx: ${listTx}`)
  mnemos.stats.totalTrades++
  mnemos.stats.totalGasCostUsd += (latestGasCostUsd ?? 0)
} catch (err) {
  console.error('[mnemos] Error:', err instanceof Error ? err.message : err)
}
```

**Test scenarios (add to loop.test.ts):**
- **Mnemos not provided:** `runIteration(clients, addr, max, model, undefined)` → completes normally, `snapshot` never called.
- **No swap → no snapshot:** Claude ends turn without execute_swap → `swapContext` remains null → `snapshot` not called.
- **Swap succeeds → snapshot called once:** Mock: turn 1 `get_prices`, turn 2 `execute_swap` (success), turn 3 `end_turn`. Verify `snapshot()` called once with bundle where `pricesAtTrade` matches the mocked `get_prices` data.
- **Snapshot error → no crash:** Mock `snapshot` throws → `runIteration()` resolves (no rethrow), `[mnemos] Error:` logged, `mnemos.stats.totalTrades` unchanged.
- **List error → no crash:** Mock `snapshot` succeeds, `list` throws → resolves, error logged, `stats.totalTrades` NOT incremented, `stats.totalGasCostUsd` NOT incremented (both `++` and `+=` are in the same `try` block after `list()`)
- **Reasoning joined:** Two text blocks across two turns → `bundle.data.context.claudeReasoning` contains both joined with `'\n\n'`.
- **Stats incremented after full success:** After swap + snapshot + list succeed → `mnemos.stats.totalTrades === 1` and `mnemos.stats.totalGasCostUsd` equals the mocked gas cost.
- **gasCostUsd null when estimate_gas skipped:** Claude calls get_prices and execute_swap but not estimate_gas → `bundle.data.trade.gasCostUsd === null`.
- **Existing tests unaffected:** All prior loop.test.ts scenarios pass; `mnemos` param omitted in existing test calls.

**Verification:**
- `npm run test:unit` — all loop tests pass including new scenarios.
- TypeScript compiles cleanly; no changes to `dispatchTool()` signature.

---

- U5. **Entry Point Integration (`src/index.ts`)**

**Goal:** Validate the 9 Mnemos required env vars, create `MnemosContext`, and pass it to `runIteration()`.

**Requirements:** R5, R7, R8, R9

**Dependencies:** U3, U4

**Files:**
- Modify: `src/index.ts`

**Approach:**
- Add 9 `requireEnv()` calls for: `OG_RPC_URL`, `OG_STORAGE_NODE`, `OG_CHAIN_ID`, `REGISTRY_ADDRESS`, `MARKETPLACE_ADDRESS`, `MNEMOS_BUY_PRICE`, `MNEMOS_RENT_PRICE_PER_DAY`, `MNEMOS_FORK_PRICE`, `MNEMOS_ROYALTY_BPS`.
- Read optional `MNEMOS_STORAGE_MOCK` as `process.env.MNEMOS_STORAGE_MOCK === 'true'`.
- Construct `MnemosEnv` from parsed values (R9: `privateKey` reuses existing `PRIVATE_KEY`).
- Create: `const mnemosClient = createMnemosClient(mnemosEnv)`, `const listingTerms = buildListingTerms(mnemosEnv)`, `const stats: CumulativeStats = { totalTrades: 0, totalGasCostUsd: 0 }`.
- Pass `{ client: mnemosClient, terms: listingTerms, stats }` as fifth arg in `tick()`.
- Extend startup log to include `OG_CHAIN_ID` and `MNEMOS_STORAGE_MOCK` values.
- Do not log `PRIVATE_KEY`, `ANTHROPIC_API_KEY`, or any price/fee values in plain text.

**Test scenarios:**
Test expectation: none — entry-point wiring; validated by startup smoke test and existing env validation pattern.

**Verification:**
- `npm start` with all env vars logs Mnemos context (chain ID, mock mode) at startup.
- `npm start` with one missing Mnemos var exits with code 1 and names the missing var.
- TypeScript compiles cleanly.

---

- U6. **Docs Update (`.env.example` + `CLAUDE.md`)**

**Goal:** Document all 9 new required env vars and explain Mnemos integration for operators.

**Requirements:** R8, R10

**Dependencies:** None

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

**Approach:**
- `.env.example`: Add a `# Mnemos / 0G Network` section with all 9 required vars and `MNEMOS_STORAGE_MOCK=false`. Include inline comments explaining format (e.g. `# Wei string`, `# Contract address (0x...)`).
- `CLAUDE.md`: Add "Mnemos Integration" section covering: what snapshots are, when they trigger (after confirmed swap), env vars table, `MNEMOS_STORAGE_MOCK=true` for testing without 0G node, log format (R10), partial-failure recovery note (snapshot minted but listing failed → operator can list manually using logged tokenId).

**Test scenarios:**
Test expectation: none — documentation files.

**Verification:**
- `.env.example` includes all 10 Mnemos-related vars (9 required + `MNEMOS_STORAGE_MOCK`).
- `CLAUDE.md` accurately covers F1, F2, and F3 failure modes.

---

## System-Wide Impact

- **Interaction graph:** Post-swap trigger: `runIteration → buildTradeBundle → MnemosClient.snapshot → 0G Storage + MemoryRegistry; then MnemosClient.list → MemoryMarketplace`. No new observers, callbacks, or middleware.
- **Error propagation:** Snapshot/list errors are caught inside `runIteration()` `try/catch`. They do not propagate to `tick()` in `index.ts`. The existing outer `try/catch` in `tick()` is not involved.
- **State lifecycle risks:** `CumulativeStats` is process-scoped and resets on restart (per spec — documented in CLAUDE.md). If the process crashes between `snapshot()` success and `list()` success, the token is minted but unlisted. Operator can manually list using the logged `tokenId`.
- **API surface parity:** `dispatchTool()` signature unchanged. `runIteration()` adds one optional parameter — no breaking change for existing callers.
- **Integration coverage:** End-to-end flow testable with `MNEMOS_STORAGE_MOCK=true` — no 0G node required. Set mock mode, run one iteration with a swap opportunity, observe `[mnemos]` log lines with stub URI.
- **Unchanged invariants:** All existing safety rails (`MAX_TRADE_USDC`, token whitelist, `min_amount_out` floor, sequential `execute_swap`) are unmodified. Mnemos wiring is read-only with respect to the swap execution path.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 0G SDK npm package name mismatch (`@0gfoundation` vs `@0glabs`) | Verify correct name on npm before U1; update deferred question resolution before install |
| 0G network down / RPC timeout during snapshot | R6: errors caught and logged; agent continues; minted-but-unlisted tokens are operator-recoverable |
| `MnemosClient` constructor throws on bad config | Called at startup in `index.ts`; bad config surfaces as startup crash with clear message before any iterations run |
| `block.input` cast to `SwapParams` in loop causes runtime mismatch | Claude is constrained by the `execute_swap` JSON schema in `definitions.ts`; types already validated at the tool definition boundary |
| Local file dep breaks if SDK dist is stale | Rebuild SDK (`pnpm sdk:build` from workspace root) and `npm install` in arbitrage-agent before testing after SDK source changes |
| `CumulativeStats` lost on restart | By design (R2 "in-memory counter, reset on restart") — noted in CLAUDE.md |

---

## Documentation / Operational Notes

- Use `MNEMOS_STORAGE_MOCK=true` for local development — no 0G node required, logs show stub URI.
- If agent crashes between `snapshot()` and `list()`, NFT is minted but unlisted. Manually list via marketplace frontend using the logged `tokenId`.
- Rebuild `@mnemos/sdk` dist before re-installing: `pnpm sdk:build` from workspace root, then `npm install` inside `arbitrage-agent/`.
- `OG_CHAIN_ID` value depends on environment (testnet vs mainnet) — confirm from 0G documentation.

---

## Sources & References

- **Origin document:** [docs/brainstorms/mnemos-sdk-integration-requirements.md](docs/brainstorms/mnemos-sdk-integration-requirements.md)
- SDK client implementation: `backend/packages/sdk/src/client.ts`
- SDK public types: `backend/packages/sdk/src/types.ts`
- Existing agent loop: `src/agent/loop.ts`
- Exported swap types: `src/tools/swap.ts:22-33`
- Exported price types: `src/tools/prices.ts:5-10`
