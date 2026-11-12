import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Intro } from "./components/Intro";
import { WalletProvider } from "./lib/wallet";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider>
      <App />
      <Intro />
    </WalletProvider>
  </StrictMode>,
);
