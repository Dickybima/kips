import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { shortAddr } from "./lib/format";
import { useWallet } from "./lib/wallet";
import { AgentPage } from "./pages/AgentPage";
import { Explore } from "./pages/Explore";
import { Home } from "./pages/Home";
import { Kips } from "./pages/Kips";

type Route = { page: "home" } | { page: "explore" } | { page: "kips" } | { page: "agent"; token: Address };

function parseRoute(hash: string): Route {
  const [, page, arg] = hash.replace(/^#/, "").split("/");
  if (page === "explore") return { page: "explore" };
  if (page === "kips" || page === "launch") return { page: "kips" };
  if (page === "agent" && arg && isAddress(arg)) return { page: "agent", token: arg };
  return { page: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const { account, connect } = useWallet();

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          KIPS
        </a>
        <nav>
          <a href="#/" className={route.page === "home" ? "on" : ""}>
            Home
          </a>
          <a href="#/explore" className={route.page === "explore" ? "on" : ""}>
            Explore
          </a>
          <a href="#/kips" className={route.page === "kips" ? "on" : ""}>
            Kips
          </a>
        </nav>
        <button className="btn" onClick={() => void connect()}>
          {account ? shortAddr(account) : "Connect wallet"}
        </button>
      </header>
      <main className="wrap">
        {route.page === "explore" && <Explore />}
        {route.page === "home" && <Home />}
        {route.page === "kips" && <Kips />}
        {route.page === "agent" && <AgentPage key={route.token} token={route.token} />}
      </main>
      <footer className="wrap foot">
        KIPS in Robinhood Chain. Tokens are high risk; nothing here is financial advice.
      </footer>
    </>
  );
}
