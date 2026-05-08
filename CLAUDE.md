# Arbitrage Agent

Autonomous AI agent that monitors WETH/USDC price differences across four DEX pools and executes intra-network arbitrage. All trading decisions are made by Claude — the runtime only enforces safety rails.

## Architecture

```
src/
  config/
    addresses.ts   Contract addresses (ETH mainnet + Arbitrum)
    abis.ts        Minimal ABIs for ERC20, UniV2, UniV3 QuoterV2/Router
    chains.ts      viem public + wallet client factory
  tools/
    prices.ts      get_prices — fetches all 4 pool prices in parallel
    balance.ts     get_wallet_balance — WETH + USDC on both networks
    gas.ts         estimate_gas — gas cost in USD using live gas price + ETH price
    swap.ts        execute_swap — token approval + simulate + write + receipt
  agent/
    definitions.ts Anthropic Tool definitions (JSON Schema)
    prompt.ts      System prompt
    loop.ts        Agentic loop (multi-turn with tool dispatch)
  index.ts         Entry point — env validation, outer polling setInterval
test/
  unit/            Pure function tests (no RPC required)
  integration/     Real RPC tests (require ETH_RPC_URL + ARB_RPC_URL)
```

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env with your RPC URLs, private key, and Anthropic API key
   ```

   Required env vars:
   | Variable | Description |
   |---|---|
   | `ETH_RPC_URL` | Ethereum mainnet RPC endpoint |
   | `ARB_RPC_URL` | Arbitrum One RPC endpoint |
   | `PRIVATE_KEY` | Wallet private key (0x prefixed) |
   | `ANTHROPIC_API_KEY` | Anthropic API key |
   | `MAX_TRADE_USDC` | Max USD per swap (enforced by runtime) |

   Optional:
   | Variable | Default | Description |
   |---|---|---|
   | `POLL_INTERVAL_SECONDS` | `30` | Loop interval in seconds (min 10) |
   | `MODEL` | `claude-opus-4-7` | Claude model to use |

3. **Fund the wallet**

   Deposit WETH and USDC on both ETH mainnet and Arbitrum before running.

## Running

```bash
npm start
```

The bot runs an agentic loop every `POLL_INTERVAL_SECONDS`. Each iteration:
1. Claude fetches prices from all 4 pools
2. Claude checks wallet balances
3. If a spread looks profitable, Claude calls estimate_gas
4. Claude decides to execute or skip — with full reasoning logged
5. If executing, Claude calls execute_swap (one swap per iteration)

## Testing

```bash
# Unit tests (no RPC needed)
npm run test:unit

# Integration tests (requires ETH_RPC_URL + ARB_RPC_URL in env)
ETH_RPC_URL=<url> ARB_RPC_URL=<url> npm run test:integration
```

## Safety Rails

All of these are enforced by the runtime — they cannot be overridden by Claude:

- **`MAX_TRADE_USDC`**: Hard cap per swap. Rejected with an error returned to Claude.
- **Token whitelist**: Only WETH and USDC addresses are permitted for `token_in`/`token_out`.
- **`min_amount_out` floor**: Raised to 90% of an independently-fetched market quote if Claude's value is lower.
- **Exact-amount approval**: Wallet approves exactly `amount_in`, not unlimited.
- **Sequential swap dispatch**: Only one `execute_swap` call is honored per iteration.
- **Simulate-before-write**: `simulateContract` catches reverts before spending gas.

## Pools Monitored

| Network | DEX | Pair |
|---|---|---|
| ETH Mainnet | Uniswap V2 | WETH/USDC |
| ETH Mainnet | Uniswap V3 0.05% | WETH/USDC |
| Arbitrum | SushiSwap V2 | WETH/USDC |
| Arbitrum | Uniswap V3 0.05% | WETH/USDC |

Intra-network only. Cross-network arbitrage (ETH ↔ Arbitrum) is out of scope.

## Scope Limits

This project is for testing purposes. Not included:
- Cross-network arbitrage (requires bridge)
- Flash loans or smart contract deployment
- Tokens other than WETH/USDC
- MEV or frontrunning protection
- Production circuit breakers or error recovery
