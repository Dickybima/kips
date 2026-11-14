// Reads a trade out of a chat message, for example
//   "swap 0.1 eth to kips"     "buy 0.05 eth of $KIPS"     "buy kips 0.2 eth"
//   "sell 50% kips"            "swap 1000 kips to eth"      "sell all kips"
//   "price kips"               "balance kips"               "balance"
// Tokens are a ticker (with or without $) or a 0x contract address.

export type SellAmount = { kind: "all" } | { kind: "pct"; pct: number } | { kind: "tokens"; amount: string };

export type TradeIntent =
  | { kind: "buy"; eth: string; token: string }
  | { kind: "sell"; amount: SellAmount; token: string }
  | { kind: "price"; token: string }
  | { kind: "balance"; token: string | null };

const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const TOKEN = String.raw`(\$?[a-z0-9_]{1,16}|0x[0-9a-f]{40})`;
const ETH = String.raw`(?:eth|ether)`;
const TO = String.raw`(?:to|for|into|->|→|=>)`;

const clean = (t: string) => t.replace(/^\$/, "").toUpperCase();
const asToken = (t: string) => (/^0x[0-9a-f]{40}$/i.test(t) ? t : clean(t));
const isEth = (t: string) => /^\$?(eth|ether)$/i.test(t);

function sellAmount(raw: string): SellAmount | null {
  const s = raw.trim().toLowerCase();
  if (s === "all" || s === "max" || s === "everything") return { kind: "all" };
  const pct = s.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) {
    const n = Number(pct[1]);
    return n > 0 && n <= 100 ? { kind: "pct", pct: n } : null;
  }
  return /^(\d+(?:\.\d+)?|\.\d+)$/.test(s) ? { kind: "tokens", amount: s } : null;
}

export function parseTrade(input: string): TradeIntent | null {
  const text = input.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, " ");
  let m: RegExpMatchArray | null;

  // swap|buy 0.1 eth to|for|of kips
  if ((m = text.match(new RegExp(`^(?:swap|buy|ape|get) ${NUM} ?${ETH} (?:${TO}|of|worth of|in) ${TOKEN}$`, "i")))) {
    if (!isEth(m[2])) return { kind: "buy", eth: m[1], token: asToken(m[2]) };
  }
  // buy kips 0.1 eth  /  buy kips with 0.1 eth
  if ((m = text.match(new RegExp(`^(?:buy|ape|get) ${TOKEN} (?:with |for )?${NUM} ?${ETH}$`, "i")))) {
    if (!isEth(m[1])) return { kind: "buy", eth: m[2], token: asToken(m[1]) };
  }
  // swap 1000|all|50% kips to eth
  if ((m = text.match(new RegExp(`^(?:swap|sell|dump) (all|max|everything|\\d+(?:\\.\\d+)?%|${NUM}) (?:of )?(?:my )?${TOKEN} (?:${TO}) ${ETH}$`, "i")))) {
    const amount = sellAmount(m[1]);
    if (amount && !isEth(m[m.length - 1])) return { kind: "sell", amount, token: asToken(m[m.length - 1]) };
  }
  // sell 1000|all|50% kips
  if ((m = text.match(new RegExp(`^(?:sell|dump) (all|max|everything|\\d+(?:\\.\\d+)?%|${NUM}) (?:of )?(?:my )?${TOKEN}$`, "i")))) {
    const amount = sellAmount(m[1]);
    if (amount && !isEth(m[m.length - 1])) return { kind: "sell", amount, token: asToken(m[m.length - 1]) };
  }
  // sell kips 50% / sell kips all
  if ((m = text.match(new RegExp(`^(?:sell|dump) ${TOKEN} (all|max|\\d+(?:\\.\\d+)?%|${NUM})$`, "i")))) {
    const amount = sellAmount(m[2]);
    if (amount && !isEth(m[1])) return { kind: "sell", amount, token: asToken(m[1]) };
  }
  // price kips
  if ((m = text.match(new RegExp(`^(?:price|quote|chart|info) (?:of )?${TOKEN}$`, "i")))) {
    if (!isEth(m[1])) return { kind: "price", token: asToken(m[1]) };
  }
  // balance [kips]
  if ((m = text.match(new RegExp(`^(?:balance|bal|holdings|wallet)(?: (?:of )?${TOKEN})?$`, "i")))) {
    return { kind: "balance", token: m[1] && !isEth(m[1]) ? asToken(m[1]) : null };
  }
  return null;
}
