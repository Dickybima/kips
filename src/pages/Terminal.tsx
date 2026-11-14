import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { ArrowUp, Sparkle } from "../components/Icons";
import { Label } from "../components/Ui";
import { OFFICIAL_TOKEN, isOfficial } from "../lib/kips/official";
import { isHidden } from "../lib/kips/hidden";
import { parseTrade, type TradeIntent } from "../lib/kips/trade-intent";
import { errMsg, fmt, parseAmount, pct, shortAddr } from "../lib/format";
import { NATIVE_QUOTE, publicClient } from "../lib/pons/chain";
import { graduationProgressBps, minTokensOutForBuy, minWithSlippage, quoteBuy, quoteSell } from "../lib/pons/quote";
import { readBalances, readCurveState, readLaunched, readTokenMeta, scanAgents } from "../lib/pons/read";
import { buy, sell } from "../lib/pons/write";
import { useWallet } from "../lib/wallet";

const WAD = 10n ** 18n;
/** Keep a little ETH back for gas when someone buys with their whole balance. */
const GAS_RESERVE = 2n * 10n ** 14n;

interface TokenRef {
  token: Address;
  curve: Address;
  symbol: string;
  name: string;
  native: boolean;
  open: boolean;
  official: boolean;
}

interface Order {
  side: "buy" | "sell";
  ref: TokenRef;
  amountIn: bigint;
  expectedOut: bigint;
  minOut: bigint;
  fee: bigint;
  tax: bigint;
  snipeTax: bigint;
  refund: bigint;
}

type Tone = "plain" | "ok" | "err" | "dim";
interface Msg {
  who: "kips" | "you";
  text: string;
  tone?: Tone;
  href?: string;
}

const EXAMPLES = ["swap 0.01 eth to kips", "buy kips with 0.05 eth", "sell 50% kips", "price kips", "balance"];

const HELP = [
  "swap 0.1 eth to kips     buy with ETH",
  "buy kips with 0.1 eth    same thing",
  "sell 50% kips            sell a share of your bag",
  "swap 1000 kips to eth    sell an exact amount",
  "sell all kips            sell everything",
  "price kips               price, market cap, curve progress",
  "balance [kips]           your ETH and token balances",
  "slippage 3%              set max slippage (now {S})",
  "confirm / cancel         execute or drop the quoted order",
  "Tokens: a ticker ($KIPS, any KIPS agent) or a 0x contract address.",
].join("\n");

