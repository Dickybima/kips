import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { errMsg, shortAddr } from "./lib/format";
import { useWallet } from "./lib/wallet";
import { AgentPage } from "./pages/AgentPage";
import { Explore } from "./pages/Explore";
import { Launch } from "./pages/Launch";

type Route = { page: "explore" } | { page: "launch" } | { page: "agent"; token: Address };

function parseRoute(hash: string): Route {
  const [, page, arg] = hash.replace(/^#/, "").split("/");
  if (page === "launch") return { page: "launch" };
  if (page === "agent" && arg && isAddress(arg)) return { page: "agent", token: arg };
  return { page: "explore" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const { account, connect, hasProvider } = useWallet();
  const [walletError, setWalletError] = useState("");

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const onConnect = () => {
    setWalletError("");
    connect().catch((e) => setWalletError(errMsg(e)));
  };

  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          kips<span>agent launchpad</span>
        </a>
        <nav>
          <a href="#/" className={route.page === "explore" ? "on" : ""}>
            Explore
          </a>
          <a href="#/launch" className={route.page === "launch" ? "on" : ""}>
            Launch agent
          </a>
        </nav>
        <button className="btn" onClick={onConnect} disabled={!!account}>
          {account ? shortAddr(account) : hasProvider ? "Connect wallet" : "No wallet"}
        </button>
      </header>
      {walletError && <p className="note bad wrap">{walletError}</p>}
      <main className="wrap">
        {route.page === "explore" && <Explore />}
        {route.page === "launch" && <Launch />}
        {route.page === "agent" && <AgentPage key={route.token} token={route.token} />}
      </main>
      <footer className="wrap foot">
        kips launches agent tokens through Pons v2 on Robinhood Chain. Tokens are high risk; nothing here is financial
        advice.
      </footer>
    </>
  );
}
