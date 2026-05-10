# Arbitrage Agent

Autonomous AI agent that monitors WETH/USDC price differences across four DEX pools and executes intra-network arbitrage via Balancer V2 flash loans. All trading decisions are made by an AI model — the runtime only enforces safety rails.

Supports **Google Gemini**, **Anthropic Claude**, and **OpenAI** as AI providers. The provider is selected by the `MODEL` env var prefix.

## Architecture

```
contracts/
  src/
    ArbitrageExecutor.sol   Flash loan executor — borrows USDC, swaps atomically, repays
    interfaces/             IBalancerVault, IFlashLoanRecipient
  test/
    ArbitrageExecutor.t.sol Unit + fork tests
  foundry.toml              Foundry build config (solc 0.8.24)
src/
  config/
    addresses.ts   Contract addresses (ETH mainnet + Arbitrum, includes Balancer vault)
    abis.ts        Minimal ABIs for ERC20, UniV2, UniV3 QuoterV2/Router, ArbitrageExecutor
    chains.ts      viem public + wallet client factory
  tools/
    prices.ts      get_prices — fetches all 4 pool prices in parallel
    balance.ts     get_wallet_balance — WETH + USDC on both networks
    gas.ts         estimate_gas — gas cost in USD using live gas price + ETH price
    flash_loan.ts  simulate_flash_loan_arbitrage / execute_flash_loan_arbitrage
    utils.ts       validateTokenWhitelist, validateAmount — shared safety helpers
  agent/
    providers/
      types.ts     Shared interfaces: AIProvider, ToolDefinition, TurnResult, etc.
      gemini.ts    Google Gemini adapter
      claude.ts    Anthropic Claude adapter
      openai.ts    OpenAI adapter
      index.ts     createProvider factory — infers provider from model name prefix
    definitions.ts Provider-agnostic tool definitions (JSON Schema)
    prompt.ts      System prompt
    loop.ts        Agentic loop (multi-turn with tool dispatch)
  mnemos/
    bundle.ts      buildTradeBundle — assembles MemoryBundle from flash loan/price/gas/reasoning
    client.ts      createMnemosClient, buildListingTerms, MnemosContext
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
   # Edit .env with your RPC URLs, private key, and AI provider API key
   ```

   Required env vars:
   | Variable | Description |
   |---|---|
   | `ETH_RPC_URL` | Ethereum mainnet RPC endpoint |
   | `ARB_RPC_URL` | Arbitrum One RPC endpoint |
   | `PRIVATE_KEY` | Wallet private key (0x prefixed) |
   | `MAX_TRADE_USDC` | Max USD per swap (enforced by runtime) |

   AI provider — set the key that matches your chosen `MODEL`:
   | Variable | Required when |
   |---|---|
   | `GEMINI_API_KEY` | `MODEL` starts with `gemini-` (default) |
   | `ANTHROPIC_API_KEY` | `MODEL` starts with `claude-` |
   | `OPENAI_API_KEY` | `MODEL` starts with `gpt-` or `o1`/`o3`/`o4` |

   Optional:
   | Variable | Default | Description |
   |---|---|---|
   | `POLL_INTERVAL_SECONDS` | `30` | Loop interval in seconds (min 10) |
   | `MODEL` | `gemini-2.0-flash` | AI model — prefix determines provider |

   Example model values:
   - `gemini-2.0-flash` / `gemini-1.5-pro` → Google Gemini
   - `claude-sonnet-4-6` / `claude-opus-4-7` → Anthropic Claude
   - `gpt-4o` / `o3` → OpenAI

   Mnemos (all 9 must be set to enable on-chain trade memory):
   | Variable | Description |
   |---|---|
   | `OG_RPC_URL` | 0G Network RPC endpoint |
   | `OG_STORAGE_NODE` | 0G Storage node URL |
   | `OG_CHAIN_ID` | 0G chain ID (16661 for mainnet) |
   | `MNEMO_REGISTRY_ADDRESS` | Deployed Mnemos registry contract |
   | `MNEMO_MARKETPLACE_ADDRESS` | Deployed Mnemos marketplace contract |
   | `MNEMO_BUY_PRICE` | Buy price in wei |
   | `MNEMO_RENT_PRICE_PER_DAY` | Rent price per day in wei |
   | `MNEMO_FORK_PRICE` | Fork price in wei |
   | `MNEMO_ROYALTY_BPS` | Royalty in basis points (e.g. 500 = 5%) |

   Optional Mnemos var:
   | Variable | Default | Description |
   |---|---|---|
   | `MNEMO_STORAGE_MOCK` | `false` | `true` to use in-memory storage (testing) |

