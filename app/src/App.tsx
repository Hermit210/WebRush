import { useMemo, useState } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

import { RPC_ENDPOINT } from "./anchor/program";
import { ConnectScreen } from "./components/ConnectScreen";
import { Lobby } from "./components/Lobby";
import { InRun, type RunResult } from "./components/InRun";
import { Result } from "./components/Result";

type Screen = "lobby" | "in-run" | "result";

function GameFlow() {
  const { connected } = useWallet();
  const [screen, setScreen] = useState<Screen>("lobby");
  const [result, setResult] = useState<RunResult | null>(null);

  if (!connected) return <ConnectScreen />;

  if (screen === "lobby") {
    return <Lobby onStarted={() => setScreen("in-run")} />;
  }
  if (screen === "in-run") {
    return (
      <InRun
        onFinished={(r) => {
          setResult(r);
          setScreen("result");
        }}
      />
    );
  }
  return (
    <Result result={result!} onPlayAgain={() => setScreen("lobby")} />
  );
}

export default function App() {
  // Explicit adapters, not just ambient Wallet Standard auto-detection --
  // "Wallet Standard" is a generic multi-chain discovery protocol, not
  // Solana-exclusive, and other installed extensions (e.g. MetaMask, which
  // also registers itself through it) can otherwise get surfaced instead of
  // Phantom. Pinning these makes Phantom/Solflare deterministic entries.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="app-shell">
            <GameFlow />
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
