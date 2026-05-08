---
title: feat: Autonomous AI Arbitrage Agent
type: feat
status: active
date: 2026-05-08
origin: docs/brainstorms/arbitrage-agent-requirements.md
---

# feat: Autonomous AI Arbitrage Agent

## Overview

Membangun autonomous AI agent yang menggunakan Claude sebagai sole decision-maker untuk mendeteksi dan mengeksekusi peluang arbitrage WETH/USDC antara Uniswap V2 dan V3 di ETH mainnet, serta SushiSwap V2 dan Uniswap V3 di Arbitrum One. Runtime menyediakan 4 blockchain tools yang Claude panggil via Anthropic tool_use API; semua keputusan trading ada di reasoning Claude. Safety rail `MAX_TRADE_USDC` di-enforce di level kode runtime dan tidak bisa di-override Claude.

Project dikonversi dari JavaScript CommonJS ke TypeScript ESM dan menggunakan **viem 2.x** untuk semua interaksi blockchain.

---

## Problem Frame

Developer ingin menguji autonomous AI agent untuk arbitrage kripto — bukan rule-based bot, melainkan agent di mana Claude menganalisis data on-chain dan memutuskan sendiri apakah dan bagaimana mengeksekusi trade. Fokus pada kebenaran logika agent dan kemampuan transaksi on-chain berjalan, bukan profit maksimum. (see origin: docs/brainstorms/arbitrage-agent-requirements.md)

---

## Requirements Trace

- R1–R2. `get_prices` mengembalikan harga WETH/USDC (USDC per WETH) dari 4 pool dalam unit sebanding untuk semua pool.
- R3. `get_wallet_balance` mengembalikan saldo WETH dan USDC di kedua network.
- R4. `estimate_gas` mengembalikan estimasi biaya gas satu swap dalam USD, menerima parameter `network` dan `dex`.
- R5–R7. `execute_swap` menerima parameter dari Claude, memvalidasi `MAX_TRADE_USDC`, sign + broadcast tx, tunggu konfirmasi, return tx hash dan amount actual.
- R8–R11. Bot menjalankan outer polling loop tiap N detik; setiap iterasi invoke Claude fresh dengan 4 tools; log reasoning dan setiap tool call ke konsol.
- R12–R13. Konfigurasi via `.env`; `MAX_TRADE_USDC` di-enforce oleh runtime tanpa pengecualian.
- R14. `CLAUDE.md` di root project.

**Origin actors:** A1 (Claude AI agent), A2 (Runtime/bot process), A3 (Operator/developer)
**Origin flows:** F1 (Iteration cycle — happy path), F2 (Safety rail triggered)

---

## Scope Boundaries

- Cross-network arbitrage (ETH mainnet ↔ Arbitrum) — memerlukan bridge, tidak termasuk.
- Flash loan / smart contract deployment — tidak termasuk.
- Token pair selain WETH/USDC — tidak termasuk.
- MEV protection / frontrunning protection — tidak termasuk.
- Production hardening (circuit breaker, retry otomatis, rate limiting) — tidak termasuk.
- Configurable token pair via UI — tidak termasuk.

---

## Context & Research

### Relevant Code and Patterns

- Project greenfield — `src/priceMonitor.js` (empty, 1 line) satu-satunya source file; file ini dihapus di U1.
- `@anthropic-ai/sdk` 0.95.1 dan `dotenv` 17.4.2 sudah terpasang; `viem` belum ada.
- Node.js v22.19.0 tersedia. `"type": "commonjs"` di package.json harus diubah ke `"module"` untuk ESM.
- Tidak ada CLAUDE.md, AGENTS.md, atau docs/solutions/ — semua dibuat baru.

### External References

- **viem 2.28.x**: `createPublicClient`/`createWalletClient` dengan `http(rpcUrl)` dan `chain`. `readContract` untuk view functions. `simulateContract` untuk non-view via eth_call (QuoterV2). `writeContract` + `waitForTransactionReceipt` untuk swap. `privateKeyToAccount` dari `viem/accounts`.
- **Anthropic tool_use loop**: `messages.create` dengan `tools` dan `messages`. Loop `while (response.stop_reason === 'tool_use')` — dispatch semua `tool_use` blocks, kirim semua `tool_result` dalam satu user turn, append full `response.content` ke history.
- **Uniswap V2 interface**: `IUniswapV2Pair.getReserves()` → `(reserve0, reserve1, blockTimestampLast)`. `IUniswapV2Router02.swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)`.
- **Uniswap V3 QuoterV2**: `quoteExactInputSingle({ tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96 })` → dipanggil via `simulateContract` karena fungsi `nonpayable`.
- **Uniswap V3 SwapRouter**: `exactInputSingle({ tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96 })`.

---

## Key Technical Decisions

