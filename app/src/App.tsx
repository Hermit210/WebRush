import { useMemo, useState } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

import { RPC_ENDPOINT } from "./anchor/program";
import { Splash } from "./components/Splash";
import { WalletCornerPill } from "./components/WalletCornerPill";
import { Lobby } from "./components/Lobby";
import { InRun, type RunResult } from "./components/InRun";
import { Result } from "./components/Result";
import { useSessionKey } from "./hooks/useSessionKey";

type Screen = "splash" | "menu" | "in-run" | "result";

/**
 * Game shell: splash -> menu -> in-run -> result. Wallet connection is no
 * longer a gate in front of everything (the old `if (!connected) return
 * <ConnectScreen />`) -- the menu (Lobby) renders its branding/game info
 * regardless of connection state, and only actually requires a wallet at
 * the moment Play is clicked (see Lobby.tsx). The wallet control itself
 * lives in the persistent corner pill (see App() below), not gating any
 * screen transition here.
 */
function GameFlow({
  screen,
  setScreen,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
}) {
  const [result, setResult] = useState<RunResult | null>(null);
  // Lifted here (not inside Lobby/InRun) so both can share the SAME
  // session: Lobby creates it right after start_run, InRun uses it to sign
  // swings silently -- see README "Session keys".
  const { session, createSession, clearSession } = useSessionKey();

  if (screen === "splash") {
    return <Splash onDone={() => setScreen("menu")} />;
  }
  if (screen === "menu") {
    return (
      <Lobby
        onStarted={() => setScreen("in-run")}
        createSession={createSession}
      />
    );
  }
  if (screen === "in-run") {
    return (
      <InRun
        session={session}
        onFinished={(r) => {
          clearSession();
          setResult(r);
          setScreen("result");
        }}
      />
    );
  }
  return (
    <Result result={result!} onPlayAgain={() => setScreen("menu")} />
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
  const [screen, setScreen] = useState<Screen>("splash");

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      {/*
        Dedicated localStorageKey: WalletProvider persists the selected
        wallet's name under this key and reconnects to it directly on next
        visit -- clicking Connect Wallet skips the picker modal entirely
        whenever a name is already stored (see BaseWalletMultiButton's
        'has-wallet' case, which calls onConnect() instead of opening the
        modal). The default key ('walletName') could hold a stale value
        from testing before PhantomWalletAdapter was wired in (e.g. an
        ambient-detected MetaMask entry), which would keep reconnecting to
        it regardless of what's in the `wallets` array above. A dedicated
        key guarantees this app never reads a value written by an earlier,
        differently-configured version of itself.
      */}
      <WalletProvider
        wallets={wallets}
        autoConnect
        localStorageKey="webrush-wallet-name"
      >
        <WalletModalProvider>
          <div className="app-shell">
            {/* Hidden during splash -- pure branding moment, no
                interactive/identity elements per spec section D.1. */}
            {screen !== "splash" && <WalletCornerPill />}
            <GameFlow screen={screen} setScreen={setScreen} />
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