3. **Deploy ArbitrageExecutor** (required for flash loan execution)

   ```bash
   npm run build:contracts
   forge create --rpc-url $ETH_RPC_URL --private-key $PRIVATE_KEY \
     contracts/src/ArbitrageExecutor.sol:ArbitrageExecutor \
     --constructor-args <BALANCER_VAULT> <WETH_ETH> <USDC_ETH> <UNIV2_ROUTER_ETH> <UNIV3_ROUTER_ETH> <UNIV3_QUOTERV2_ETH>
   # Set EXECUTOR_ETH to the deployed address, repeat for ARB_RPC_URL → EXECUTOR_ARB
   ```

4. **Fund the wallet**

   Small USDC balance on each network for gas fees. The contract borrows trade capital via flash loans.

## Running

```bash
npm start
```

The bot runs an agentic loop every `POLL_INTERVAL_SECONDS`. Each iteration:
1. Model fetches prices from all 4 pools
2. Model checks wallet balances
3. If a spread looks promising, model calls estimate_gas (dex: flash_loan)
4. Model calls simulate_flash_loan_arbitrage to verify on-chain profitability
5. If profitable, model calls execute_flash_loan_arbitrage (one call per iteration)
   The ArbitrageExecutor borrows USDC via Balancer V2 flash loan, executes two swaps atomically, repays

## Mnemos — On-Chain Trade Memory

When the 10 `MNEMO_*` / `OG_*` env vars are set, the agent mints an on-chain NFT memory snapshot on the 0G network after each successful swap. The snapshot bundles:

- Trade details (network, DEX, token pair, amounts, tx hash, gas cost, timestamp)
- Prices at the time of the trade
- The model's full reasoning text
- Cumulative session stats (total trades, total gas cost USD)

The NFT is listed on the Mnemos marketplace with the configured pricing terms immediately after minting. If either `snapshot` or `list` fails, the error is logged and the agent continues — memory snapshots never block trading.

If any of the 10 Mnemos env vars are missing, Mnemos is silently disabled (startup log shows `Mnemos: disabled`).

## Testing

```bash
# Unit tests (no RPC needed)
npm run test:unit

# Integration tests (requires ETH_RPC_URL + ARB_RPC_URL in env)
ETH_RPC_URL=<url> ARB_RPC_URL=<url> npm run test:integration
```

## Safety Rails

All of these are enforced by the runtime — they cannot be overridden by the model:

- **`MAX_TRADE_USDC`**: Hard cap on `borrowAmount`. Rejected with an error returned to the model.
- **Token whitelist**: Only WETH and USDC addresses are permitted in flash loan calls.
- **`minProfit` floor**: Raised to at least 1.5× estimated gas cost in USDC (6-decimal units) before submitting.
- **Sequential execution**: Only one `execute_flash_loan_arbitrage` call is honored per iteration.
- **Simulate-before-write**: `simulateContract` on `executeArbitrage` catches reverts before spending gas.
- **Atomic execution**: The ArbitrageExecutor contract reverts the entire flash loan if profit < minProfit — no partial state.

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
- Tokens other than WETH/USDC
- MEV or frontrunning protection
- Production circuit breakers or error recovery
- Automatic borrowAmount optimization (agent decides the borrow size)
