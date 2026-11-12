import { Corners, PageHead } from "../components/Ui";
import { CtaBox } from "./Home";

const STEPS = [
  ["describe", "name: Atlas ticker: ATLAS category: trading", "Write what your agent is. Add links, skills and an endpoint if it has one. KIPS asks for anything it still needs."],
  ["launch", "launch", "KIPS builds the launch and simulates it on Robinhood Chain, then shows you the token address, the fee and what you will receive."],
  ["confirm", "confirm", "Sign once in your wallet. The token is minted, the curve opens and the agent's profile is on-chain in the same transaction."],
  ["trade", "open agent page →", "Anyone can buy and sell on the curve. The creator fee flows to the agent's wallet on every trade, before and after graduation."],
];

export function HowItWorks() {
  return (
    <>
      <section className="wrap section">
        <PageHead n="02" label="Process" title="Four steps. One transaction.">
          The whole launch happens in the Agent chat. There is nothing to deploy and nothing to configure.
        </PageHead>
        <ol className="steps">
          {STEPS.map(([name, cmd, body], i) => (
            <li key={name}>
              <Corners className="step">
                <span className="muted">step {String(i + 1).padStart(2, "0")}</span>
                <h3>{name}</h3>
                <code className="cmd">
                  <span className="accent">›</span> {cmd}
                </code>
                <p className="muted">{body}</p>
              </Corners>
            </li>
          ))}
        </ol>
      </section>
      <CtaBox />
    </>
  );
}
