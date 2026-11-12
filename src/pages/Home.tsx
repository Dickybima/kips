import { NAV } from "../App";
import { ShaderBackground } from "@/components/ui/didar";
import { ArrowRight } from "../components/Icons";
import { Label } from "../components/Ui";
import { useChainStats } from "../lib/chainStats";
import { fmt } from "../lib/format";

export function Home() {
  const { block, env } = useChainStats();
  return (
    <>
      <section className="hero on-shader">
        <ShaderBackground className="shader" />
        <div className="hero-copy">
          <h1>
            Give your agent
            <br />
            a market.
            <br />
            <span className="accent">Live on Robinhood.</span>
          </h1>
          <p>
            Name it. Ticker it. Tell KIPS what it does. One transaction mints its token on Robinhood Chain, pipes the
            creator fee from every trade into the agent's own wallet, and opens trading the moment the block lands.
          </p>
          <div className="cta-row">
            <a className="btn btn-solid" href="#/agent">
              Launch an agent <ArrowRight />
            </a>
            <a className="btn btn-ghost" href="#/explore">
              Explore agents
            </a>
          </div>
        </div>
        <span className="hero-foot left">↓ Scroll</span>
        <span className="hero-foot right">No code // No backend // Just launch</span>
      </section>

      <section className="stats">
        <div>
          <span className="muted">› block_height</span>
          <strong>{block !== null ? block.toLocaleString("en-US") : "…"}</strong>
        </div>
        <div>
          <span className="muted">› launch_fee_eth</span>
          <strong>{env ? fmt(env.launchFee) : "…"}</strong>
        </div>
        <div>
          <span className="muted">› chain_id</span>
          <strong>4663</strong>
        </div>
      </section>

      <section className="wrap section">
        <Label n="00">Index</Label>
        <h2>Where to next?</h2>
        <p className="prompt-line">
          <span className="accent">$</span> ls ~/kips
        </p>
        <ol className="index">
          {NAV.map((n, i) => (
            <li key={n.page}>
              <a href={`#/${n.page}`}>
                <span className="muted">{String(i + 1).padStart(2, "0")}</span>
                <strong>
                  {n.page}
                  <span className="muted">/</span>
                </strong>
                <span className="muted">{n.blurb}</span>
                <ArrowRight />
              </a>
            </li>
          ))}
        </ol>
      </section>

      <CtaBox />
    </>
  );
}

export function CtaBox() {
  return (
    <section className="wrap section">
      <div className="cta-box on-shader">
        <ShaderBackground className="shader" />
        <div className="cta-copy">
          <p className="label">
            <span className="accent">&gt;_</span> Ready when you are
          </p>
          <h2>
            Your agent deserves
            <br />
            its own token.
          </h2>
          <p className="muted">
            Give it a name and a purpose. KIPS handles the contract, the curve and the fee wiring on Robinhood Chain.
          </p>
          <a className="btn btn-solid" href="#/agent">
            Start building <ArrowRight />
          </a>
        </div>
      </div>
    </section>
  );
}
