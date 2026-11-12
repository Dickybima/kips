import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { validateLaunchForm } from "../lib/kips/agent";
import { STEPS, answerStep, initialBuyWei, taxBps, toLaunchForm, type Answers } from "../lib/kips/wizard";
import { errMsg, fmt, pct, shortAddr } from "../lib/format";
import { readLaunchEnv, type LaunchEnv } from "../lib/pons/read";
import { prepareLaunch, waitForLaunch, type PreparedLaunch } from "../lib/pons/write";
import { useWallet } from "../lib/wallet";

const SLIPPAGE_BPS = 500n;

type Kind = "sys" | "you" | "err" | "ok" | "dim";
interface Line {
  kind: Kind;
  text: string;
  href?: string;
}
type Phase = "ask" | "ready" | "simulated" | "busy" | "done";

interface Session {
  phase: Phase;
  step: number;
  /** True when a single field is being re-entered from the review screen. */
  editing: boolean;
  answers: Partial<Answers>;
  prepared: PreparedLaunch | null;
  token: Address | null;
}

const fresh = (): Session => ({ phase: "ask", step: 0, editing: false, answers: {}, prepared: null, token: null });

const HELP = [
  "help              show this list",
  "back              go to the previous question",
  "edit <field>      change one answer (e.g. edit ticker)",
  "status            show your answers so far",
  "connect           connect your wallet",
  "launch            simulate the launch (after the last question)",
  "confirm / cancel  sign, or drop, a simulated launch",
  "restart           start over",
  "clear             clear the screen",
];

const FIELD_ALIASES: Record<string, keyof Answers> = { ticker: "symbol", description: "about", fee: "tax", x: "twitter" };

function blockedReason(env: LaunchEnv, hasAccount: boolean): string | null {
  if (!env.launchEnabled) return "Pons v2 launches are currently paused by the protocol.";
  if (!env.nativeApproved) return "Pons v2 is not accepting ETH-paired launches right now.";
  if (env.configs.length === 0) return "Pons v2 has no open launch configuration.";
  if (hasAccount && env.canLaunch === false) {
    return "Pons v2 is not open to this wallet yet: launches are limited to allowlisted launchers.";
  }
  return null;
}

