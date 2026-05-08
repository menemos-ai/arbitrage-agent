---
title: feat: Mnemos SDK Integration — On-Chain Agent Memory
type: feat
status: active
date: 2026-05-08
---

# feat: Mnemos SDK Integration — On-Chain Agent Memory

## Overview

Integrasikan `@mnemos/sdk` ke arbitrage agent sehingga setiap trade yang berhasil dieksekusi menghasilkan:
1. **Snapshot on-chain** — bundle berisi trade data, price context, dan Claude's reasoning di-mint sebagai NFT ke MemoryRegistry di 0G network.
2. **Auto-listing di marketplace** — setiap snapshot langsung di-list di MemoryMarketplace dengan harga yang dikonfigurasi via env.

Tujuan: persist audit trail immutable, buka monetisasi strategy, dan demonstrate full agentic loop (decide → trade → remember → share).

---

## Problem Frame

Arbitrage agent saat ini stateless — setiap restart kehilangan semua history, dan tidak ada cara untuk membuktikan keputusan Claude secara transparan atau memonetisasi strategy yang dikembangkan. Integrasi Mnemos menyelesaikan ketiganya: setiap trade tercatat on-chain dengan reasoning AI-nya, bisa dilihat publik, dibeli, disewakan, atau di-fork oleh agent lain.

---

## Actors & Flows

**Actors:**
- **A1** — Claude AI agent (decision-maker, reasoning producer)
- **A2** — Runtime/bot process (snapshot trigger, safety enforcer)
- **A3** — Operator/developer (konfigurasi env, monitoring)
- **A4** — Eksternal agent/buyer (membeli, menyewa, atau mem-fork memory di marketplace)

**F1 — Happy path (trade berhasil → snapshot → list):**
1. Claude memanggil `execute_swap`, transaksi confirmed on-chain.
2. Runtime mengumpulkan bundle: trade data + 4-pool prices + Claude reasoning teks.
3. `mnemos.snapshot(bundle)` → encrypted upload ke 0G Storage → mint NFT di MemoryRegistry.
4. `mnemos.list(tokenId, listingTerms)` → listed di MemoryMarketplace.
5. Log: token ID, storage URI, listing tx hash.

**F2 — Snapshot gagal setelah trade:**
- Trade sudah confirmed on-chain, tidak bisa di-rollback.
- Error di-log, iterasi lanjut. Tidak ada retry atau re-execution trade.

**F3 — Listing gagal setelah snapshot berhasil:**
- Token sudah ter-mint, tokenId ter-log.
- Error listing di-log. Operator bisa manual list via marketplace frontend.

---

## Requirements

### R1 — Trigger snapshot pada trade sukses
Snapshot hanya dilakukan setelah `execute_swap` berhasil (receipt confirmed, tidak revert). Iterasi yang skip (no trade) tidak menghasilkan snapshot.

### R2 — MemoryBundle content
Bundle yang di-snapshot harus berisi:

**`data` field:**
```ts
{
  trade: {
    network: 'ethereum' | 'arbitrum'
    dex: 'v2' | 'v3'
    tokenIn: string         // address
    tokenOut: string        // address
    amountIn: string        // native units
    amountOut: string       // native units (actual dari receipt)
    txHash: string
    gasCostUsd: number | null
    timestamp: number       // ms since epoch
  }
  context: {
    pricesAtTrade: {
      ethereum: { v2: number; v3: number }
      arbitrum: { v2: number; v3: number }
    }
    claudeReasoning: string   // semua teks dari Claude selama iterasi ini
  }
  cumulative: {
    totalTrades: number       // in-memory counter, reset on restart
    totalGasCostUsd: number   // in-memory running total
  }
}
```

**`metadata` field:**
```ts
{
  category: 'trading',
  agentId: 'arbitrage-agent-v1',
  version: '1.0.0',
  createdAt: Date.now(),
  tags: ['arbitrage', 'weth-usdc', network, dex]
}
```

### R3 — Claude reasoning collection
Selama `runIteration()`, semua teks dari Claude (`block.type === 'text'`) dikumpulkan ke `reasoningLog: string[]`. Setelah swap sukses, di-join dan dimasukkan ke `claudeReasoning` di bundle.

### R4 — Auto-list setelah snapshot
Setelah `snapshot()` sukses, panggil `mnemos.list(tokenId, listingTerms)` secara otomatis. Listing terms dikonfigurasi via env vars (R8).

### R5 — MnemosClient wajib ada
Jika env vars Mnemos tidak lengkap, agent gagal start dengan error jelas. Ini setara perlakuan dengan `ANTHROPIC_API_KEY` — tidak ada graceful degradation.

