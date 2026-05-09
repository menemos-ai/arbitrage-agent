---
date: 2026-05-10
topic: flash-loan-arbitrage
---

# Flash Loan Arbitrage via Balancer

## Problem Frame

Operator bot tidak memiliki modal WETH/USDC untuk melakukan arbitrage. Arsitektur saat ini (`execute_swap`) hanya bisa trade dengan saldo wallet sendiri — tanpa modal, tidak ada trade. Flash loan Balancer V2 menghilangkan kebutuhan modal: seluruh likuiditas yang dibutuhkan dipinjam secara atomik, arbitrage dieksekusi dalam satu transaksi, dan pinjaman dibayar kembali sebelum transaksi selesai. Operator hanya perlu cukup ETH untuk gas.

---

## Actors

- A1. **AI agent (off-chain)**: Menganalisis harga di empat pool, menentukan apakah peluang ada, memutuskan parameter flash loan, dan memanggil contract.
- A2. **ArbitrageExecutor contract**: Smart contract on-chain yang menerima flash loan, mengeksekusi dua swap, dan mengembalikan pinjaman. Tidak punya logika keputusan — hanya eksekutor.
- A3. **Balancer V2 Vault**: Penyedia flash loan (0% fee). Memanggil callback `receiveFlashLoan()` pada contract setelah meminjamkan dana.
- A4. **Owner (EOA wallet)**: Satu-satunya yang dapat memanggil `executeArbitrage()`. Menerima profit setelah setiap transaksi berhasil.

---

## Key Flows

- F1. **Simulasi peluang arbitrage**
  - **Trigger:** Agent mendeteksi spread antara dua pool pada network yang sama (dari hasil `get_prices`).
  - **Actors:** A1
  - **Steps:**
    1. Agent menghitung arah trade: beli di pool A (harga lebih rendah), jual di pool B (harga lebih tinggi).
    2. Agent memanggil `simulate_flash_loan_arbitrage` dengan parameter: network, buy_dex, sell_dex, borrow_token, borrow_amount.
    3. Tool melakukan `eth_call` pada `ArbitrageExecutor.simulateArbitrage()` — tidak ada gas terpakai.
    4. Contract returns: `expectedProfit` (dalam token yang dipinjam) dan apakah akan revert.
    5. Agent membandingkan `expectedProfit` dengan `estimate_gas` cost. Jika profit > gas cost dengan margin aman, agent lanjut ke F2.
  - **Outcome:** Agent memiliki angka profit konkret tanpa mengeluarkan gas. Jika tidak profitable, iterasi selesai.
  - **Covered by:** R1, R2, R3, R5

- F2. **Eksekusi flash loan arbitrage**
  - **Trigger:** Simulasi di F1 mengonfirmasi profit > threshold.
  - **Actors:** A1, A2, A3, A4
  - **Steps:**
    1. Agent memanggil `execute_flash_loan_arbitrage` dengan parameter yang sama seperti simulasi plus `min_profit`.
    2. Tool mengirim transaksi ke `ArbitrageExecutor.executeArbitrage()`.
    3. Contract meminta flash loan ke Balancer Vault (A3).
    4. Balancer memanggil `receiveFlashLoan()` pada contract — dalam callback ini:
       a. Contract swap token yang dipinjam di buy_dex.
       b. Contract swap hasil token di sell_dex.
       c. Contract verifikasi `profit >= minProfit` (revert jika tidak).
       d. Contract bayar kembali pinjaman ke Balancer.
       e. Profit dikirim ke EOA wallet (A4).
    5. Tool menunggu receipt dan mengembalikan hasil ke agent.
  - **Outcome:** Profit ada di wallet owner, atau transaksi revert (tanpa kehilangan aset, hanya gas).
  - **Covered by:** R4, R5, R6, R7, R8

---

## Requirements

**Smart contract**

- R1. Contract `ArbitrageExecutor` mengimplementasikan interface `IFlashLoanRecipient` Balancer V2 dengan fungsi `receiveFlashLoan()`.
- R2. Contract menyediakan fungsi view `simulateArbitrage(params)` yang dapat dipanggil via `eth_call` (tanpa state change) dan mengembalikan `expectedProfit`.
- R3. Contract menerima parameter: `network` (implisit dari address deployment), `borrowToken` (WETH atau USDC), `borrowAmount`, `buyDex` (v2/v3), `sellDex` (v2/v3), dan `minProfit`.
- R4. Fungsi `executeArbitrage()` dibatasi hanya dapat dipanggil oleh `owner` (address yang deploy contract). Panggilan dari address lain revert.
- R5. Contract meng-encode parameter arbitrage ke dalam `userData` yang diteruskan ke Balancer, dan mendecode-nya di dalam `receiveFlashLoan()`.
- R6. Jika profit aktual setelah dua swap kurang dari `minProfit`, seluruh transaksi revert. Tidak ada dana yang hilang (kecuali gas).
- R7. Profit (sisa token setelah pinjaman dilunasi) langsung ditransfer ke `owner` di akhir `receiveFlashLoan()` dalam transaksi yang sama.
- R8. Contract di-deploy secara terpisah di Ethereum mainnet dan Arbitrum. Kedua address disimpan di `src/config/addresses.ts`.

**TypeScript tools**

