# KIPS

KIPS gives an AI agent its own token. It is built on [Pons v2](https://docs.ponsfamily.com/v2), the token launch protocol on Robinhood Chain (chainId 4663).

Every KIPS agent is a Pons v2 token. KIPS adds no contracts and no backend: it is a static web app that talks to the Pons v2 contracts directly.

- **Intro** — a cinematic preloader (`src/components/ui/stardust-stage-preloader.tsx`) plays once per browser session; click or press Enter to skip ahead.
- **Home** — live ticker (block, gas, launch fee), a hero and closing call-to-action over drifting ASCII rings, live chain stats and an index of the pages. A WebGL god-rays shader (`src/components/ui/didar.tsx`, adapted from Paper Shaders, Apache-2.0) is also available as a drop-in background.
- **Features** / **How it works** — what KIPS does and the four-step launch.
- **Agent** — a chat that turns free-form messages (`name: Atlas ticker: ATLAS category: trading`) into a `blueprint.json`, asks for anything missing, simulates the launch on Robinhood Chain and sends it only after `confirm`. An optional first buy goes through the launch-and-buy router in the same transaction.
- **Logo upload** — in the Agent chat, the image button (or dropping or pasting an image) crops the picture to a 512×512 square in the browser and uploads it through `api/upload.ts` to Vercel Blob. The returned public URL becomes the token's on-chain logo.
- **Explore** — every launch read straight from `TokenLaunched` events, with search, sorting, curve progress and creator fee per card; filter to KIPS agents or all launches.
- **Terminal** — trade by chat: `swap 0.1 eth to kips`, `sell 50% kips`, `price kips`, `balance`. Tickers resolve to the official $KIPS token or any KIPS agent (or pass a contract address). Each order is quoted from the live curve with a slippage limit, shown in `order.json`, simulated, and only then sent to the wallet. Bonding-curve trades only; graduated tokens trade in their Uniswap v4 pool.
- **Network** — live Robinhood Chain stats, launch terms and contract addresses, with an "Add to wallet" button.
- **Trade** — buy and sell on an agent's bonding curve, with quotes computed locally from on-chain curve state.
- **Wallets** — the connect button lists every wallet installed in the browser (EIP-6963), with switch and disconnect.

The look is a dark/light terminal style in JetBrains Mono with a Robinhood-green accent.

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

Configuration is optional; see `.env.example` (`VITE_RPC_URL`, `VITE_EXPLORER_URL`, `VITE_SITE_URL`).

### Logo uploads (Vercel Blob)

Logo uploads need a Blob store connected to the Vercel project: **Storage → Create → Blob**, then connect it to this project. Vercel adds `BLOB_READ_WRITE_TOKEN` to the project's environment variables, and the next deployment can store logos. Without it, `/api/upload` answers that uploads are not set up, and the rest of the site works as before. `npm run dev` does not run the `api/` function; use `vercel dev` to try uploads locally.

## Layout

- `src/lib/pons/` — chain and contract addresses, ABIs, reads, writes, and the bonding-curve quote math
- `src/lib/kips/agent.ts` — agent profile encoding, validation, URL sanitising
- `src/lib/kips/wizard.ts` — the question script behind the Kips terminal
- `src/components/ui/` — drop-in UI components, imported as `@/components/ui/...` (the shadcn layout)
- `src/components/Intro.tsx` — mounts the preloader as the opening sequence
- `src/lib/kips/intent.ts` — reads launch fields out of free-form chat messages
- `src/lib/chainStats.ts` — one shared poller for live block, gas and launch terms
- `api/upload.ts` — Vercel Function that validates and stores agent logos in Vercel Blob
- `src/lib/kips/image.ts` — crops and shrinks a logo in the browser before upload
- `src/lib/kips/trade-intent.ts` — reads trades out of Terminal chat messages
- `src/pages/` — Home, Features, How it works, Agent (chat), Explore, Network, and the token page
- `tests/` — quote math, profile encoding, ABI selectors

## Limits

- ETH-paired curves only.
- Trading covers the bonding-curve phase. After graduation the token trades in its Uniswap v4 pool, which KIPS does not route yet.
- Discovery reads logs from the RPC and filters client-side, newest first. An indexer would be the next step once there are many agents.
- Contract addresses and ABIs come from a community SDK that mirrors the Pons v2 deployment. They have been checked against Robinhood Chain mainnet by simulating `launchToken`, `launchAndBuy` and `buy` (with an overridden balance), and the local quote math matches the simulated amounts. No real launch has been sent from this repository yet.
