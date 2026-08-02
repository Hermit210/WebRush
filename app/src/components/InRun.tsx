import { useEffect, useRef, useState } from "react";
import { useWebRushProgram } from "../hooks/useWebRushProgram";
import {
  ENTRY_FEE_LAMPORTS,
  estimatedPayoutLamports,
  multiplierAt,
} from "../anchor/constants";
import { Skyline } from "./Skyline";

export type RunResult =
  | { outcome: "cashed_out"; payoutLamports: number; multiplier: number }
  | { outcome: "missed"; multiplier: number };

/**
 * Auto-swing loop: calls the on-chain `swing` instruction on an interval
 * while the run is active, and lets the player cash out at any time. Each
 * swing here is a normal wallet-signed transaction, which in practice means
 * a wallet prompt every ~2s -- acceptable for a devnet demo, but the
 * intended fix once the run is delegated to an ephemeral rollup (spec
 * section 3.2 / build order day 2-3) is a per-session burner keypair so
 * only start_run/cash_out need the player's real wallet, matching the
 * "session key" pattern in magicblock-engine-examples/session-keys and
 * used by solsocket for its zero-fee presence writes.
 */
export function InRun({ onFinished }: { onFinished: (result: RunResult) => void }) {
  const ctx = useWebRushProgram();
  const [swingIndex, setSwingIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>("Delegating to rollup...");
  const [error, setError] = useState<string | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // NOTE: delegate_run is intentionally not called yet in this scaffold --
    // it requires an ephemeral-rollup validator endpoint to be wired up
    // (see README "Testing ER delegation"). swing() below still works fine
    // called directly against base layer while that's pending; it's just
    // not yet running at ER speed.
    setStatusMsg(null);

    async function tick() {
      if (cancelled || finishedRef.current || !ctx) return;
      setBusy(true);
      try {
        const sig = await ctx.program.methods
          .swing()
          .accounts({ player: ctx.wallet.publicKey })
          .rpc();
        await ctx.connection.confirmTransaction(sig, "confirmed");
        const run = await ctx.program.account.run.fetch(ctx.run);
        const status = run.status as any;

        if (status.missed) {
          finishedRef.current = true;
          onFinished({ outcome: "missed", multiplier: multiplierAt(run.swingIndex) });
          return;
        }
        setSwingIndex(run.swingIndex);
        if (!cancelled && !finishedRef.current) {
          timer = setTimeout(tick, 2000);
        }
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        setBusy(false);
      }
    }

    timer = setTimeout(tick, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ctx]);

  async function handleCashOut() {
    if (!ctx || finishedRef.current) return;
    finishedRef.current = true;
    setStatusMsg("Confirming cash-out...");
    try {
      const sig = await ctx.program.methods
        .cashOut()
        .accounts({ player: ctx.wallet.publicKey })
        .rpc();
      await ctx.connection.confirmTransaction(sig, "confirmed");
      onFinished({
        outcome: "cashed_out",
        payoutLamports: estimatedPayoutLamports(ENTRY_FEE_LAMPORTS, swingIndex),
        multiplier: multiplierAt(swingIndex),
      });
    } catch (err: any) {
      finishedRef.current = false;
      setError(err?.message ?? String(err));
    } finally {
      setStatusMsg(null);
    }
  }

  if (!ctx) return null;
  const multiplier = multiplierAt(swingIndex);
  const payout = estimatedPayoutLamports(ENTRY_FEE_LAMPORTS, swingIndex);
  const risky = swingIndex >= 6;

  return (
    <div className="card">
      <Skyline swingIndex={swingIndex} falling={false} />

      {error && <div className="error-banner">{error}</div>}
      {statusMsg && (
        <div className="status-line">
          <span className="spinner" />
          {statusMsg}
        </div>
      )}

      <p className={`multiplier ${risky ? "danger" : "growing"}`}>
        {multiplier.toFixed(2)}x
      </p>
      <p className="payout-preview">
        Cash out now for ~{(payout / 1e9).toFixed(4)} SOL
      </p>

      <button className="btn-cashout" onClick={handleCashOut} disabled={!!statusMsg}>
        Cash Out
      </button>
      {busy && (
        <div className="status-line" style={{ justifyContent: "center" }}>
          <span className="spinner" />
          Swinging...
        </div>
      )}
    </div>
  );
}
