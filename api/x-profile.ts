// Vercel Function: looks up a public X profile so it can be tokenized.
// GET /api/x-profile?u=<handle> -> { handle, name, bio, avatar, banner, followers, verified }
// Data comes from the public FxTwitter API, which needs no X API key. Its
// profile lookups sometimes answer "not found" for real accounts, so a 404
// is retried a few times before it is believed.

export const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const SOURCE = "https://api.fxtwitter.com";
const TRIES = 4;

export interface XProfile {
  handle: string;
  name: string;
  bio: string;
  avatar: string;
  banner: string;
  followers: number;
  verified: boolean;
}

/** Profile images come as _normal or _200x200; ask for the 400px one. */
export function largeAvatar(url: string): string {
  return url.replace(/_(normal|bigger|mini|200x200)(\.[a-z]+)$/i, "_400x400$2");
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function toProfile(user: Record<string, unknown>): XProfile {
  const verification = (user.verification ?? {}) as Record<string, unknown>;
  const avatar = text(user.avatar_url);
  return {
    handle: text(user.screen_name),
    name: text(user.name).trim() || text(user.screen_name),
    bio: text(user.description).trim(),
    avatar: avatar ? largeAvatar(avatar) : "",
    banner: text(user.banner_url),
    followers: typeof user.followers === "number" ? user.followers : 0,
    verified: verification.verified === true,
  };
}

type Lookup = { status: "ok"; profile: XProfile } | { status: "missing" } | { status: "error" };

export async function lookup(handle: string, fetchImpl: typeof fetch = fetch, pause = 600): Promise<Lookup> {
  let missing = false;
  for (let i = 0; i < TRIES; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, pause));
    try {
      const res = await fetchImpl(`${SOURCE}/${handle}`, { headers: { "user-agent": "kips-tokenize/1.0" } });
      const body = (await res.json().catch(() => null)) as { user?: Record<string, unknown> } | null;
      if (res.ok && body?.user?.screen_name) return { status: "ok", profile: toProfile(body.user) };
      missing = res.status === 404;
    } catch {
      missing = false;
    }
  }
  return missing ? { status: "missing" } : { status: "error" };
}

const json = (body: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache } });

export async function GET(request: Request): Promise<Response> {
  const handle = (new URL(request.url).searchParams.get("u") ?? "").trim().replace(/^@/, "");
  if (!HANDLE.test(handle)) return json({ error: "That is not a valid X username." }, 400);
  const found = await lookup(handle);
  if (found.status === "ok") return json(found.profile, 200, "public, s-maxage=300, stale-while-revalidate=600");
  if (found.status === "missing") return json({ error: `@${handle} was not found on X.` }, 404);
  return json({ error: "X profiles cannot be read right now. Try again in a moment." }, 502);
}
