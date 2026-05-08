# Arbitrage Agent

Autonomous AI trading agent demo — built for hackathon purposes. Claude AI makes all trading decisions using on-chain data from Uniswap V2/V3 (ETH Mainnet) and SushiSwap V2/Uniswap V3 (Arbitrum).

---

## ⚠️ WARNING — READ THIS FIRST

**THIS PROJECT IS NOT INTENDED FOR LIVE/PRODUCTION ARBITRAGE.**

- This bot was built as a **hackathon demo** to prove that an autonomous AI agent can reason about on-chain data and execute transactions. It is **not production-ready**.
- **DO YOUR OWN RESEARCH (DYOR)** before using any part of this codebase with real funds. The author(s) take no responsibility for any financial loss resulting from use of this software.
- There is **no MEV protection**. Your transactions can be frontrun or sandwiched.
- There is **no circuit breaker**. If an RPC goes down or a pool drains, the bot may behave unexpectedly.
- The slippage protection is minimal — `min_amount_out` is floored at 90% of the market quote, which can still result in significant losses in volatile conditions.
- Gas estimation is approximate. On congested networks, actual gas costs may be much higher than estimated.
- Cross-network arbitrage (ETH Mainnet ↔ Arbitrum) is **not supported**. The bot only trades within the same network.
- The bot is designed to test that **AI agent logic is correct and transactions land on-chain**. Whether any given trade is actually profitable is entirely at Claude's discretion and is not guaranteed.

**If you choose to run this with real funds, you do so entirely at your own risk.**

---

## What This Is

A proof-of-concept autonomous AI agent that:

1. Monitors WETH/USDC prices across 4 DEX pools every N seconds
2. Delegates all trading decisions to Claude AI (no hardcoded rules)
3. Executes on-chain swaps when Claude decides a spread is profitable
4. Enforces runtime safety rails that Claude cannot override

The goal is to demonstrate **agentic AI with on-chain capabilities** — not to run a profitable arb desk.

### Pools Monitored

| Network | DEX | Pair |
|---|---|---|
| ETH Mainnet | Uniswap V2 | WETH/USDC |
| ETH Mainnet | Uniswap V3 (0.05%) | WETH/USDC |
| Arbitrum One | SushiSwap V2 | WETH/USDC |
| Arbitrum One | Uniswap V3 (0.05%) | WETH/USDC |

### How Claude Decides

Each polling iteration, Claude receives 4 tools:

| Tool | What it does |
|---|---|
| `get_prices` | Fetch WETH/USDC price from all 4 pools |
| `get_wallet_balance` | Check WETH + USDC balance on both networks |
| `estimate_gas` | Get USD cost of a swap on a given network/DEX |
| `execute_swap` | Sign and broadcast a swap transaction |

Claude calls these tools in sequence, reasons about spreads vs gas costs, and decides whether to execute. Everything Claude says is logged — you can read its reasoning in the console.

### Safety Rails (cannot be overridden by Claude)

- **`MAX_TRADE_USDC`** — hard cap per swap enforced by the runtime
- **Token whitelist** — only WETH and USDC addresses are accepted
- **`min_amount_out` floor** — raised to 90% of an independent market quote if Claude's value is lower
- **Exact-amount approval** — approves only the swap amount, not unlimited
- **Sequential swap dispatch** — at most one `execute_swap` per iteration
- **Simulate-before-write** — `simulateContract` catches reverts before spending gas

---

## Requirements

- Node.js >= 18
- A funded wallet with WETH and USDC on both ETH Mainnet and Arbitrum One
- RPC endpoints for both networks (Alchemy, Infura, or your own node)
- An Anthropic API key

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in all required values:

```env
# Ethereum mainnet RPC (Alchemy, Infura, etc.)
ETH_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY

# Arbitrum One RPC
ARB_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY

# Trading wallet private key (0x prefixed)
PRIVATE_KEY=0x...

# Anthropic API key
ANTHROPIC_API_KEY=sk-ant-...

# Maximum USD value per swap (start small — e.g. 10)
MAX_TRADE_USDC=10

# How often to run the loop (seconds, minimum 10)
POLL_INTERVAL_SECONDS=30
```

> **Never commit your `.env` file.** It is already in `.gitignore`.

### 3. Fund the wallet

Deposit WETH and USDC into your wallet on both networks before starting the bot. The bot will not run if balances are zero — Claude will skip every iteration.

Recommended starting amounts for a demo:
- ETH Mainnet: ~0.01 WETH + ~30 USDC
- Arbitrum One: ~0.01 WETH + ~30 USDC

---

## Running the Bot

```bash
npm start
```

The bot starts immediately and runs one iteration, then repeats every `POLL_INTERVAL_SECONDS`.

### Sample Console Output

```
Arbitrage agent starting
  Wallet: 0xYourWalletAddress
  MAX_TRADE_USDC: 10
  POLL_INTERVAL_SECONDS: 30
  MODEL: claude-opus-4-7

--- Iteration start 2026-05-08T10:00:00.000Z ---
[Claude] Let me check the current prices across all pools.
[tool:get_prices] {"tool":"get_prices","data":{"ethereum":{"v2":3012.4,"v3":3013.1},"arbitrum":{"v2":3010.8,"v3":3011.9}}}
[Claude] Prices look very close. Let me check wallet balances and gas costs.
[tool:get_wallet_balance] ...
[tool:estimate_gas] ...
[Claude] The spread between ETH V2 and V3 is only $0.70, while gas costs ~$5. Not profitable. Skipping this iteration.
--- Iteration end ---
```

### Stopping the Bot

Press `Ctrl+C` to stop.

---

## Testing

Unit tests run without any RPC or API keys:

```bash
npm run test:unit
```

Integration tests require real RPC endpoints:

```bash
ETH_RPC_URL=<url> ARB_RPC_URL=<url> npm run test:integration
```

---

## Project Structure

```
src/
  config/
    addresses.ts     Contract addresses (verified on-chain)
    abis.ts          Minimal ABIs for each contract
    chains.ts        viem client factory (public + wallet)
  tools/
    prices.ts        get_prices implementation
    balance.ts       get_wallet_balance implementation
    gas.ts           estimate_gas implementation
    swap.ts          execute_swap with all safety rails
  agent/
    definitions.ts   Anthropic Tool definitions
    prompt.ts        Claude system prompt
    loop.ts          Agentic loop (multi-turn with tool dispatch)
  index.ts           Entry point (env validation + setInterval)
test/
  unit/              Pure function tests (no network)
  integration/       Real RPC tests
docs/
  brainstorms/       Requirements document
  plans/             Implementation plan
```

---

## License

MIT — use freely, but remember: **this is a demo. Do your own research.**
