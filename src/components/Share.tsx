import { CopyButton } from "./Ui";
import { XLogo } from "./Icons";

/** The site's own address, used for links that are shared off-site. */
const SITE = (import.meta.env.VITE_SITE_URL || "https://www.trykips.app").replace(/\/$/, "");

/** A token's share link: it shows a card with the token's live stats when posted. */
export const shareUrl = (token: string) => `${SITE}/t/${token}`;

export function xIntent(token: string, symbol: string, name: string): string {
  const text = `$${symbol} · ${name} is live on Robinhood Chain via @trykips`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl(token))}`;
}

/** Share on X and copy-link buttons for a token. */
export function ShareButtons({ token, symbol, name, className = "chip-row" }: { token: string; symbol: string; name: string; className?: string }) {
  return (
    <div className={className}>
      <a className="chip chip-accent" href={xIntent(token, symbol, name)} target="_blank" rel="noopener noreferrer">
        <XLogo width={13} height={13} /> Share on X
      </a>
      <CopyButton value={shareUrl(token)} label="Copy share link" />
    </div>
  );
}