### R6 — Error handling snapshot/listing tidak crash agent
Jika snapshot atau listing gagal (0G network down, RPC error), error di-catch dan di-log tapi TIDAK melempar exception ke atas. Agent tidak crash — iterasi selesai normal.

### R7 — MnemosClient di-inisialisasi sekali saat startup
Sama seperti viem clients dan Anthropic client — inisialisasi di `src/index.ts`, di-inject ke `runIteration()`.

### R8 — Env vars Mnemos
Env vars baru yang required:

| Variable | Deskripsi |
|---|---|
| `OG_RPC_URL` | 0G network RPC endpoint |
| `OG_STORAGE_NODE` | 0G Storage indexer URL |
| `OG_CHAIN_ID` | Chain ID untuk 0G network |
| `REGISTRY_ADDRESS` | MemoryRegistry contract address |
| `MARKETPLACE_ADDRESS` | MemoryMarketplace contract address |
| `MNEMOS_BUY_PRICE` | Buy price dalam A0GI (wei string) |
| `MNEMOS_RENT_PRICE_PER_DAY` | Rent price per hari dalam A0GI (wei string) |
| `MNEMOS_FORK_PRICE` | Fork price dalam A0GI (wei string) |
| `MNEMOS_ROYALTY_BPS` | Royalty dalam basis points (e.g., `500` = 5%) |

Optional:
| Variable | Default | Deskripsi |
|---|---|---|
| `MNEMOS_STORAGE_MOCK` | `false` | Skip real 0G Storage upload — untuk testing |

### R9 — Private key reuse
MnemosClient menggunakan `PRIVATE_KEY` yang sama dengan arbitrage agent. Tidak perlu private key terpisah.

### R10 — Log snapshot dan listing
Setelah snapshot + list berhasil, log ke console:
```
[mnemos] Snapshot minted — tokenId: 42, tx: 0x..., storage: 0g://...
[mnemos] Listed — tokenId: 42, tx: 0x...
```

---

## Scope Boundaries

**Termasuk:**
- Snapshot setiap trade sukses
- Auto-list setiap snapshot
- Collection Claude reasoning text
- In-memory cumulative stats
- `MNEMOS_STORAGE_MOCK` untuk testing tanpa real 0G upload

**Tidak termasuk:**
- Load memory dari chain ke Claude (write-only, bukan read+write)
- Periodic snapshot (non-trade iteration)
- `autoSnapshot()` API (kita kontrol timing sendiri via F1)
- `buy()`, `rent()`, `fork()`, `payRoyalty()` dari agent itu sendiri
- Configurable `agentId` per-instance (hardcoded `'arbitrage-agent-v1'`)
- Token-level access control atau private sharing
- Retry logic untuk failed snapshot

---

## Key Technical Decisions

- **SDK source**: `@mnemos/sdk` dari `backend/packages/sdk/` — install sebagai local path dependency di `package.json` arbitrage agent, atau copy dist. Pilih local path untuk hackathon.
- **Peer dependency**: `@0gfoundation/0g-ts-sdk` harus ditambahkan sebagai dependency di arbitrage agent (peer dep SDK, bukan bundled).
- **Encryption key**: SDK menggunakan deterministic key dari wallet address (keccak256 hash). Ini disadari dan diterima untuk hackathon — bukan production-grade.
- **Claude reasoning aggregation**: `runIteration()` perlu mengekspos accumulated reasoning ke caller. Opsi: return string dari `runIteration()`, atau pass mutable ref array sebagai parameter.
- **Prices at trade time**: `getPrices()` dipanggil ulang di awal iterasi — hasilnya sudah tersedia sebagai tool result di dalam loop. Perlu di-pass ke snapshot builder.

---

## Files yang Terpengaruh

```
src/
  mnemos/
    client.ts        # MnemosClient factory + snapshotTrade() helper
    bundle.ts        # buildTradeBundle(trade, prices, reasoning, cumulative) → MemoryBundle
  agent/
    loop.ts          # Collect reasoning, pass prices + trade result ke mnemos.snapshotTrade()
  index.ts           # Validate Mnemos env, init MnemosClient, inject ke runIteration()
.env.example         # Tambahkan 9 Mnemos env vars
CLAUDE.md            # Dokumentasikan Mnemos integration
```

---

## Success Criteria

- Bot start gagal dengan error jelas jika salah satu dari 9 required env vars tidak ada.
- Setiap `execute_swap` yang sukses menghasilkan `[mnemos] Snapshot minted` dan `[mnemos] Listed` di log.
- Token ID dapat dilihat di 0G explorer dan marketplace.
- Jika 0G network down, bot tidak crash — log error dan lanjut.
- `MNEMOS_STORAGE_MOCK=true` menghasilkan snapshot dengan URI stub (tanpa real upload), berguna untuk testing lokal.
