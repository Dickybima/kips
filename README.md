# KIPS

KIPS gives an AI agent its own token. It is built on [Pons v2](https://docs.ponsfamily.com/v2), the token launch protocol on Robinhood Chain (chainId 4663).

Every KIPS agent is a Pons v2 token. KIPS adds no contracts and no backend: it is a static web app that talks to the Pons v2 contracts directly.

- **Home** — what the project is and how it works.
- **Explore** — scans Pons v2 `TokenLaunched` events and lists the tokens that carry a kips agent profile.
- **Kips** — a terminal-style chat that launches an agent. It asks for the agent's name, ticker, description, category, skills, endpoint and fee wallet, simulates the launch on the Pons v2 factory, and sends it once you type `confirm`. An optional first buy goes through the Pons launch-and-buy router in the same transaction.
- **Wallets** — the connect button opens a picker listing every wallet installed in the browser (EIP-6963), with switch and disconnect. In the Kips terminal, `connect` lists the same wallets by number.
- **Trade** — buy and sell on the agent's bonding curve, with quotes computed locally from on-chain curve state.

## How it sits on Pons v2

| KIPS action | Pons v2 call |
| --- | --- |
| Check launches are open | `factory.launchEnabled`, `canLaunch(wallet)`, `approvedPairTokens(0x0)` |
| Launch | `factory.launchToken(params, configId, 0x0, [])` with `msg.value = launchFee` |
| Launch + first buy | `router.launchAndBuy(...)` with `msg.value = launchFee + quoteIn` |
| Agent page | `factory.getLaunchedToken`, `token.getTokenInfo`, curve reserves and fees |
| Buy / sell | `curve.buy` (payable) / `token.approve` + `curve.sell` |

Launches commit to `factory.previewLaunchEconomics(...)`, so a launch reverts rather than going through on terms other than the ones shown. Every write is simulated first; the terminal prints the simulated token address and amounts before asking for a signature.

Pons can restrict who may launch. When `canLaunch` is false for the connected wallet, Kips says so and refuses to launch.

### Agent profile format

The profile lives in the token's on-chain description as a one-line trailer, so it travels with the token:

```
Trades for you.

[kips:1]{"c":"trading","s":["swaps","alerts"],"e":"https://agent.example/mcp"}
```

A Pons v2 token without the trailer still opens in KIPS, labelled as a plain Pons token. The description and trailer together must fit Pons's 2,048-byte limit.

## Develop

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

Configuration is optional; see `.env.example` (`VITE_RPC_URL`, `VITE_EXPLORER_URL`).

## Layout

- `src/lib/pons/` — chain and contract addresses, ABIs, reads, writes, and the bonding-curve quote math
- `src/lib/kips/agent.ts` — agent profile encoding, validation, URL sanitising
- `src/lib/kips/wizard.ts` — the question script behind the Kips terminal
- `src/pages/` — Home, Explore, Kips (terminal), and the agent page
- `tests/` — quote math, profile encoding, ABI selectors

## Limits

- ETH-paired curves only.
- Trading covers the bonding-curve phase. After graduation the token trades in its Uniswap v4 pool, which KIPS does not route yet.
- Discovery reads logs from the RPC and filters client-side, newest first. An indexer would be the next step once there are many agents.
- Contract addresses and ABIs were taken from a community SDK that mirrors the Pons v2 deployment, and have not yet been exercised against the live chain from this repository. Verify against the official Pons docs before sending real funds.
