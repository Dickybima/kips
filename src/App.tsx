import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { KipsMark, Menu, Close, Moon, Sun, Wallet, XLogo } from "./components/Icons";

/** KIPS on X. */
export const X_URL = "https://x.com/trykips";
import { Ticker } from "./components/Ticker";
import { shortAddr } from "./lib/format";
import { useWallet } from "./lib/wallet";
import { Agent } from "./pages/Agent";
import { AgentPage } from "./pages/AgentPage";
import { Explore } from "./pages/Explore";
import { Features } from "./pages/Features";
import { Home } from "./pages/Home";
import { HowItWorks } from "./pages/HowItWorks";
import { Network } from "./pages/Network";
import { Terminal } from "./pages/Terminal";
import { Tokenize } from "./pages/Tokenize";

type Page = "home" | "features" | "how-it-works" | "agent" | "tokenize" | "explore" | "terminal" | "network";
type Route = { page: Page } | { page: "token"; token: Address };

export const NAV: { page: Page; label: string; blurb: string }[] = [
  { page: "features", label: "Features", blurb: "What KIPS handles for every agent you launch." },
  { page: "how-it-works", label: "How it works", blurb: "Four steps from an idea to a live token." },
  { page: "agent", label: "Kips", blurb: "Talk to KIPS and launch an agent token." },
  { page: "tokenize", label: "Tokenize X", blurb: "Turn any X profile into a token." },
  { page: "explore", label: "Explore", blurb: "Every agent launched with KIPS." },
  { page: "terminal", label: "Terminal", blurb: "Buy and sell agent tokens by chat." },
  { page: "network", label: "Network", blurb: "Live Robinhood Chain stats and contracts." },
];

function parseRoute(hash: string): Route {
  const [, page, arg] = hash.replace(/^#/, "").split("/");
  if (page === "agent" && arg && isAddress(arg)) return { page: "token", token: arg };
  if (page === "kips" || page === "launch") return { page: "agent" };
  const known = NAV.find((n) => n.page === page);
  return { page: known ? known.page : "home" };
}

type Theme = "dark" | "light";
function initialTheme(): Theme {
  try {
    const t = localStorage.getItem("kips.theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    // fall through to the default
  }
  return "dark";
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [menu, setMenu] = useState(false);
  const { account, connect } = useWallet();

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(location.hash));
      setMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("kips.theme", theme);
    } catch {
      // the choice just won't persist
    }
  }, [theme]);

  const active = route.page === "token" ? "explore" : route.page;
  const full = route.page === "agent" || route.page === "terminal";

  return (
    <div className={full ? "shell shell-full" : "shell"}>
      <Ticker />
      <header className="nav">
        <div className="nav-in">
          <a className="brand" href="#/">
            <KipsMark />
            <span>KIPS</span>
          </a>
          <nav className={menu ? "links open" : "links"}>
            {NAV.map((n) => (
              <a key={n.page} href={`#/${n.page}`} className={active === n.page ? "on" : ""}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="nav-end">
            <button
              className="icon-btn"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <a className="icon-btn x-link" href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="KIPS on X" title="@trykips on X">
              <XLogo />
            </a>
            <button className="btn btn-ghost wallet-btn" onClick={() => void connect()}>
              <Wallet />
              <span>{account ? shortAddr(account) : "Connect Wallet"}</span>
            </button>
            <button className="icon-btn menu-btn" onClick={() => setMenu(!menu)} aria-label="Menu" aria-expanded={menu}>
              {menu ? <Close /> : <Menu />}
            </button>
          </div>
        </div>
      </header>

      <main className={full ? "main-full" : "main"}>
        {route.page === "home" && <Home />}
        {route.page === "features" && <Features />}
        {route.page === "how-it-works" && <HowItWorks />}
        {route.page === "agent" && <Agent />}
        {route.page === "tokenize" && <Tokenize />}
        {route.page === "explore" && <Explore />}
        {route.page === "terminal" && <Terminal />}
        {route.page === "network" && <Network />}
        {route.page === "token" && <AgentPage key={route.token} token={route.token} />}
      </main>

      {!full && (
        <footer className="foot">
          <div className="foot-in">
            <a className="brand" href="#/">
              <KipsMark />
              <span>KIPS</span>
            </a>
            <span className="muted">© 2026 KIPS // built on Robinhood Chain</span>
            <span className="muted small">Agent tokens are high risk. Nothing here is financial advice.</span>
          </div>
        </footer>
      )}
    </div>
  );
}
