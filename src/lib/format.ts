import { formatUnits, parseUnits } from "viem";

/** Formats an 18-decimal amount with up to `digits` significant fraction digits. */
export function fmt(value: bigint, digits = 4): string {
  const s = formatUnits(value, 18);
  const [int, frac = ""] = s.split(".");
  if (int.replace("-", "").length >= 7) return compact(Number(int));
  if (int !== "0" && int !== "-0") return frac ? `${group(int)}.${frac.slice(0, 2)}`.replace(/\.?0+$/, "") : group(int);
  const lead = frac.match(/^0*/)?.[0].length ?? 0;
  const cut = frac.slice(0, lead + digits).replace(/0+$/, "");
  return cut ? `0.${cut}` : "0";
}

const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

/** Parses a user-typed decimal amount into wei; null when empty or invalid. */
export function parseAmount(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  try {
    const v = parseUnits(s, 18);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const pct = (bps: bigint | number) => `${(Number(bps) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export function errMsg(e: unknown): string {
  const o = e as { shortMessage?: string; message?: string };
  return o?.shortMessage || o?.message || String(e);
}