export function Terminal() {
  const { account, connect, getClient } = useWallet();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [slippageBps, setSlippageBps] = useState(300n);
  const orderRef = useRef<Order | null>(null);
  orderRef.current = order;
  const registry = useRef<Map<string, TokenRef>>(new Map());
  const scanning = useRef<Promise<void> | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const greeted = useRef(false);

  const say = useCallback((who: Msg["who"], text: string, tone: Tone = "plain", href?: string) => {
    setMsgs((m) => [...m, { who, text, tone, href }]);
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  async function refFor(token: Address): Promise<TokenRef | null> {
    const [launched, meta] = await Promise.all([readLaunched(token), readTokenMeta(token).catch(() => null)]);
    if (!launched) return null;
    return {
      token: launched.token,
      curve: launched.curve,
      symbol: meta?.symbol ?? "TOKEN",
      name: meta?.name ?? shortAddr(token),
      native: launched.pairToken === NATIVE_QUOTE,
      open: launched.phase === 0,
      official: isOfficial(token),
    };
  }

  // Tickers known to the terminal: the official token, then every KIPS agent.
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    say(
      "kips",
      "This is the KIPS terminal. Trade any KIPS agent token on Robinhood Chain by chat, e.g. swap 0.01 eth to kips. Every order is quoted and simulated before your wallet is asked to sign. Type help for all commands.",
    );
    scanning.current = (async () => {
      const off = await refFor(OFFICIAL_TOKEN).catch(() => null);
      if (off) registry.current.set(off.symbol.toUpperCase(), off);
      const head = await publicClient.getBlockNumber();
      await scanAgents(head, {
        onFound: (a) => {
          const sym = a.meta.symbol.toUpperCase();
          if (isHidden(a.meta.token) || registry.current.has(sym)) return; // the official token wins its ticker
          registry.current.set(sym, {
            token: a.meta.token, curve: a.curve, symbol: a.meta.symbol, name: a.meta.name, native: true, open: true, official: false,
          });
        },
      });
    })().catch(() => {});
  }, [say]);

  async function resolve(ref: string): Promise<TokenRef | null> {
    if (isAddress(ref)) {
      const r = await refFor(getAddress(ref));
      if (!r) say("kips", `${shortAddr(ref)} is not a token launched on the protocol.`, "err");
      return r;
    }
    let hit = registry.current.get(ref.toUpperCase());
    if (!hit && scanning.current) {
      say("kips", "Looking up that ticker…", "dim");
      await scanning.current;
      hit = registry.current.get(ref.toUpperCase());
    }
    if (!hit) {
      say("kips", `No KIPS token with the ticker $${ref}. Use the contract address instead (swap 0.1 eth to 0x…).`, "err");
      return null;
    }
    // Phase can change after the registry was built, so check it fresh.
    return (await refFor(hit.token)) ?? hit;
  }

  function tradable(r: TokenRef): boolean {
    if (!r.native) {
      say("kips", `$${r.symbol} is paired with a token other than ETH. The terminal trades ETH pairs only.`, "err");
      return false;
    }
    if (!r.open) {
      say("kips", `$${r.symbol} has graduated to its Uniswap v4 pool. The terminal trades on the bonding curve only for now.`, "err");
      return false;
    }
    return true;
  }

  async function quote(intent: Extract<TradeIntent, { kind: "buy" | "sell" }>) {
    if (!account) {
      say("kips", "Connect a wallet first: use Connect Wallet at the top.", "err");
      void connect();
      return;
    }
    const r = await resolve(intent.token);
    if (!r || !tradable(r)) return;
    const [curve, bal] = await Promise.all([readCurveState(r.curve, account), readBalances(r.token, account)]);
    if (curve.graduated || curve.readyToGraduate) return say("kips", `$${r.symbol}'s curve is sold out and graduating. Try again shortly.`, "err");

    if (intent.kind === "buy") {
      const eth = parseAmount(intent.eth);
      if (eth === null) return say("kips", "That ETH amount doesn't look right.", "err");
      if (eth + GAS_RESERVE > bal.eth) return say("kips", `Not enough ETH: you have ${fmt(bal.eth)} ETH (keep a little for gas).`, "err");
      const q = quoteBuy(curve, curve.sellable, eth, curve.feeBps, curve.creatorTaxBps, curve.snipeTaxBps);
      const o: Order = {
        side: "buy", ref: r, amountIn: eth, expectedOut: q.tokensOut, minOut: minTokensOutForBuy(eth, q, slippageBps),
        fee: q.fee, tax: q.tax, snipeTax: q.snipeTax, refund: q.refund,
      };
      setOrder(o);
      say("kips", [
        `Quote: buy $${r.symbol}${r.official ? " (official)" : ""}`,
        `you pay      ${fmt(eth)} ETH`,
        `you get      ~${fmt(q.tokensOut)} ${r.symbol}`,
        `min out      ${fmt(o.minOut)} ${r.symbol} (${pct(slippageBps)} slippage)`,
        `fees         ${fmt(q.fee + q.tax, 6)} ETH (protocol ${pct(curve.feeBps)} + creator ${pct(curve.creatorTaxBps)})`,
        ...(q.snipeTax > 0n ? [`launch tax   ${fmt(q.snipeTax, 6)} ETH (${pct(q.snipeTaxBps)}, fades shortly after launch)`] : []),
        ...(q.refund > 0n ? [`refund       ${fmt(q.refund)} ETH (the curve sells out)`] : []),
        "",
        "Type confirm to sign, or cancel.",
      ].join("\n"), "ok");
      return;
    }

    const a = intent.amount;
    const tokensIn =
      a.kind === "all" ? bal.tokens
      : a.kind === "pct" ? (bal.tokens * BigInt(Math.round(a.pct * 100))) / 10_000n
      : parseAmount(a.amount);
    if (tokensIn === null || tokensIn <= 0n) return say("kips", bal.tokens === 0n ? `You don't hold any $${r.symbol}.` : "That amount doesn't look right.", "err");
    if (tokensIn > bal.tokens) return say("kips", `You only hold ${fmt(bal.tokens)} ${r.symbol}.`, "err");
    const q = quoteSell(curve, tokensIn, curve.feeBps, curve.creatorTaxBps);
    const o: Order = {
      side: "sell", ref: r, amountIn: tokensIn, expectedOut: q.quoteOut, minOut: minWithSlippage(q.quoteOut, slippageBps),
      fee: q.fee, tax: q.tax, snipeTax: 0n, refund: 0n,
    };
    setOrder(o);
    say("kips", [
      `Quote: sell $${r.symbol}${r.official ? " (official)" : ""}`,
      `you sell     ${fmt(tokensIn)} ${r.symbol}`,
      `you get      ~${fmt(q.quoteOut, 6)} ETH`,
      `min out      ${fmt(o.minOut, 6)} ETH (${pct(slippageBps)} slippage)`,
      `fees         ${fmt(q.fee + q.tax, 6)} ETH`,
      "",
      "Type confirm to sign, or cancel. Selling may ask for an approval first.",
    ].join("\n"), "ok");
  }

  async function execute() {
    const o = orderRef.current;
    if (!o) return say("kips", "There's no order to confirm. Ask for a quote first, e.g. swap 0.01 eth to kips.", "dim");
    if (!account) return say("kips", "Connect a wallet first.", "err");
    say("kips", "Simulating on Robinhood Chain, then confirm in your wallet…", "dim");
    try {
      const wallet = await getClient();
      const hash =
        o.side === "buy"
          ? await buy(wallet, account, o.ref.curve, o.amountIn, o.minOut)
          : await sell(wallet, account, o.ref.token, o.ref.curve, o.amountIn, o.minOut);
      setOrder(null);
      const bal = await readBalances(o.ref.token, account);
      say("kips", `Done. ${o.side === "buy" ? "Bought" : "Sold"} $${o.ref.symbol} (tx ${shortAddr(hash)}).\nYou now hold ${fmt(bal.tokens)} ${o.ref.symbol} and ${fmt(bal.eth)} ETH.`, "ok");
      say("kips", `Open the $${o.ref.symbol} page →`, "plain", `#/agent/${o.ref.token}`);
    } catch (e) {
      say("kips", `${errMsg(e)}\nNothing was traded. Ask for a fresh quote to try again.`, "err");
      setOrder(null);
    }
  }

  async function price(token: string) {
    const r = await resolve(token);
    if (!r) return;
    const [curve, supply] = await Promise.all([
      readCurveState(r.curve, account),
      readBalances(r.token, account ?? "0x000000000000000000000000000000000000dEaD").then((b) => b.supply),
    ]);
    const launched = await readLaunched(r.token);
    const p = curve.tokenReserve > 0n ? (curve.quoteReserve * WAD) / curve.tokenReserve : 0n;
    const progress = launched ? graduationProgressBps(curve.realQuoteReserve, launched.graduationThreshold) : 0;
    say("kips", [
      `$${r.symbol} · ${r.name}${r.official ? " (official)" : ""}`,
      `price        ${fmt(p, 6)} ETH`,
      `market cap   ${fmt((p * supply) / WAD)} ETH`,
      `raised       ${fmt(curve.realQuoteReserve)} / ${launched ? fmt(launched.graduationThreshold) : "?"} ETH (${pct(progress)})`,
      `status       ${r.open && !curve.graduated ? "bonding curve" : "graduated"}`,
      `contract     ${r.token}`,
    ].join("\n"));
  }

  async function balance(token: string | null) {
    if (!account) return say("kips", "Connect a wallet first.", "err");
    const eth = await publicClient.getBalance({ address: account });
    if (!token) return say("kips", `${shortAddr(account)} holds ${fmt(eth)} ETH. Ask balance kips for a token.`);
    const r = await resolve(token);
    if (!r) return;
    const b = await readBalances(r.token, account);
    say("kips", `${shortAddr(account)} holds ${fmt(b.tokens)} ${r.symbol} and ${fmt(eth)} ETH.`);
  }

  async function handle(raw: string) {
    const text = raw.trim();
    if (!text) return;
    say("you", text);
    const cmd = text.toLowerCase();
    if (cmd === "help") return say("kips", HELP.replace("{S}", pct(slippageBps)), "dim");
    if (cmd === "confirm" || cmd === "yes" || cmd === "y") return execute();
    if (cmd === "cancel" || cmd === "no" || cmd === "n") {
      if (!orderRef.current) return say("kips", "There's nothing to cancel.", "dim");
      setOrder(null);
      return say("kips", "Order cancelled. Nothing was sent.", "dim");
    }
    const sl = cmd.match(/^slippage (\d+(?:\.\d+)?)%?$/);
    if (sl) {
      const bps = Math.round(Number(sl[1]) * 100);
      if (bps < 10 || bps > 5000) return say("kips", "Pick a slippage between 0.1% and 50%.", "err");
      setSlippageBps(BigInt(bps));
      return say("kips", `Max slippage set to ${pct(bps)}. It applies to the next quote.`, "ok");
    }
    const intent = parseTrade(text);
    if (!intent) return say("kips", "I didn't catch that. Try swap 0.01 eth to kips, sell 50% kips, or type help.", "dim");
    setOrder(null); // a new request replaces any pending quote
    if (intent.kind === "price") return price(intent.token);
    if (intent.kind === "balance") return balance(intent.token);
    return quote(intent);
  }

  function submit(text = input) {
    if (busy || !text.trim()) return;
    setInput("");
    setBusy(true);
    handle(text)
      .catch((e) => say("kips", errMsg(e), "err"))
      .finally(() => {
        setBusy(false);
        field.current?.focus();
      });
  }

  return (
    <div className="lab">
      <aside className="lab-side">
        <Label n="06">Terminal</Label>
        <h1>Trade by chat.</h1>
        <p className="muted">
          Buy and sell KIPS agent tokens on Robinhood Chain with one line. Every order is quoted from the live curve and
          simulated before your wallet signs.
        </p>
        <p className="lab-h">// try one</p>
        <div className="lab-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="lab-box lab-ex" onClick={() => submit(ex)} disabled={busy}>
              <span className="accent">›</span> {ex}
            </button>
          ))}
        </div>
        <p className="muted small">
          Commands: <b>confirm</b>, <b>cancel</b>, <b>slippage 3%</b>, <b>help</b>. Trades run on the bonding curve;
          graduated tokens trade in their Uniswap v4 pool.
        </p>
      </aside>

      <section className="lab-chat">
        <div className="lab-log" ref={log} aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.who} ${m.tone ?? "plain"}`}>
              {m.who === "kips" && <span className="bubble-who">terminal</span>}
              {m.href ? <a href={m.href}>{m.text}</a> : <span className="bubble-text">{m.text}</span>}
            </div>
          ))}
          {busy && <div className="bubble kips dim thinking">Working</div>}
        </div>
        <form
          className="lab-input"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Sparkle className="accent" />
          <textarea
            ref={field}
            rows={1}
            value={input}
            placeholder="swap 0.01 eth to kips…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit((e.target as HTMLTextAreaElement).value);
              }
            }}
            disabled={busy}
            aria-label="Trade command"
            autoFocus
          />
          <button className="send" disabled={busy || !input.trim()} aria-label="Send">
            <ArrowUp />
          </button>
        </form>
      </section>

      <aside className="lab-blueprint">
        <div className="bp">
          <div className="bp-bar">
            <i />
            <i />
            <i className={order ? "on" : ""} />
            <span>order.json</span>
          </div>
          {order ? (
            <pre className="bp-json">
              {JSON.stringify(
                {
                  side: order.side,
                  token: `$${order.ref.symbol}`,
                  contract: shortAddr(order.ref.token),
                  [order.side === "buy" ? "pay_eth" : "sell_tokens"]: fmt(order.amountIn, 6),
                  [order.side === "buy" ? "receive_tokens" : "receive_eth"]: `~${fmt(order.expectedOut, 6)}`,
                  min_out: fmt(order.minOut, 6),
                  slippage: pct(slippageBps),
                  network: "Robinhood Chain",
                },
                null,
                2,
              )}
            </pre>
          ) : (
            <p className="bp-empty muted">Ask for a quote and your order shows up here.</p>
          )}
          <div className="bp-foot">
            <button className="btn btn-solid full" onClick={() => submit("confirm")} disabled={busy || !order}>
              {order ? `Confirm ${order.side}` : "No order yet"}
            </button>
            {order && (
              <button className="btn btn-ghost full" onClick={() => submit("cancel")} disabled={busy}>
                Cancel
              </button>
            )}
            <p className="muted small">Max slippage {pct(slippageBps)} · type slippage 5% to change</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
