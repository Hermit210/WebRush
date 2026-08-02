import { useState } from "react";
import { useWebRushProgram } from "../hooks/useWebRushProgram";
import { ENTRY_FEE_LAMPORTS } from "../anchor/constants";

export function Lobby({ onStarted }: { onStarted: () => void }) {
  const ctx = useWebRushProgram();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
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

  if (!ctx) return null;

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

      <button className="btn-primary" onClick={handleStart} disabled={!!status} style={{ marginTop: 20 }}>
        {status ? "Starting..." : "Start Run"}
      </button>
    </div>
  );
}
