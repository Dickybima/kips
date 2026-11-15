import { CopyButton, Corners, PageHead } from "../components/Ui";

const SITE = (import.meta.env.VITE_SITE_URL || "https://www.trykips.app").replace(/\/$/, "");
export const MCP_URL = `${SITE}/api/mcp`;

const CLAUDE_CODE = `claude mcp add --transport http kips ${MCP_URL}`;
const CURSOR = JSON.stringify({ mcpServers: { kips: { url: MCP_URL } } }, null, 2);
const REMOTE = JSON.stringify({ mcpServers: { kips: { command: "npx", args: ["-y", "mcp-remote", MCP_URL] } } }, null, 2);

const TOOLS: [string, string][] = [
  ["get_launch_info", "Launch fee, supply, curve fee, graduation threshold and max creator fee, live."],
  ["list_agents", "Every token launched with KIPS, newest first. Filter by category or search."],
  ["get_token", "Price, market cap, bonding-curve progress, creator fee and burned supply of a token."],
  ["quote_buy", "How many tokens an ETH amount buys right now, after fees."],
  ["quote_sell", "How much ETH selling tokens returns right now, after fees."],
  ["top_x_profiles", "The most-followed X accounts, ranked live, with a tokenize link each."],
  ["get_x_profile", "Name, bio, picture and followers of an X account."],
  ["tokenize_x_profile", "A link that opens Tokenize X with the profile loaded."],
  ["prepare_launch", "A link to the launch form with name, ticker, description and more filled in."],
  ["prepare_trade", "A Terminal link with a buy or sell order typed in."],
];

const PROMPTS = [
  "What's the price of $KIPS and how much has been burned?",
  "Quote 0.05 ETH of KIPS for me.",
  "List the newest agents launched on KIPS.",
  "Launch a token for my agent: Atlas, ticker ATLAS, it finds momentum and trades it.",
  "Who are the top 5 X profiles by followers? Tokenize the first one.",
];

function Code({ value }: { value: string }) {
  return (
    <div className="mcp-code">
      <pre>{value}</pre>
      <CopyButton value={value} label="Copy" className="chip chip-sm" />
    </div>
  );
}

export function Mcp() {
  return (
    <section className="wrap section mcp">
      <PageHead n="07" label="MCP" title="KIPS for AI agents.">
        Connect Claude, Cursor or any MCP client to KIPS. Your AI can read every KIPS token on Robinhood Chain, quote
        trades, rank X profiles and prepare launches and trades for you to sign.
      </PageHead>

      <Corners className="mcp-endpoint" accent>
        <span className="muted small">MCP server · Streamable HTTP · no API key</span>
        <div className="mcp-url">
          <code>{MCP_URL}</code>
          <CopyButton value={MCP_URL} label="Copy URL" className="chip chip-accent" />
        </div>
      </Corners>

      <div className="mcp-grid">
        <div className="mcp-step">
          <h3>Claude</h3>
          <p className="muted small">
            In Claude (web or desktop), open Settings → Connectors → Add custom connector, name it KIPS and paste the
            URL above.
          </p>
        </div>
        <div className="mcp-step">
          <h3>Claude Code</h3>
          <p className="muted small">Run once in your terminal:</p>
          <Code value={CLAUDE_CODE} />
        </div>
        <div className="mcp-step">
          <h3>Cursor</h3>
          <p className="muted small">
            Add to <code>~/.cursor/mcp.json</code> (or the project's <code>.cursor/mcp.json</code>):
          </p>
          <Code value={CURSOR} />
        </div>
        <div className="mcp-step">
          <h3>Other clients</h3>
          <p className="muted small">Clients that only run local servers can bridge with mcp-remote:</p>
          <Code value={REMOTE} />
        </div>
      </div>

      <h3 className="mcp-h">Tools</h3>
      <dl className="mcp-tools">
        {TOOLS.map(([name, what]) => (
          <div key={name}>
            <dt>
              <code>{name}</code>
            </dt>
            <dd className="muted">{what}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mcp-h">Try asking</h3>
      <ul className="mcp-prompts">
        {PROMPTS.map((p) => (
          <li key={p}>
            <span className="accent">›</span> {p}
          </li>
        ))}
      </ul>

      <p className="note">
        The KIPS MCP server never holds keys and never sends a transaction. Launches and trades come back as a
        trykips.app link with everything filled in: you open it, check it and approve it in your own wallet. Agent
        tokens are high risk, and quotes are not advice.
      </p>
    </section>
  );
}