- **TypeScript ESM**: Viem adalah TypeScript-first; ESM memberikan kompatibilitas penuh. `"type": "module"` di package.json, `moduleResolution: "bundler"` di tsconfig. `tsx` untuk menjalankan TypeScript langsung.
- **Outer polling loop**: Setiap iterasi adalah percakapan Claude yang fresh dan independen. Lebih mudah dikontrol dan di-debug dibanding single long-running agent.
- **SushiSwap V2 di Arbitrum**: SushiSwap adalah fork Uniswap V2 dengan ABI identik — `getReserves`, `swapExactTokensForTokens` persis sama. Lebih liquid untuk WETH/USDC di Arbitrum.
- **QuoterV2 untuk harga V3**: Lebih akurat dari manual sqrtPriceX96 math karena sudah memperhitungkan fee tier. Dipanggil via `simulateContract` (non-view via eth_call).
- **`getReserves()` untuk harga V2**: Direct pair contract read — murah dan akurat.
- **Gas cost dalam USD**: `(gasLimit * gasPriceWei / 10n**18n) * ethPriceUsdc` — bigint dibagi 1e18 dulu sebelum dikonversi ke Number, untuk menghindari overflow di mainnet gas price tinggi. ETH price di-fetch secara independen via V3 ETH mainnet pool di dalam `estimate_gas` tool sendiri, bukan dari caller context.
- **Runtime min_amount_out floor**: Terlepas dari nilai yang Claude berikan, `execute_swap` memvalidasi bahwa `min_amount_out >= currentQuote * 90% / 100%`. Current quote di-fetch secara independen via QuoterV2 di dalam `swap.ts` — bukan dari data yang Claude berikan. Ini mencegah Claude (atau prompt injection) mengeset slippage nol.
- **Token whitelist validation**: `execute_swap` memvalidasi bahwa `token_in` dan `token_out` adalah WETH dan USDC yang diketahui untuk network yang diminta (diambil dari `ADDRESSES[network]`). Throw sebelum approval jika alamat di luar whitelist.
- **Token approval per-swap**: Approve exact `amount_in` (bukan maxUint256) sebelum setiap swap, dan reset ke 0 setelah swap selesai. Ini membatasi exposure jika router dikompromikan.
- **Sequential dispatch untuk execute_swap**: Jika Claude mengirim `execute_swap` bersama tool lain dalam satu turn, jalankan semua tool non-swap terlebih dahulu (parallel), lalu `execute_swap` terakhir secara sequential.
- **Structured tool result envelope**: Setiap tool result di-wrap dalam JSON `{ tool: name, data: result }` sebelum dikirim ke Claude sebagai string content. Raw on-chain strings (revert messages, event data) tidak pernah di-interpolasi langsung sebagai bare text.
- **Satu viem client per network**: Client di-inisialisasi sekali saat startup, di-inject ke semua tool implementations sebagai dependency. Tidak ada re-creation per tool call.
- **Bigint untuk semua on-chain amounts**: Amounts disimpan sebagai bigint native, hanya dikonversi ke string saat dikirim ke Claude (JSON tidak support bigint).
- **`as const` ABI**: Semua ABI arrays didefinisikan dengan `as const` untuk TypeScript inference penuh di `readContract`/`simulateContract`.

---

## Open Questions

### Resolved During Planning

- **Loop pattern**: Outer polling (fresh conversation tiap N detik). Lebih kontrolabel untuk testing.
- **Language**: TypeScript ESM. viem-native, type-safe.
- **V2 di Arbitrum**: SushiSwap V2 — ABI identik Uniswap V2, lebih liquid.
- **V3 price method**: QuoterV2 via `simulateContract`, bukan manual sqrtPriceX96 math.
- **Gas limit**: Konstanta (V2: 150k, V3: 180k) lebih predictable dari `estimateContractGas`.
- **`min_amount_out`**: Claude menyarankan nilai; runtime floor (90% dari quote saat ini) di-enforce oleh swap.ts secara independen.
- **ETH price sumber**: Di-fetch secara independen di dalam setiap tool yang membutuhkannya (estimate_gas, swap.ts) — bukan dari data yang Claude berikan atau dari loop state.

### Deferred to Implementation

- **SushiSwap WETH/USDC pair address di Arbitrum**: Harus di-resolve di awal implementasi U2 via `factory.getPair(WETH, USDC)` on-chain sebelum melanjutkan — bukan defer ke akhir. Ini adalah prerequisite dari U3.
- **Uniswap V3 WETH/USDC 0.05% pool address di Arbitrum**: Alamat `0xC6962004f452bE9203591991D15f6b388e09E8D0` perlu diverifikasi on-chain sebelum di-hardcode.
- **Apakah perlu account di simulateContract untuk QuoterV2**: Uji apakah provider menolak tanpa `from` — jika ya, pass dummy address `0x0000...0001`.

---

