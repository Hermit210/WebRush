import { useEffect, useRef, useState } from "react";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWebRushProgram } from "../hooks/useWebRushProgram";
import { useSound } from "../hooks/useSound";
import type { SessionHandle } from "../hooks/useSessionKey";
import { ENTRY_FEE_LAMPORTS } from "../anchor/constants";
import { withTimeout } from "../anchor/withTimeout";

// Bounds how long "Confirming transaction..."/"Setting up session..." can
// sit on screen -- previously nothing capped this, so a slow/rate-limited
// devnet RPC left the player staring at an indefinite spinner with no
// feedback. See README "Known rough edges" for the full story.
const TX_TIMEOUT_MS = 45000;

/**
 * Menu/home screen. Renders its branding and game info regardless of
 * wallet connection state -- a player can see everything here without
 * connecting anything (spec section D.1: "player can browse/preview
 * without connecting"). The wallet is only actually required at the exact
 * moment of clicking Play: if not yet connected, this opens the wallet
 * picker modal contextually (via useWalletModal, the same modal the
 * corner pill already uses) and automatically resumes start_run once the
 * connection completes -- no wallet-adapter/Anchor logic changed, just
 * when it gets invoked.
 */
export function Lobby({
  onStarted,
  createSession,
}: {
  onStarted: () => void;
  createSession: (wallet: NonNullable<ReturnType<typeof useAnchorWallet>>) => Promise<SessionHandle>;
}) {
  const { connected } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const ctx = useWebRushProgram();
  const playSound = useSound();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wantsToStartRef = useRef(false);

  async function actuallyStartRun() {
    if (!ctx || !anchorWallet) return;
    setError(null);
    try {
      setStatus("Confirming transaction...");
      // run / treasury / systemProgram are all PDA-or-constant accounts the
      // Anchor client resolves automatically from the IDL's seed info --
      // only the signer needs to be supplied explicitly.
      await withTimeout(
        ctx.program.methods.startRun().accounts({ player: ctx.wallet.publicKey }).rpc(),
        TX_TIMEOUT_MS,
        "start_run is taking too long to confirm. Devnet may be slow or unreachable right now -- please try again."
      );

      // One more wallet approval here creates the session key -- this is
      // what removes the wallet-popup-per-swing problem. Every swing after
      // this point is signed silently by the session key until cash-out.
      setStatus("Setting up session (one more approval)...");
      await withTimeout(
        createSession(anchorWallet),
        TX_TIMEOUT_MS,
        "Session setup is taking too long to confirm. Devnet may be slow or unreachable right now -- please try again."
      );

      onStarted();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setStatus(null);
    }
  }

  // If the player clicked Play before connecting, resume automatically the
  // moment a wallet becomes available -- they already expressed intent to
  // play, so don't make them click Play twice.
  useEffect(() => {
    if (wantsToStartRef.current && ctx) {
      wantsToStartRef.current = false;
      actuallyStartRun();
    }
  }, [ctx]);

  function handlePlayClick() {
    playSound("click");
    if (!connected) {
      wantsToStartRef.current = true;
      setVisible(true);
      return;
    }
    actuallyStartRun();
  }

  return (
    <div className="menu-overlay">
      <div className="menu-hud-panel">
        <h1 className="menu-title">WebRush</h1>
        <div className="menu-stats">
          <span>{(ENTRY_FEE_LAMPORTS / 1e9).toFixed(2)} SOL entry</span>
          <span className="menu-stats-divider">&middot;</span>
          <span>20.00x max</span>
        </div>
        {error && <div className="error-banner error-banner--compact">{error}</div>}
      </div>

      <div className="menu-play-dock">
        {status && (
          <div className="status-line status-line--compact">
            <span className="spinner" />
            {status}
          </div>
        )}
        <button className="btn-play-pill" onClick={handlePlayClick} disabled={!!status}>
          {status ? "Starting..." : "Play"}
        </button>
      </div>
    </div>
  );
}