- R9. Tool `simulate_flash_loan_arbitrage` memanggil `simulateArbitrage()` via `eth_call` dan mengembalikan `{ expectedProfitRaw, expectedProfitUsd, willSucceed }` ke agent.
- R10. Tool `execute_flash_loan_arbitrage` mengirim transaksi `executeArbitrage()` dan mengembalikan `{ txHash, actualProfit }` dari receipt.
- R11. Tool `execute_swap` dihapus dari codebase. `src/agent/definitions.ts` diperbarui untuk mengganti execute_swap dengan dua tool baru (R9 dan R10).
- R12. System prompt diperbarui untuk mencerminkan workflow baru: simulate dulu, execute hanya jika simulasi profitable.

**Safety rails**

- R13. `MAX_TRADE_USDC` tetap diberlakukan sebagai cap pada `borrowAmount` yang dikirim ke contract — sama seperti sebelumnya, enforced di tool layer TypeScript.
- R14. Token whitelist (hanya WETH/USDC) tetap diberlakukan di tool layer sebelum memanggil contract.

---

## Acceptance Examples

- AE1. **Covers R2, R9.** Diberikan spread ETH mainnet V2=2990 dan V3=3010, ketika agent memanggil `simulate_flash_loan_arbitrage` dengan borrow 100,000 USDC untuk beli WETH di V2 lalu jual di V3, tool mengembalikan `expectedProfitUsd: ~$180` dan `willSucceed: true` tanpa transaksi on-chain.

- AE2. **Covers R6, R10.** Diberikan harga berubah antara simulasi dan eksekusi sehingga spread menghilang, ketika agent memanggil `execute_flash_loan_arbitrage`, transaksi revert on-chain dengan error `profit < minProfit`. Tool mengembalikan error ke agent. Tidak ada WETH/USDC yang hilang dari wallet.

- AE3. **Covers R4.** Diberikan address selain owner yang mencoba memanggil `executeArbitrage()` langsung di Etherscan, contract revert dengan `OwnableUnauthorizedAccount`.

- AE4. **Covers R13.** Diberikan `MAX_TRADE_USDC=500` dan agent ingin borrow 1,000,000 USDC, tool menolak dengan error sebelum transaksi dikirim.

---

## Success Criteria

- Agent dapat mengeksekusi arbitrage profitabel tanpa WETH/USDC di wallet — hanya memerlukan ETH untuk gas.
- Simulasi (`eth_call`) selalu dilakukan sebelum eksekusi nyata; tidak ada transaksi on-chain yang dikirim untuk peluang yang sudah dipastikan tidak profitable.
- Dalam kondisi market normal (harga bergerak antara simulate dan execute), contract revert dan wallet tidak kehilangan aset.

---

## Scope Boundaries

- **Tidak** termasuk MEV protection (Flashbots private mempool, commit-reveal). Bot ini akan terlihat di mempool publik — ini risiko yang diterima.
- **Tidak** termasuk multi-hop arbitrage (lebih dari dua swap dalam satu flash loan).
- **Tidak** termasuk flash loan dari provider lain (Aave, dYdX). Hanya Balancer V2.
- **Tidak** termasuk cross-network arbitrage (ETH ↔ Arbitrum). Tetap intra-network.
- **Tidak** termasuk optimisasi borrow amount otomatis di contract (agent yang menentukan `borrowAmount`).
- **Tidak** termasuk deploy script otomatis — deployment manual via Hardhat/Foundry atau Etherscan.

---

## Key Decisions

- **Simulate-before-execute**: Dipilih untuk menghindari gas terbuang pada transaksi yang gagal, khususnya di Ethereum mainnet dengan gas cost tinggi.
- **Profit langsung ke EOA, bukan akumulasi di contract**: Menghindari risiko dana tertahan di contract dan menyederhanakan audit trail.
- **Only owner can execute**: Mencegah front-running atau eksploitasi oleh pihak lain yang melihat contract address.
- **execute_swap dihapus sepenuhnya**: User tidak punya modal sendiri, sehingga dua tool tidak diperlukan.
- **Balancer V2 (bukan Aave/dYdX)**: Flash loan fee 0%, tersedia di ETH mainnet dan Arbitrum dengan address vault yang sama.

---

## Dependencies / Assumptions

- Balancer V2 Vault (`0xBA12222222228d8Ba445958a75a0704d566BF2C8`) aktif di Ethereum mainnet dan Arbitrum — **diasumsikan** (perlu diverifikasi saat planning).
- Owner wallet memiliki cukup ETH untuk gas deployment dan transaksi. Di Arbitrum cukup ~$5, di ETH mainnet ~$50-150.
- Peluang arbitrage di keempat pool ini masih ada meskipun kompetisi dengan MEV bots — risiko nyata bahwa 30-second polling interval terlalu lambat untuk menangkap banyak peluang.

---

## Outstanding Questions

### Resolve Before Planning

_(kosong — semua keputusan produk sudah diputuskan di brainstorm)_

### Deferred to Planning

- [Affects R1][Needs research] Solidity version dan library yang digunakan untuk contract (OpenZeppelin, Foundry vs Hardhat)?
- [Affects R2][Technical] Bagaimana `simulateArbitrage()` diimplementasikan — apakah sebagai fungsi view biasa atau via `staticcall` internal?
- [Affects R5][Technical] Encoding/decoding `userData` untuk Balancer — struct atau ABI-encoded bytes?
- [Affects R9][Technical] Bagaimana `eth_call` dilakukan via viem untuk memanggil `simulateArbitrage()`?
- [Affects R8][Needs research] Verifikasi Balancer V2 Vault address di kedua network dan pool liquidity yang cukup untuk borrow amounts yang diinginkan.

---

## Next Steps

-> `/ce-plan` untuk structured implementation planning