## Output Structure

    src/
      config/
        addresses.ts      # Token + contract addresses per network (typed, verified)
        abis.ts           # Minimal ABI as const untuk 5 contract interfaces
        chains.ts         # viem client factory — createClients(network) → { publicClient, walletClient }
      tools/
        prices.ts         # get_prices: V2 getReserves + V3 QuoterV2, normalized ke USDC/WETH
        balance.ts        # get_wallet_balance: ERC20.balanceOf × 4 (WETH+USDC × 2 networks)
        gas.ts            # estimate_gas: gasLimit * gasPrice * ethPrice / 1e18
        swap.ts           # execute_swap: validate → approve → simulateContract → writeContract
      agent/
        definitions.ts    # Tool schemas (Tool[]) untuk Anthropic API
        prompt.ts         # System prompt string
        loop.ts           # runIteration(): agentic loop + tool dispatcher + logging
      index.ts            # Entry point: env validation, client init, setInterval
    test/
      unit/
        prices.test.ts    # normalizeV2Price, normalizeV3Price (pure functions)
        swap.test.ts      # validateAmount, buildDeadline, encodeSwapParams
        gas.test.ts       # calculateGasCostUsd (pure function)
      integration/
        prices.integration.test.ts    # Real RPC: semua 4 harga non-zero, comparable
        balance.integration.test.ts   # Real RPC: balance structure valid
    CLAUDE.md
    .env.example
    tsconfig.json
    vitest.config.ts

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    participant Timer as setInterval (index.ts)
    participant Loop as runIteration (loop.ts)
    participant Claude as Anthropic API
    participant Tools as Tool Implementations
    participant Chain as Blockchain via viem

    loop Every POLL_INTERVAL_SECONDS
        Timer->>Loop: invoke runIteration(clients)
        Loop->>Claude: messages.create({ system, tools, messages: [user: "Analyze..."] })
        Claude-->>Loop: stop_reason: "tool_use" [get_prices]
        Loop->>Loop: append assistant content to messages
        Loop->>Tools: dispatch("get_prices")
        Tools->>Chain: readContract(V2Pair.getReserves) ×2 (eth + arb)
        Tools->>Chain: simulateContract(QuoterV2.quoteExactInputSingle) ×2 (eth + arb)
        Tools-->>Loop: { ethereum: {v2, v3}, arbitrum: {v2, v3} }
        Loop->>Loop: append tool_result to messages
        Loop->>Claude: messages.create({ messages: [..., tool_result] })

        opt Claude calls get_wallet_balance or estimate_gas
            Claude-->>Loop: stop_reason: "tool_use" [tool name]
            Loop->>Tools: dispatch(tool name)
            Tools->>Chain: readContract / getGasPrice
            Tools-->>Loop: result
            Loop->>Loop: append tool_result
            Loop->>Claude: messages.create(...)
        end

        opt Claude decides to execute swap
            Claude-->>Loop: stop_reason: "tool_use" [execute_swap]
            Loop->>Tools: dispatch("execute_swap", params)
            Tools->>Tools: validateAmount(amount, MAX_TRADE_USDC) — throw if exceeded (F2)
            Tools->>Chain: readContract(ERC20.allowance)
            opt allowance < amountIn
                Tools->>Chain: writeContract(ERC20.approve maxUint256)
                Tools->>Chain: waitForTransactionReceipt(approveTxHash)
            end
            Tools->>Chain: simulateContract(Router.swap) — preflight revert check
            Tools->>Chain: writeContract(Router.swap, request from simulate)
            Tools->>Chain: waitForTransactionReceipt(swapTxHash)
            Tools-->>Loop: { txHash, amountOut }
            Loop->>Loop: append tool_result
            Loop->>Claude: messages.create(...)
        end

        Claude-->>Loop: stop_reason: "end_turn" [text: reasoning]
        Loop->>Loop: log(reasoning + all tool calls summary)
    end
```

**Token order note (V2 pairs)**: Uniswap V2 sorts token addresses lexicographically. `token0` selalu address yang lebih kecil. Saat membaca `getReserves`, implementasi harus cek `token0 === WETH_ADDRESS` untuk menentukan apakah `reserve0` adalah WETH atau USDC.

---

## Implementation Units

- U1. **TypeScript + Tooling Setup**

**Goal:** Konversi project ke TypeScript ESM, install viem dan Vitest, hapus file JS legacy.

**Requirements:** R13 (env config via .env), R14 (project structure)

**Dependencies:** None

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Delete: `src/priceMonitor.js`

**Approach:**
- `.gitignore`: Tambahkan `.env`, `*.env`, `dist/` — **kritis, harus jadi perubahan pertama sebelum funded wallet dikonfigurasi.**
- `package.json`: Ubah `"type"` ke `"module"`. Add `dependencies: { viem }`. Add `devDependencies: { typescript, tsx, vitest, @types/node }`. Scripts: `"start": "tsx src/index.ts"`, `"test:unit": "vitest run --project unit"`, `"test:integration": "vitest run --project integration"`, `"build": "tsc"`.
- `tsconfig.json`: `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `strict: true`, `outDir: "dist"`, `rootDir: "."`, `include: ["src", "test"]`.
- `vitest.config.ts`: Gunakan `defineWorkspace` dengan dua projects — `unit` (include `test/unit/**/*.test.ts`, environment `node`) dan `integration` (include `test/integration/**/*.test.ts`, environment `node`, timeout lebih tinggi karena real RPC calls).
- Tidak ada module-level client initialization di file manapun. Client dibuat di dalam fungsi, bukan top-level const, karena ESM static imports di-hoist sebelum `import 'dotenv/config'` sempat berjalan.

**Test scenarios:**
Test expectation: none — pure scaffolding, tidak ada logika behavioral.

**Verification:**
- `npm run test:unit` dan `npm run test:integration` dapat dipanggil tanpa module/syntax error.
- `npm run start` tidak crash saat startup (env validation di U7 akan fail gracefully).

---

- U2. **Configuration Layer**

**Goal:** Sentralisasi semua contract addresses, token addresses, ABI definitions, dan viem client factory.

**Requirements:** R1, R3, R5, R13

**Dependencies:** U1

**Files:**
- Create: `src/config/addresses.ts`
- Create: `src/config/abis.ts`
- Create: `src/config/chains.ts`

