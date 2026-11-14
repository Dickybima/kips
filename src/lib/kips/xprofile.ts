// Tokenize X: turns a public X profile into a KIPS launch.
import type { LaunchForm } from "./agent";
import { LIMITS, byteLength } from "./agent";
import { LogoError, prepareLogo, uploadLogo } from "./image";

export interface XProfile {
  handle: string;
  name: string;
  bio: string;
  avatar: string;
  banner: string;
  followers: number;
  verified: boolean;
}

/** "@jack", "jack", "x.com/jack", "https://twitter.com/jack?s=20" -> "jack"; null when invalid. */
export function parseHandle(input: string): string | null {
  let s = input.trim();
  const url = s.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#\s]+)/i);
  if (url) s = url[1];
  s = s.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

/** Ticker from the handle: letters and digits, upper case. */
export function tickerFromHandle(handle: string): string {
  const t = handle.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, LIMITS.symbol);
  return t || "XPROFILE";
}

/** Trims text to a byte budget without splitting a character. */
function fitBytes(s: string, max: number): string {
  if (byteLength(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (byteLength(out + ch + "…") > max) break;
    out += ch;
  }
  return `${out}…`;
}

export const xUrl = (handle: string) => `https://x.com/${handle}`;

export function profileForm(p: XProfile, opts: { name: string; symbol: string; logo: string }): LaunchForm {
  return {
    name: fitBytes(opts.name.trim() || p.name, LIMITS.name),
    symbol: opts.symbol.trim().replace(/^\$/, "").toUpperCase(),
    logo: opts.logo,
    about: fitBytes(p.bio, 1500),
    profile: { category: "profile", skills: [], endpoint: "" },
    socials: { twitter: xUrl(p.handle), telegram: "", discord: "", website: "" },
  };
}

export class XProfileError extends Error {}

export async function fetchXProfile(handle: string): Promise<XProfile> {
  let res: Response;
  try {
    res = await fetch(`/api/x-profile?u=${encodeURIComponent(handle)}`);
  } catch {
    throw new XProfileError("Could not reach KIPS. Check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as Partial<XProfile> & { error?: string };
  if (!res.ok || !data.handle) throw new XProfileError(data.error ?? `Profile lookup failed (${res.status}).`);
  return data as XProfile;
}

/**
 * Copies the profile picture into KIPS storage so the token keeps its logo
 * even if the account changes its picture. Falls back to the X image URL.
 */
export async function avatarToLogo(avatar: string): Promise<string> {
  if (!avatar) return "";
  try {
    const res = await fetch(avatar, { mode: "cors" });
    if (!res.ok) throw new LogoError("avatar unavailable");
    const blob = await res.blob();
    const file = new File([blob], "avatar", { type: blob.type || "image/jpeg" });
    const prepared = await prepareLogo(file);
    URL.revokeObjectURL(prepared.preview);
    return await uploadLogo(prepared.blob);
  } catch {
    return avatar;
  }
}

export const compactCount = (n: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
