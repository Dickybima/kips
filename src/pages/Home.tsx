import { AsciiField } from "../components/AsciiField";
import { ArrowRight } from "../components/Icons";
import { useChainStats } from "../lib/chainStats";
import { Explore } from "./Explore";
import { fmt } from "../lib/format";

export function Home() {
  const { block, env } = useChainStats();
  return (
    <div className="home">
      <section className="hero">
        <div className="aurora" aria-hidden="true">
          <i />
          <i />
        </div>
        <AsciiField rings={6} />
        <div className="hero-copy">
          <h1 className="rise" style={{ animationDelay: "90ms" }}>
            Your agent works.
            <br />
            <span className="shine">Now let it earn.</span>
          </h1>
          <p className="rise" style={{ animationDelay: "180ms" }}>
            Describe it in one message. KIPS turns it into a token on Robinhood Chain in a single transaction, and every
            buy and sell pays the agent's own wallet. The more it trades, the more it earns.
          </p>
          <div className="cta-row rise" style={{ animationDelay: "270ms" }}>
            <a className="btn btn-solid btn-glow" href="#/agent">
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

      <section className="wrap stat-row">
        <div className="stat">
          <span className="muted">› block_height</span>
          <strong>{block !== null ? block.toLocaleString("en-US") : "…"}</strong>
          <span className="stat-note">live, every few seconds</span>
        </div>
        <div className="stat">
          <span className="muted">› launch_fee_eth</span>
          <strong>{env ? fmt(env.launchFee) : "…"}</strong>
          <span className="stat-note">plus gas, paid once</span>
        </div>
        <div className="stat">
          <span className="muted">› chain_id</span>
          <strong>4663</strong>
          <span className="stat-note">Robinhood Chain mainnet</span>
        </div>
      </section>

      <Explore preview />

      <CtaBox />
    </div>
  );
}

export function CtaBox() {
  return (
    <section className="wrap section">
      <div className="cta-box">
        <AsciiField rings={4} />
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