**Approach:**
- `addresses.ts`: Object `ADDRESSES` dengan struktur `{ ethereum: {...}, arbitrum: {...} }`. Setiap network berisi: `weth`, `usdc`, `v2Router`, `v2Pair`, `v3Router`, `v3Quoter`, `v3Pool`. Tipe `'ethereum' | 'arbitrum'` di-export sebagai type alias `Network`.

  Contract addresses (beberapa perlu diverifikasi saat implementasi):

  *Ethereum Mainnet:*
  - WETH: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`
  - USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
  - Uniswap V2 Router: `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`
  - Uniswap V2 WETH/USDC Pair: `0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc`
  - Uniswap V3 SwapRouter: `0xE592427A0AEce92De3Edee1F18E0157C05861564`
  - Uniswap V3 QuoterV2: `0x61fFE014bA17989E743c5F6cB21bF9697530B21e`
  - Uniswap V3 WETH/USDC 0.05% Pool: `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640`

  *Arbitrum One:*
  - WETH: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`
  - USDC (native): `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
  - SushiSwap Router: `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506`
  - SushiSwap Factory: `0xc35DADB65012eC5796536bD9864eD8773aBc74C4`
  - SushiSwap WETH/USDC Pair: **[VERIFY via factory.getPair(WETH, USDC) saat implementasi]**
  - Uniswap V3 SwapRouter: `0xE592427A0AEce92De3Edee1F18E0157C05861564` (sama dengan mainnet)
  - Uniswap V3 QuoterV2: `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` (sama dengan mainnet)
  - Uniswap V3 WETH/USDC 0.05% Pool: **[VERIFY — kandidat `0xC6962004f452bE9203591991D15f6b388e09E8D0`]**

- `abis.ts`: Minimal ABI arrays `as const` untuk 5 interfaces:
  - `erc20Abi`: `balanceOf`, `allowance`, `approve`
  - `uniV2PairAbi`: `getReserves`, `token0`
  - `uniV2RouterAbi`: `swapExactTokensForTokens`
  - `quoterV2Abi`: `quoteExactInputSingle`
  - `swapRouterV3Abi`: `exactInputSingle`

- `chains.ts`: Export `type Clients = { publicClient, walletClient }`. Function `createClients(network: Network, config: EnvConfig): Clients` — inisialisasi `createPublicClient` dan `createWalletClient` dengan chain dari `viem/chains` (`mainnet` atau `arbitrum`) dan `http(rpcUrl)`. `privateKeyToAccount` dari `viem/accounts`. Return typed object. Di-call sekali di `index.ts`, hasilnya di-pass ke tool implementations.

**Prerequisite — SushiSwap pair address**: Sebelum menulis `addresses.ts`, jalankan satu-kali `readContract(SushiSwapFactory.getPair(WETH_ARB, USDC_ARB))` via viem untuk mendapatkan pair address yang benar. Hardcode hasilnya. Ini adalah prerequisite U3 (get_prices membutuhkan address ini). SushiSwap Factory ABI minimal: `function getPair(address, address) external view returns (address)`.

**Test scenarios:**
Test expectation: none — pure config/data. Kebenaran address divalidasi oleh integration tests.

**Verification:**
- `createClients('ethereum', config)` dan `createClients('arbitrum', config)` return typed objects tanpa throw.
- TypeScript kompilasi tanpa error di seluruh module.
- SushiSwap pair address di `addresses.ts` telah diverifikasi via factory call (bukan hardcoded dari memory).

---

- U3. **Price Reading Tool**

**Goal:** Implementasi `get_prices` yang mengembalikan harga WETH/USDC dari semua 4 pool.

**Requirements:** R1, R2

**Dependencies:** U2

**Files:**
- Create: `src/tools/prices.ts`
- Create: `test/unit/prices.test.ts`
- Create: `test/integration/prices.integration.test.ts`

**Approach:**
- Fungsi utama: `getPrices(clients: { ethereum: Clients, arbitrum: Clients }): Promise<PriceResult>`.
- Return type `PriceResult`: `{ ethereum: { v2: number, v3: number }, arbitrum: { v2: number, v3: number } }`. Semua nilai dalam USDC per WETH sebagai float (untuk dibandingkan langsung oleh Claude).
- **V2 price** via `readContract(v2PairAbi.getReserves)`:
  - Cek `token0` dari pair — jika `token0.toLowerCase() === WETH.toLowerCase()` maka `reserve0` adalah WETH, `reserve1` adalah USDC.
  - Jika sebaliknya, reserve0 adalah USDC, reserve1 adalah WETH.
  - `price = Number(reserveUsdc) / 1e6 / (Number(reserveWeth) / 1e18)`
  - Extract ke pure function `normalizeV2Price(reserve0: bigint, reserve1: bigint, token0IsWeth: boolean): number`
- **V3 price** via `simulateContract(quoterV2Abi.quoteExactInputSingle)`:
  - Args: `{ tokenIn: WETH, tokenOut: USDC, fee: 500n, amountIn: 10n**18n (1 WETH), sqrtPriceLimitX96: 0n }`
  - `result[0]` adalah USDC amount out dalam 6 desimal.
  - `price = Number(result[0]) / 1e6`
  - Extract ke pure function `normalizeV3Price(amountOut: bigint): number`
- Keempat pool di-fetch secara paralel via `Promise.all` untuk minimasi latency.
- Jika satu pool fetch gagal, throw error dengan nama pool yang gagal untuk debugging.

**Execution note:** Implementasikan helper pure functions (`normalizeV2Price`, `normalizeV3Price`) sebelum fungsi utama untuk memudahkan test-first development.

**Test scenarios:**
- **Unit — Happy path V2:** `normalizeV2Price(1n * 10n**18n, 2000n * 10n**6n, true)` returns `2000.0`
- **Unit — Token order reversed:** `normalizeV2Price(2000n * 10n**6n, 1n * 10n**18n, false)` returns `2000.0`
- **Unit — V3 price:** `normalizeV3Price(2500n * 10n**6n)` returns `2500.0`
- **Unit — Decimal precision:** `normalizeV2Price` dengan reserve yang menghasilkan harga dengan desimal (misal 1892.37) akurat dalam batas float JS.
- **Unit — Zero reserves:** `normalizeV2Price(0n, 1n, true)` returns `Infinity` atau throw — perilaku harus deterministik; pilih throw dengan pesan jelas.
- **Integration:** `getPrices(clients)` dengan real RPC — semua 4 nilai non-zero, dalam range 100–100000 (sanity check), semua dalam unit yang sama (USDC per WETH).
- **Integration:** Keempat harga dapat dibandingkan secara langsung sebagai float (tidak ada unit mismatch).

**Verification:**
- Unit tests pass tanpa RPC calls (mock `readContract` dan `simulateContract`).
- Integration test return harga valid dari semua 4 pool dengan real RPC URL.

---

- U4. **Wallet & Gas Tools**

**Goal:** Implementasi `get_wallet_balance` dan `estimate_gas` tools.

**Requirements:** R3, R4

**Dependencies:** U2, U3 (gas butuh ETH price dari prices.ts)

**Files:**
- Create: `src/tools/balance.ts`
- Create: `src/tools/gas.ts`
- Create: `test/unit/gas.test.ts`
- Create: `test/integration/balance.integration.test.ts`

**Approach:**
- `balance.ts` — `getWalletBalance(address, clients)`:
  - 4 `readContract(erc20Abi.balanceOf)` calls secara paralel (WETH + USDC × 2 networks).
  - Return: `{ ethereum: { weth: string, usdc: string }, arbitrum: { weth: string, usdc: string } }` — bigint dikonversi ke decimal string karena JSON tidak support bigint. Include label satuan: weth dalam wei, usdc dalam unit terkecil (6 desimal).

- `gas.ts` — `estimateGas(network, dex, clients)`:
  - Tidak menerima `ethPriceUsdc` dari caller. **Fetch ETH price secara independen** via `simulateContract(QuoterV2, { tokenIn: WETH_ETH, tokenOut: USDC_ETH, fee: 500n, amountIn: 1e18n })` pada ETH mainnet public client. Ini membuat estimasi tidak tergantung data dari Claude.
  - Gas limit constant: `const GAS_LIMIT = { v2: 150_000n, v3: 180_000n }`.
  - `publicClient.getGasPrice()` → `gasPriceWei`.
  - `calculateGasCostUsd(gasLimit, gasPriceWei, ethPriceUsdc): number` — pure function, testable.
  - Formula (bigint-safe): `Number(gasLimit * gasPriceWei / 10n**18n) * ethPriceUsdc`. Bigint division dulu sebelum `Number()` untuk menghindari overflow di gas price tinggi.
  - Return: `{ gasCostUsd: number, gasLimit: string, gasPriceGwei: string }` — semua serializable untuk Claude.

**Test scenarios:**
- **Unit — Gas cost:** `calculateGasCostUsd(150_000n, 10n ** 9n /* 1 gwei */, 2000)` = `150_000 * 1e-9 * 2000 = 0.3 USD` ✓
- **Unit — High gas:** `calculateGasCostUsd(180_000n, 100n ** 9n, 3000)` returns correct positive value
- **Unit — Zero gas price:** `calculateGasCostUsd(150_000n, 0n, 2000)` returns `0`
- **Unit — Precision:** Hasilnya adalah float dengan presisi yang masuk akal (bukan NaN atau Infinity)
- **Integration:** `getWalletBalance(address, clients)` dengan real RPC — return object dengan struktur yang benar, semua values parseable ke BigInt
- **Integration — Non-negative:** Semua balance non-negative

**Verification:**
- Unit tests untuk `calculateGasCostUsd` pass tanpa RPC.
- Integration test untuk `getWalletBalance` return valid structure.

---

- U5. **Swap Execution Tool**

**Goal:** Implementasi `execute_swap` dengan MAX_TRADE_USDC validation, token approval, dan swap execution via viem.

**Requirements:** R5, R6, R7

**Dependencies:** U2

**Files:**
- Create: `src/tools/swap.ts`
- Create: `test/unit/swap.test.ts`

**Approach:**
- Input type: `{ network: Network, dex: 'v2' | 'v3', token_in: string, token_out: string, amount_in: string, min_amount_out: string }` — semua amount sebagai decimal string (Claude tidak bisa serialize bigint).
- **Step 0 — Token whitelist validation** (sebelum apapun):
  - Bandingkan `token_in` dan `token_out` dengan `ADDRESSES[network].weth` dan `ADDRESSES[network].usdc` (case-insensitive).
  - Throw `Error("Invalid token address: ...")` jika salah satu tidak ada di whitelist. Ini mencegah Claude (atau prompt injection) melakukan swap ke token arbitrary.
- **Step 1 — Amount validation** (R6, F2):
  - Parse `amount_in` ke bigint.
  - Tentukan USDC equivalent: jika `token_in === USDC_ADDRESS` pakai `amount_in` langsung. Jika WETH, fetch harga ETH secara independen via QuoterV2 pada network target (bukan dari data Claude) → konversi ke USDC.
  - Bandingkan dengan `MAX_TRADE_USDC` (dari env, dalam USDC units 6 desimal).
  - Throw `Error("amount exceeds MAX_TRADE_USDC: ${actual} > ${max}")` jika exceeded.
- **Step 1b — min_amount_out floor**:
  - Fetch current quote independen via `simulateContract(QuoterV2.quoteExactInputSingle)` pada pool target.
  - `runtimeFloor = currentQuote * 90n / 100n` (10% max slippage sebagai hard floor).
  - Parse `min_amount_out` dari Claude ke bigint. Jika `claudeMinAmount < runtimeFloor` → gunakan `runtimeFloor`, log warning "min_amount_out clamped to runtime floor".
  - Ini mencegah Claude (atau prompt injection) mengeset slippage nol.
- **Step 2 — Approval** (exact-amount, per-swap):
  - `readContract(erc20Abi.allowance(walletAddress, routerAddress))` → `currentAllowance`.
  - Jika `currentAllowance < amount_in_bigint` → `writeContract(erc20Abi.approve(routerAddress, amount_in_bigint))` → `waitForTransactionReceipt`. Exact amount, bukan maxUint256.
- **Step 3 — Swap** (simulate-then-write pattern):
  - V2: `simulateContract(uniV2RouterAbi.swapExactTokensForTokens, [amount_in, effectiveMinOut, [token_in, token_out], walletAddress, deadline])`.
  - V3: `simulateContract(swapRouterV3Abi.exactInputSingle, { tokenIn, tokenOut, fee: 500n, recipient: walletAddress, deadline, amountIn, amountOutMinimum: effectiveMinOut })`.
  - Jika simulate tidak throw → `walletClient.writeContract(request)` → `waitForTransactionReceipt`.
  - Jika `receipt.status === 'reverted'` → throw dengan tx hash.
- Deadline: `BigInt(Math.floor(Date.now() / 1000) + 600)` (10 menit).
- Return: `{ txHash: string, amountOut: string, status: 'success' | 'reverted' }`.
- Pure helpers (testable): `validateTokenWhitelist(tokenIn, tokenOut, network)`, `validateAmount(amountInBigint, tokenIn, usdcPrice, maxTradeUsdc, usdcAddress)`, `buildDeadline(): bigint`, `clampMinAmountOut(claudeMin, runtimeFloor): bigint`.
- Integration test untuk swap execution bersifat **opsional/skipped by default** — memerlukan funded wallet dan real gas.

**Test scenarios:**
- **Unit — Token whitelist pass:** `validateTokenWhitelist(WETH_ETH, USDC_ETH, 'ethereum')` tidak throw
- **Unit — Token whitelist fail:** `validateTokenWhitelist('0xDeAdBeEf...', USDC_ETH, 'ethereum')` throw dengan pesan "Invalid token address"
- **Unit — Validation pass:** `validateAmount(parseUnits('50', 6), USDC_ADDR, 2000, 100, USDC_ADDR)` tidak throw (50 USDC < 100 MAX)
- **Unit — Validation fail:** `validateAmount(parseUnits('200', 6), USDC_ADDR, 2000, 100, USDC_ADDR)` throw dengan pesan mengandung "MAX_TRADE_USDC"
- **Unit — Validation boundary exact:** amount tepat di MAX_TRADE_USDC → tidak throw
- **Unit — Validation boundary exceed by 1:** satu unit di atas MAX → throw
- **Unit — WETH validation:** `validateAmount(parseUnits('1', 18), WETH_ADDR, 2000, 100, USDC_ADDR)` — WETH senilai $2000 terhadap MAX $100 → throw
- **Unit — min_amount_out clamp:** `clampMinAmountOut(1n, 1000n * 10n**6n)` returns `900n * 10n**6n` (90% floor)
- **Unit — min_amount_out no clamp:** Claude set 995 dari 1000 → tidak di-clamp (>90%)
- **Unit — Deadline:** `buildDeadline()` > `BigInt(Math.floor(Date.now() / 1000) + 500)` ✓
- **Error path — Token not in whitelist:** Throw sebelum approval dipanggil
- **Error path — Simulate reverts:** `simulateContract` throw → tidak kirim `writeContract`, error di-propagate
- **Integration (skipped by default):** Jalankan manual dengan `ENABLE_SWAP_TEST=true`; tx hash valid di block explorer

**Verification:**
- Semua unit tests pass.
- `validateTokenWhitelist` mencegah swap ke token di luar WETH/USDC.
- `validateAmount` mencegah transaksi di atas `MAX_TRADE_USDC` untuk WETH dan USDC input.
- `clampMinAmountOut` memastikan runtime floor 90% selalu berlaku.
- `simulate-then-write` pattern memastikan gas tidak terbuang untuk reverts yang bisa dideteksi.

---

- U6. **Agent Tool Definitions & System Prompt**

**Goal:** Definisikan JSON Schema tools untuk Anthropic API dan system prompt yang menginstruksikan Claude.

**Requirements:** R8, R9, R10

**Dependencies:** None (pure data — tidak ada import dari business logic)

**Files:**
- Create: `src/agent/definitions.ts`
- Create: `src/agent/prompt.ts`

**Approach:**
- `definitions.ts`: Export `TOOLS: Tool[]` (tipe dari `@anthropic-ai/sdk`). 4 tool definitions dengan `input_schema` yang ketat:
  - `get_prices`: Tidak ada input parameter (selalu ambil semua 4 pool).
  - `get_wallet_balance`: Tidak ada input parameter.
  - `estimate_gas`: `{ network: enum['ethereum', 'arbitrum'], dex: enum['v2', 'v3'] }` — untuk estimasi gas di pool spesifik.
  - `execute_swap`: `{ network, dex, token_in, token_out, amount_in, min_amount_out }` — semua string. Description di setiap field jelaskan format (wei sebagai decimal string, checksum address, dll).
- `prompt.ts`: System prompt yang instruksikan Claude:
  1. Peran: autonomous arbitrage agent di WETH/USDC pool
  2. Mulai setiap iterasi dengan `get_prices` untuk data terkini
  3. Pertimbangkan `get_wallet_balance` jika modal perlu dicek
  4. Gunakan `estimate_gas` untuk hitung profitabilitas: spread harus > gas cost
  5. Untuk `execute_swap`, hitung `min_amount_out = expected_output_bigint * 995n / 1000n` (0.5% slippage)
  6. Arbitrage hanya intra-network (V2 vs V3 pada network yang sama)
  7. Jelaskan reasoning secara eksplisit di response text — termasuk mengapa memutuskan execute atau skip
  8. Amounts selalu dalam format: wei sebagai decimal string

**Test scenarios:**
Test expectation: none — pure schema dan text data, tidak ada logika behavioral.

**Verification:**
- TypeScript kompilasi tanpa error.
- `TOOLS` array dapat di-serialize ke JSON tanpa circular references.
- Tool names di `definitions.ts` konsisten dengan switch-case di `loop.ts` (U7).

---

- U7. **Agent Loop**

**Goal:** Outer polling loop yang invoke Claude, dispatch tool calls, dan log reasoning tiap iterasi.

**Requirements:** R8, R10, R11

**Dependencies:** U3, U4, U5, U6

**Files:**
- Create: `src/agent/loop.ts`
- Create: `src/index.ts`
- Create: `test/unit/loop.test.ts`

**Approach:**
- `loop.ts` — `runIteration(clients: { ethereum: Clients, arbitrum: Clients }): Promise<void>`:
  1. Init `messages: MessageParam[] = [{ role: 'user', content: 'Analyze current WETH/USDC arbitrage opportunities.' }]`
  2. Loop: `while (true)`:
     a. `response = await anthropic.messages.create({ model, system: SYSTEM_PROMPT, tools: TOOLS, messages, max_tokens: 4096 })`
     b. Append `{ role: 'assistant', content: response.content }` ke messages.
     c. **Handle max_tokens**: Jika `response.stop_reason === 'max_tokens'` → log warning `[WARN] max_tokens reached — aborting iteration`, break. Jangan lanjutkan dengan history yang berpotensi corrupted.
     d. Jika `response.stop_reason !== 'tool_use'` → log final text, break.
     e. Filter `tool_use` blocks dari `response.content`.
     f. **Sequential dispatch untuk execute_swap**: Partition blocks menjadi `nonSwapBlocks` dan `swapBlock`. Jalankan `Promise.all(nonSwapBlocks.map(dispatchTool))` dulu, collect results. Lalu — jika ada `swapBlock` — await `dispatchTool(swapBlock)` secara sequential. Gabungkan semua results.
     g. **Structured result envelope**: Setiap tool result di-serialize sebagai `JSON.stringify({ tool: name, data: rawResult })` sebelum dijadikan content `tool_result`. Raw strings dari on-chain (revert messages, addresses) tidak di-interpolasi sebagai bare text.
     h. Append `{ role: 'user', content: toolResults }` ke messages. Satu user turn, semua tool results.
  3. Log per tool call: `[TOOL] name → result (Xms)`. Input tidak di-log secara raw (bisa mengandung sensitive strings dari chain).
  4. Log final reasoning text dari Claude.

- `loop.ts` — `dispatchTool(block: ToolUseBlock, clients)`:
  - Switch-case dengan 4 cases, throw pada unknown tool name.
  - Cast `block.input` ke expected type; tidak ada runtime validation lebih lanjut di sini — validasi ada di tool implementations.
  - Wrap error dalam `{ type: 'tool_result', tool_use_id: block.id, is_error: true, content: JSON.stringify({ error: err.message }) }`.

- `index.ts`:
  1. `import 'dotenv/config'` — **harus menjadi import pertama, sebelum semua import lainnya**.
  2. Validate env: `RPC_URL_ETHEREUM`, `RPC_URL_ARBITRUM`, `PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `MAX_TRADE_USDC` — exit dengan `process.exit(1)` dan pesan jelas jika ada yang hilang. Log env values tapi **JANGAN log `PRIVATE_KEY` atau `ANTHROPIC_API_KEY`**.
  3. Init clients via `createClients()` untuk kedua network.
  4. Log startup: `Arbitrage Bot Started | Networks: ethereum, arbitrum | MAX_TRADE_USDC: ${X} | Interval: ${Y}s`.
  5. Jalankan iterasi pertama langsung (tidak tunggu interval pertama).
  6. `setInterval(() => runIteration(clients), POLL_INTERVAL_SECONDS * 1000)`.

