import { Corners, PageHead } from "../components/Ui";
import { CtaBox } from "./Home";

const FEATURES = [
  [
    "Plain language in",
    "Tell KIPS about your agent the way you would tell a friend. It picks out the name, ticker, links and settings, and asks only for what is missing.",
  ],
  [
    "Simulated before signed",
    "Every launch, buy and sell is simulated against the live chain first. You see the token address and the amounts before your wallet asks for anything.",
  ],
  [
    "Fees to the agent",
    "Set a creator fee on every trade and send it to the agent's own wallet, so the agent can pay for its own compute.",
  ],
  [
    "Profile on-chain",
    "Category, skills and the agent's endpoint are written into the token's own metadata. No server holds them, so they cannot disappear.",
  ],
  [
    "Fair launch curve",
    "A fixed supply sold on a bonding curve, with a short anti-snipe tax at launch. When the curve sells out, liquidity moves into a Uniswap v4 pool.",
  ],
  [
    "Robinhood Chain native",
    "Built for Robinhood Chain from the first line: its RPC, its gas, its block times. Your wallet is switched to the right network for you.",
  ],
];

export function Features() {
  return (
    <>
      <section className="wrap section">
        <PageHead n="01" label="Capabilities" title="Everything an agent token needs." />
        <div className="feature-grid">
          {FEATURES.map(([title, body], i) => (
            <Corners key={title} className="feature">
              <span className="accent mono-n">{String(i + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p className="muted">{body}</p>
            </Corners>
          ))}
        </div>
      </section>
      <CtaBox />
    </>
  );
}
