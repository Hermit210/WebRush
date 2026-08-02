import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWebRushProgram } from "../hooks/useWebRushProgram";
import { useSound } from "../hooks/useSound";
import { ENTRY_FEE_LAMPORTS } from "../anchor/constants";

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
export function Lobby({ onStarted }: { onStarted: () => void }) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const ctx = useWebRushProgram();
  const playSound = useSound();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wantsToStartRef = useRef(false);

  async function actuallyStartRun() {
    if (!ctx) return;
    setError(null);
    try {
      setStatus("Confirming transaction...");
      // run / treasury / systemProgram are all PDA-or-constant accounts the
      // Anchor client resolves automatically from the IDL's seed info --
      // only the signer needs to be supplied explicitly.
      await ctx.program.methods
        .startRun()
        .accounts({ player: ctx.wallet.publicKey })
        .rpc();
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
    <div className="card">
      <h1>WebRush</h1>
      <p className="subtitle">Swing, climb the multiplier, cash out before you miss.</p>

      {error && <div className="error-banner">{error}</div>}

      <div className="row">
        <span className="muted">Entry fee</span>
        <span>{(ENTRY_FEE_LAMPORTS / 1e9).toFixed(2)} SOL</span>
      </div>
      <div className="row">
        <span className="muted">Max multiplier</span>
        <span>20.00x</span>
      </div>

      {status && (
        <div className="status-line">
          <span className="spinner" />
          {status}
        </div>
      )}

      <button className="btn-primary" onClick={handlePlayClick} disabled={!!status} style={{ marginTop: 20 }}>
        {status ? "Starting..." : "Play"}
      </button>
    </div>
  );
}