- `index.ts`:
  1. Validate env: `RPC_URL_ETHEREUM`, `RPC_URL_ARBITRUM`, `PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `MAX_TRADE_USDC` — exit dengan `process.exit(1)` dan pesan jelas jika ada yang hilang.
  2. Init clients via `createClients()` untuk kedua network.
  3. Log startup: `Arbitrage Bot Started | Networks: ethereum, arbitrum | Pools: UniV2+V3 each | MAX_TRADE_USDC: ${X} | Interval: ${Y}s`.
  4. Jalankan iterasi pertama langsung (tidak tunggu interval pertama).
  5. `setInterval(runIteration, POLL_INTERVAL_SECONDS * 1000)`.

- Anthropic client: `new Anthropic()` — auto-pick `ANTHROPIC_API_KEY` dari env. Model: `claude-sonnet-4-6` (atau configurable via env `CLAUDE_MODEL`).

**Test scenarios:**
- **Unit — Single tool call:** Mock: `stop_reason: 'tool_use'` dengan `get_prices`; verify `getPrices` dipanggil, `tool_result` dikirim dalam satu user turn, messages history benar.
- **Unit — End turn:** Mock `stop_reason: 'end_turn'` → verify loop break, reasoning text terlog.
- **Unit — max_tokens abort:** Mock `stop_reason: 'max_tokens'` → verify loop break, warning terlog, tidak ada tool dispatch.
- **Unit — Error dalam tool:** Mock `getPrices` throw → verify `is_error: true` di tool_result, loop lanjut, tidak crash.
- **Unit — Sequential dispatch:** Mock Claude return `[get_prices tool_use, execute_swap tool_use]` dalam satu turn → verify `getPrices` selesai sebelum `execute_swap` dipanggil.
- **Unit — Env validation:** Missing `ANTHROPIC_API_KEY` → verify `process.exit(1)` (mock `process.exit`). `PRIVATE_KEY` value tidak muncul di logs.
- **Unit — Multi-turn:** Mock: turn 1 → `get_prices`, turn 2 → `execute_swap`, turn 3 → end_turn. Verify messages history memiliki [user, assistant, user, assistant, user, assistant] dalam urutan benar.
- **Unit — Tool result envelope:** Verify bahwa tool result content adalah valid JSON `{ tool: ..., data: ... }`, bukan raw string.
- **Integration:** Satu full iteration dengan real Claude API + real RPC; log berisi reasoning Claude, minimal satu `[TOOL]` entry, tidak crash.

**Verification:**
- Unit tests untuk dispatcher dan multi-turn loop pass.
- Integration test: satu iterasi end-to-end, Claude membuat keputusan dan reasoning terlog.

---

- U8. **CLAUDE.md + .env.example**

**Goal:** Root documentation dan env template per R14.

**Requirements:** R13, R14

**Dependencies:** None

**Files:**
- Create: `CLAUDE.md`
- Create: `.env.example`

**Approach:**
- `CLAUDE.md` sections: Overview, Architecture (agent tools, polling loop, safety rail), Setup (install, .env config), Running (`npm start`), Testing (`npm run test:unit`, `npm run test:integration`, swap test manual), Configuration Reference (semua env vars dengan deskripsi dan default), Contract Addresses (semua pool addresses per network), Notes (approval behavior, swap integration test skip, mulai dengan MAX_TRADE_USDC kecil).
- `.env.example`: Semua env vars dengan komentar. Values: placeholder strings, `MAX_TRADE_USDC=10` (aman untuk testing awal), `POLL_INTERVAL_SECONDS=30`.

**Test scenarios:**
Test expectation: none — documentation file.

**Verification:**
- `CLAUDE.md` ada di root.
- `.env.example` mencantumkan semua env vars yang direferensikan di `src/config/chains.ts` dan `src/index.ts`.

---

## System-Wide Impact

- **Interaction graph:** `setInterval → runIteration → Anthropic API → tool dispatch → viem clients → blockchain RPC`. Satu-arah, tidak ada observer atau callback external.
- **Error propagation:** Tool errors di-catch di `runIteration`, diubah menjadi `tool_result` dengan `is_error: true` → Claude memutuskan langkah selanjutnya. Loop tidak crash karena satu tool error.
- **State lifecycle risks:** Approval tx dan swap tx terpisah. Jika swap gagal setelah approval berhasil, `allowance` tetap ada (tidak perlu re-approve di iterasi berikutnya). Ini aman dan dicatat di `CLAUDE.md`. Simulate-before-write pattern di `execute_swap` meminimasi swap reverts.
- **API surface parity:** Tidak ada public API surface. Bot berjalan sebagai CLI process satu-arah.
- **Integration coverage:** Integration test U7 membuktikan bahwa tool dispatch, Claude API, dan RPC calls bekerja end-to-end dalam satu iterasi.
- **Unchanged invariants:** `MAX_TRADE_USDC` selalu di-enforce di `swap.ts` (`validateAmount`), independen dari Claude response, system prompt, atau env vars lainnya.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `.env` ter-commit ke git dengan private key | U1 update `.gitignore` dengan `.env` sebagai deliverable pertama; audit `.gitignore` sebelum funded wallet dikonfigurasi |
| SushiSwap pair address salah menyebabkan harga salah | U2 wajibkan factory.getPair() on-chain lookup sebelum hardcode; integration test memvalidasi harga non-zero |
| Uniswap V3 WETH/USDC pool address di Arbitrum perlu dikonfirmasi | Cek via `factory.getPool(WETH, USDC, 500)` on-chain; kandidat `0xC6962004f452bE9203591991D15f6b388e09E8D0` |
| `simulateContract` QuoterV2 gagal karena missing `from` | Pass dummy account address jika tanpa `account` menyebabkan error dari provider |
| ESM module load order — env dibaca sebelum `dotenv/config` | `import 'dotenv/config'` harus jadi import pertama di `index.ts`; tidak ada module-level client init |
| Claude set `min_amount_out` rendah (hallucination/injection) | Runtime floor 90% di swap.ts — independent dari Claude input; system prompt juga instruksikan 0.5% |
| Claude memberikan token address di luar WETH/USDC | Token whitelist validation di `execute_swap` sebelum approval |
| Gas formula overflow di mainnet gas price tinggi | Bigint division dulu: `gasLimit * gasPriceWei / 10n**18n` sebelum `Number()` |
| `max_tokens` menyebabkan silent partial message history | Explicit check di loop: abort iteration, log warning, tidak teruskan dengan corrupted history |
| Real money di mainnet | Test awal dengan `MAX_TRADE_USDC=10`; integration test read-only dulu |

---

## Documentation / Operational Notes

- Wallet perlu WETH dan USDC di kedua network sebelum menjalankan bot dengan `execute_swap` aktif.
- Mulai dengan `MAX_TRADE_USDC=10` untuk testing awal. Naikkan setelah validasi beberapa iterasi.
- Integration test swap execution di-skip by default; jalankan manual setelah membaca `CLAUDE.md`.
- Pool addresses perlu diverifikasi on-chain sebelum production use.
- `dotenv` diload via `import 'dotenv/config'` di top of `index.ts` — harus menjadi import pertama.

---

## Sources & References

- **Origin document:** [docs/brainstorms/arbitrage-agent-requirements.md](docs/brainstorms/arbitrage-agent-requirements.md)
- viem docs: createPublicClient, simulateContract, writeContract, waitForTransactionReceipt
- Anthropic tool_use: messages.create dengan tools + agentic loop pattern
- Uniswap V2 Pair ABI: IUniswapV2Pair.getReserves (canonical mainnet deployment verified)
- Uniswap V3 QuoterV2: quoteExactInputSingle (non-view, eth_call via simulateContract)
- SushiSwap Arbitrum: Router `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506`, Factory `0xc35DADB65012eC5796536bD9864eD8773aBc74C4`
