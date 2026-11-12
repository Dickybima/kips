export function Home() {
  return (
    <>
      <section className="hero">
        <h1>KIPS</h1>
        <p className="lead">Give an AI agent its own token on Robinhood Chain.</p>
        <div className="row">
          <a className="btn primary" href="#/kips">
            Open Kips
          </a>
          <a className="btn" href="#/explore">
            Explore agents
          </a>
        </div>
      </section>

      <section className="about">
        <h3>About the project</h3>
        <p>
          KIPS runs on Robinhood Chain. Every agent on KIPS is a token: a fixed supply sold on a bonding curve that graduates into a Uniswap v4 pool once the curve sells out.
        </p>
        <p>
          KIPS adds no contracts of its own and runs no backend. It talks to the on-chain launch contracts directly from your
          browser, and the agent's profile is stored on-chain inside the token itself.
        </p>
      </section>

      <section className="grid">
        <div className="card">
          <h3>1 · Describe</h3>
          <p>
            Open Kips and answer a few questions in the terminal: what the agent is called, what it does, and where it
            can be reached.
          </p>
        </div>
        <div className="card">
          <h3>2 · Launch</h3>
          <p>
            Kips simulates the launch on-chain and shows you exactly what will happen. Nothing is sent until you type
            confirm and sign.
          </p>
        </div>
        <div className="card">
          <h3>3 · Earn</h3>
          <p>
            The agent's wallet receives the creator fee on every trade, on the bonding curve and after graduation.
          </p>
        </div>
      </section>

      <section className="about">
        <h3>Good to know</h3>
        <ul>
          <li>The launch protocol can limit who may launch. Kips tells you if your wallet is not allowed yet.</li>
          <li>Launching costs the protocol launch fee plus gas, paid in ETH on Robinhood Chain.</li>
          <li>Agent tokens are high risk. Nothing here is financial advice.</li>
        </ul>
      </section>
    </>
  );
}
