---
date: 2026-05-08
topic: arbitrage-agent
---

# Autonomous AI Arbitrage Agent

## Problem Frame

Developer ingin membangun dan menguji **autonomous AI agent** yang memonitor perbedaan harga WETH/USDC antara Uniswap V2 dan V3 di ETH mainnet dan Arbitrum, lalu mengeksekusi transaksi arbitrage secara otomatis. Semua keputusan trading (beli/jual di pool mana, berapa amount, apakah layak atau tidak) sepenuhnya dilakukan oleh Claude AI — bukan oleh aturan kode yang di-hardcode. Proyek ini untuk keperluan testing: membuktikan bahwa logika agent benar dan transaksi on-chain bisa berjalan.

---

## Actors

- A1. **Claude AI agent**: menerima tool set dan membuat semua keputusan trading secara otonom — mengambil harga, mengevaluasi peluang, mengestimasi gas, memutuskan eksekusi.
- A2. **Runtime/bot process**: menjalankan agentic loop, menyediakan implementasi tools, dan meng-enforce safety rails.
- A3. **Operator/developer**: mengkonfigurasi env vars, menjalankan/menghentikan bot, memantau log.

---

## Key Flows

- F1. **Iteration cycle (happy path — ada peluang)**
  - **Trigger:** Timer polling interval tercapai (default 30 detik)
  - **Actors:** A2, A1
  - **Steps:**
    1. A2 invoke Claude dengan system prompt + 4 tools tersedia
    2. A1 panggil `get_prices` → terima harga dari 4 pool
    3. A1 panggil `get_wallet_balance` → terima saldo WETH dan USDC
    4. A1 panggil `estimate_gas` untuk network target → terima estimasi gas cost dalam USD
    5. A1 hitung apakah spread > gas cost → keputusan: execute atau skip
    6. Jika execute: A1 panggil `execute_swap` dengan parameter lengkap
    7. A2 validasi amount terhadap MAX_TRADE_USDC → kirim tx ke chain → tunggu konfirmasi
    8. A2 log reasoning Claude, tool calls, dan hasil tx ke konsol
  - **Outcome:** Transaksi beli dan jual berhasil on-chain, atau Claude memutuskan skip dengan alasan
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11

- F2. **Safety rail triggered**
  - **Trigger:** Claude memanggil `execute_swap` dengan amount melebihi MAX_TRADE_USDC
  - **Actors:** A2, A1
  - **Steps:**
    1. A2 cek amount terhadap MAX_TRADE_USDC sebelum sign tx
    2. A2 return error ke Claude: "amount exceeds MAX_TRADE_USDC"
    3. A1 menerima error dan memutuskan: retry dengan amount lebih kecil atau skip
  - **Outcome:** Tidak ada tx yang dikirim melebihi batas; agent melanjutkan reasoning
  - **Covered by:** R6, R10

---

## Requirements

**Price Monitoring**

- R1. Bot mengekspos tool `get_prices` yang mengembalikan harga WETH/USDC (dalam satuan USDC per WETH) dari 4 pool: Uniswap V2 ETH mainnet, Uniswap V3 ETH mainnet, Uniswap V2 Arbitrum, Uniswap V3 Arbitrum.
- R2. Harga dari semua 4 pool harus dalam unit yang sebanding agar Claude bisa membandingkan langsung.

**Wallet & Balance**

- R3. Bot mengekspos tool `get_wallet_balance` yang mengembalikan saldo WETH dan USDC wallet di ETH mainnet dan Arbitrum.
- R4. Bot mengekspos tool `estimate_gas` yang menerima parameter network dan DEX, mengembalikan estimasi gas cost untuk satu swap dalam satuan USD.

**Trade Execution**

- R5. Bot mengekspos tool `execute_swap` dengan parameter: `network` (ethereum/arbitrum), `dex` (v2/v3), `token_in`, `token_out`, `amount_in`, `min_amount_out` (slippage protection).
- R6. `execute_swap` memvalidasi `amount_in` terhadap `MAX_TRADE_USDC` sebelum menandatangani transaksi; menolak dengan pesan error jelas jika melebihi batas.
- R7. `execute_swap` menandatangani dan membroadcast transaksi, menunggu konfirmasi, dan mengembalikan tx hash serta jumlah actual yang diterima.

**AI Agent**