export function Kips() {
  const { account, connect, getClient } = useWallet();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useRef<Session>(fresh());
  const env = useRef<LaunchEnv | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const booted = useRef(false);

  const say = useCallback((kind: Kind, text: string, href?: string) => {
    setLines((prev) => [...prev, { kind, text, href }]);
  }, []);

  const ctx = () => ({ maxTaxBps: env.current?.maxCreatorTaxBps ?? null });
  const ask = useCallback(() => say("sys", STEPS[session.current.step].ask(ctx())), [say]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    say("dim", "KIPS — launch an agent on Pons v2 · Robinhood Chain");
    say("dim", "Answer the questions to launch. Type help for commands.");
    ask();
  }, [say, ask]);

  useEffect(() => {
    let live = true;
    readLaunchEnv(account).then(
      (e) => {
        if (!live) return;
        const first = env.current === null;
        env.current = e;
        if (first) say("dim", `Pons v2 online · launch fee ${fmt(e.launchFee)} ETH`);
        const reason = blockedReason(e, !!account);
        if (reason) say("err", reason);
      },
      (e) => live && say("err", `Could not read Pons v2: ${errMsg(e)}`),
    );
    return () => {
      live = false;
    };
  }, [account, say]);

  useEffect(() => {
    if (screen.current) screen.current.scrollTop = screen.current.scrollHeight;
  }, [lines]);

  function summary() {
    const a = session.current.answers;
    const rows: [string, string | undefined][] = [
      ["name", a.name],
      ["ticker", a.symbol && `$${a.symbol}`],
      ["about", a.about],
      ["category", a.category],
      ["skills", a.skills],
      ["endpoint", a.endpoint],
      ["logo", a.logo],
      ["website", a.website],
      ["twitter", a.twitter],
      ["telegram", a.telegram],
      ["wallet", a.wallet === undefined ? undefined : a.wallet || (account ? `${account} (yours)` : "your wallet")],
      ["fee", a.tax && `${a.tax}%`],
      ["buyback", a.buyback],
      ["buy", a.buy === undefined ? undefined : a.buy ? `${a.buy} ETH` : "none"],
    ];
    const filled = rows.filter(([, v]) => v !== undefined);
    if (filled.length === 0) return say("dim", "Nothing answered yet.");
    for (const [k, v] of filled) say("dim", `  ${k.padEnd(9)} ${v || "—"}`);
  }

  function review() {
    session.current.phase = "ready";
    session.current.editing = false;
    say("sys", "That is everything. Here is your agent:");
    summary();
    say("sys", "Type launch to simulate it, or edit <field> to change something.");
  }

  async function simulate() {
    const s = session.current;
    const a = s.answers as Answers;
    const e = env.current;
    if (!account) return say("err", "Connect a wallet first: type connect.");
    if (!e) return say("err", "Still reading Pons v2. Try again in a moment.");
    const reason = blockedReason(e, true);
    if (reason) return say("err", reason);
    const form = toLaunchForm(a);
    const problems = validateLaunchForm(form);
    if (problems.length > 0) return problems.forEach((p) => say("err", p));

    s.phase = "busy";
    say("dim", "Simulating against Pons v2…");
    try {
      const prepared = await prepareLaunch({
        form,
        account,
        creatorFeeRecipient: (a.wallet || account) as Address,
        creatorTaxBps: taxBps(a),
        buybackEnabled: a.buyback === "yes",
        launchConfigId: e.configs[0].id,
        launchFee: e.launchFee,
        initialBuy: initialBuyWei(a),
        slippageBps: SLIPPAGE_BPS,
      });
      s.prepared = prepared;
      s.phase = "simulated";
      say("ok", "Simulation passed.");
      say("dim", `  token     ${prepared.token}`);
      say("dim", `  you send  ${fmt(prepared.value)} ETH (launch fee ${fmt(e.launchFee)} ETH included)`);
      if (prepared.tokensOut > 0n) say("dim", `  you get   about ${fmt(prepared.tokensOut)} ${a.symbol}`);
      say("dim", `  curve fee ${pct(e.configs[0].curveFeeBps)} · graduates at ${fmt(e.configs[0].graduationThreshold)} ETH`);
      say("sys", "Type confirm to sign and launch, or cancel.");
    } catch (err) {
      s.phase = "ready";
      say("err", `Simulation failed, nothing was sent: ${errMsg(err)}`);
    }
  }

  async function send() {
    const s = session.current;
    if (!s.prepared) return;
    s.phase = "busy";
    say("dim", "Confirm the transaction in your wallet…");
    try {
      const hash = await s.prepared.send(await getClient());
      say("dim", `Sent ${shortAddr(hash)}. Waiting for confirmation…`);
      const token = await waitForLaunch(hash);
      s.token = token;
      s.phase = "done";
      say("ok", `${s.answers.name} is live at ${token}`);
      say("sys", "Open the agent page →", `#/agent/${token}`);
      say("dim", "Type restart to launch another.");
    } catch (err) {
      s.prepared = null;
      s.phase = "ready";
      say("err", errMsg(err));
      say("sys", "Nothing was launched. Type launch to try again.");
    }
  }

  async function run(raw: string) {
    const s = session.current;
    const cmd = raw.trim().toLowerCase();
    say("you", raw);

    if (cmd === "help") return HELP.forEach((h) => say("dim", `  ${h}`));
    if (cmd === "clear") return setLines([]);
    if (cmd === "status") return summary();
    if (cmd === "connect") {
      if (account) return say("dim", `Already connected as ${shortAddr(account)}.`);
      try {
        await connect();
        say("ok", "Wallet connected.");
      } catch (err) {
        say("err", errMsg(err));
      }
      return;
    }
    if (cmd === "restart") {
      session.current = fresh();
      say("dim", "Starting over.");
      return ask();
    }
    if (s.phase === "done") return say("dim", "This agent is launched. Type restart to launch another.");

    if (cmd === "back") {
      if (s.phase !== "ask") s.step = STEPS.length - 1;
      else if (s.step > 0) s.step -= 1;
      s.phase = "ask";
      s.editing = false;
      s.prepared = null;
      return ask();
    }
    if (cmd.startsWith("edit")) {
      const name = cmd.slice(4).trim();
      const key = FIELD_ALIASES[name] ?? name;
      const at = STEPS.findIndex((st) => st.key === key);
      if (at === -1) return say("err", `Unknown field. Try one of: ${STEPS.map((st) => st.key).join(", ")}.`);
      if (at > s.step && s.phase === "ask") return say("err", "You have not reached that question yet.");
      s.editing = s.phase !== "ask";
      s.phase = "ask";
      s.step = at;
      s.prepared = null;
      return ask();
    }

    if (s.phase === "ask") {
      const step = STEPS[s.step];
      const res = answerStep(step, raw, ctx());
      if (!res.ok) return say("err", res.error);
      s.answers[step.key] = res.value;
      if (s.editing || s.step === STEPS.length - 1) return review();
      s.step += 1;
      return ask();
    }
    if (s.phase === "ready") {
      if (cmd === "launch") return simulate();
      return say("dim", "Type launch to simulate, edit <field> to change an answer, or help.");
    }
    if (s.phase === "simulated") {
      if (cmd === "confirm") return send();
      if (cmd === "cancel") {
        s.prepared = null;
        s.phase = "ready";
        return say("dim", "Cancelled. Nothing was sent. Type launch to simulate again.");
      }
      return say("dim", "Type confirm to sign and launch, or cancel.");
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    // Read the DOM value: the state copy can lag a fast keystroke-then-enter.
    const raw = field.current?.value ?? input;
    setInput("");
    setBusy(true);
    run(raw)
      .catch((err) => say("err", errMsg(err)))
      .finally(() => {
        setBusy(false);
        field.current?.focus();
      });
  }

  return (
    <section className="term" onClick={() => field.current?.focus()}>
      <div className="term-bar">
        <span>kips</span>
        <span>{account ? shortAddr(account) : "no wallet — type connect"}</span>
      </div>
      <div className="term-screen" ref={screen} aria-live="polite">
        {lines.map((l, i) => (
          <div key={i} className={`ln ${l.kind}`}>
            {l.kind === "you" && <span className="prompt">&gt; </span>}
            {l.href ? <a href={l.href}>{l.text}</a> : l.text}
          </div>
        ))}
        <form className="ln entry" onSubmit={onSubmit}>
          <span className="prompt">&gt; </span>
          <input
            ref={field}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Terminal input"
          />
        </form>
      </div>
    </section>
  );
}