- R8. Bot menjalankan agentic loop periodik dengan interval yang dapat dikonfigurasi via env (default 30 detik); setiap iterasi invoke Claude dengan keempat tools.
- R9. System prompt Claude menginstruksikan: ambil harga, evaluasi spread vs biaya gas, putuskan apakah arbitrage menguntungkan, eksekusi jika ya — tanpa threshold hardcoded di kode.
- R10. Semua keputusan trading (pool mana, berapa amount, execute atau skip) dibuat oleh Claude; tidak ada rule-based override di luar safety rails.
- R11. Setiap iterasi, bot mencatat ke konsol: reasoning Claude (dari response text), setiap tool call beserta argumen dan hasilnya, dan status akhir iterasi.

**Safety & Configuration**

- R12. `MAX_TRADE_USDC` env var menetapkan batas hard atas untuk satu swap; runtime enforce ini tanpa pengecualian.
- R13. Konfigurasi via `.env`: RPC URL ETH mainnet, RPC URL Arbitrum, private key wallet, `ANTHROPIC_API_KEY`, `MAX_TRADE_USDC`, `POLL_INTERVAL_SECONDS`.
- R14. Project memiliki `CLAUDE.md` di root yang mendokumentasikan cara setup, konfigurasi, dan menjalankan bot.

---

## Success Criteria

- Claude agent berhasil mengidentifikasi perbedaan harga antar pool, mengestimasi gas, dan mengambil keputusan yang terdokumentasi di log (execute atau skip dengan alasan).
- Ketika `execute_swap` dipanggil, transaksi nyata landing on-chain dengan jumlah yang sesuai parameter Claude.
- Guard `MAX_TRADE_USDC` mencegah setiap swap di atas batas yang dikonfigurasi, bahkan jika Claude memintanya.
- Bot bisa berjalan selama beberapa iterasi tanpa crash, dengan log yang dapat dibaca operator.

---

## Scope Boundaries

- Cross-network arbitrage (beli di ETH mainnet, jual di Arbitrum) — membutuhkan bridge, tidak termasuk.
- Flash loan / smart contract deployment — tidak termasuk.
- Token pair selain WETH/USDC — tidak termasuk di v1.
- MEV protection / frontrunning protection — tidak termasuk.
- Production hardening (circuit breaker, error recovery otomatis, rate limiting) — tidak termasuk; ini untuk testing.
- Configurable token pair via UI atau dashboard — tidak termasuk.

---

## Key Decisions

- **Off-chain wallet vs flash loan**: wallet dipilih karena lebih sederhana untuk testing — tidak perlu deploy smart contract.
- **Claude sebagai sole decision-maker**: semua logika trading ada di reasoning Claude, bukan di kode. Ini memungkinkan strategi diubah cukup dengan mengubah system prompt.
- **Arbitrage intra-network saja**: 4 pool dipantau, tapi trade hanya terjadi dalam satu network (V2 vs V3 di ETH mainnet, atau V2 vs V3 di Arbitrum). Tidak ada cross-chain swap.
- **Safety rail di runtime, bukan di prompt**: MAX_TRADE_USDC di-enforce oleh kode runtime, bukan oleh instruksi ke Claude — ini tidak bisa di-override oleh Claude.

---

## Dependencies / Assumptions

- Operator telah mendanai wallet dengan WETH dan USDC di kedua network.
- Pool WETH/USDC tersedia dan liquid di Uniswap V2 dan V3 pada ETH mainnet dan Arbitrum.
- `ANTHROPIC_API_KEY` tersedia dan punya akses ke model Claude yang digunakan.
- Dependency `@anthropic-ai/sdk` dan `dotenv` sudah ada di project (terverifikasi di `package.json`).

---

## Outstanding Questions

### Resolve Before Planning

_(kosong — tidak ada yang memblokir planning)_

### Deferred to Planning

- [Affects R1][Needs research] Alamat contract pool WETH/USDC Uniswap V2 dan V3 yang aktif di ETH mainnet dan Arbitrum.
- [Affects R1][Technical] Metode pembacaan harga: `getReserves()` untuk V2, `slot0()` / `sqrtPriceX96` untuk V3.
- [Affects R5][Technical] Bagaimana `min_amount_out` dihitung secara default (misal: slippage 0.5% dari expected output).
- [Affects R8][Technical] Apakah agentic loop menggunakan outer polling (main process panggil Claude setiap N detik) atau single Claude invocation yang loop sendiri lewat tools.

---

## Next Steps

-> `/ce-plan` untuk perencanaan implementasi terstruktur
