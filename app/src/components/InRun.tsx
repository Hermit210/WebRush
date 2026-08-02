import { useEffect, useRef, useState } from "react";
import { useWebRushProgram } from "../hooks/useWebRushProgram";
import { useSolsocketRoom } from "../hooks/useSolsocketRoom";
import {
  ENTRY_FEE_LAMPORTS,
  estimatedPayoutLamports,
  multiplierAt,
} from "../anchor/constants";
import { Scene } from "../three/Scene";
import type { SwingPhase } from "../three/SwingRig";

export type RunResult =
  | { outcome: "cashed_out"; payoutLamports: number; multiplier: number }
  | { outcome: "missed"; multiplier: number };

// Lets the fall/settle animation actually play before switching to the
// Result screen -- onFinished used to fire the instant the tx confirmed,
// which cut the 3D miss/cash-out animation off before it could be seen.
const MISS_ANIMATION_MS = 1600;
const CASHOUT_ANIMATION_MS = 1000;

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
 *
 * The 3D <Scene> below is a pure rendering swap over the old <Skyline>
 * canvas -- it reacts to the exact same swingIndex/phase data derived from
 * on-chain state here, no new game logic lives in the 3D layer itself.
 */
export function InRun({ onFinished }: { onFinished: (result: RunResult) => void }) {
  const ctx = useWebRushProgram();
  const social = useSolsocketRoom();
  const [swingIndex, setSwingIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<SwingPhase>("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>("Delegating to rollup...");
  const [error, setError] = useState<string | null>(null);
  const finishedRef = useRef(false);

  // Presence broadcast: fires whenever OUR displayed multiplier/status
  // changes rather than on a blind timer -- swings here only advance once
  // every ~2s (see the wallet-popup-per-swing note in the tick loop below),
  // so a 5-10Hz interval would just resend the same unchanged value most of
  // the time. Broadcasting on every real state change keeps other players'
  // view of us fresh without the wasted traffic.
  useEffect(() => {
    if (!social.ready) return;
    social.broadcast({
      multiplier: multiplierAt(swingIndex),
      status: phase,
    });
  }, [social.ready, swingIndex, phase]);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // NOTE: delegate_run is intentionally not called yet from the frontend --
    // it's verified working end-to-end against the real devnet ER via
    // scripts/test-er.ts, but wiring it into this UI (so swing() below runs
    // at ER speed instead of base layer) is still open, see README.
    setStatusMsg(null);

    async function tick() {
      if (cancelled || finishedRef.current || !ctx) return;
      setBusy(true);
      setPhase("swinging");
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
          setSwingIndex(run.swingIndex);
          setPhase("missed");
          social.emitEvent("miss", { atMultiplier: multiplierAt(run.swingIndex) });
          setTimeout(() => {
            onFinished({ outcome: "missed", multiplier: multiplierAt(run.swingIndex) });
          }, MISS_ANIMATION_MS);
          return;
        }
        setSwingIndex(run.swingIndex);
        setPhase("idle");
        if (!cancelled && !finishedRef.current) {
          timer = setTimeout(tick, 2000);
        }
      } catch (err: any) {
        setPhase("idle");
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
      setPhase("cashed_out");
      const payoutLamports = estimatedPayoutLamports(ENTRY_FEE_LAMPORTS, swingIndex);
      const multiplier = multiplierAt(swingIndex);
      social.emitEvent("cashout", { atMultiplier: multiplier });
      setTimeout(() => {
        onFinished({ outcome: "cashed_out", payoutLamports, multiplier });
      }, CASHOUT_ANIMATION_MS);
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
  const finished = phase === "missed" || phase === "cashed_out";

  return (
    <div className="game-stage">
      <div className="game-canvas">
        <Scene swingIndex={swingIndex} phase={phase} />
      </div>

      <div className="hud-overlay hud-top">
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
      </div>

      {social.players.length > 0 && (
        <div className="other-players-panel">
          <div className="other-players-title">In this room</div>
          {social.players.map((p) => (
            <div key={p.key} className="other-player-row">
              <span className="other-player-name">{p.short}</span>
              <span className="other-player-multiplier">{p.multiplier.toFixed(2)}x</span>
            </div>
          ))}
        </div>
      )}

      <div className="notification-stack">
        {social.notifications.map((n) => (
          <div key={n} className="notification-toast">
            {n}
          </div>
        ))}
      </div>

      <div className="hud-overlay hud-bottom">
        <button
          className="btn-cashout"
          onClick={handleCashOut}
          disabled={!!statusMsg || finished}
        >
          Cash Out
        </button>
        {busy && (
          <div className="status-line" style={{ justifyContent: "center" }}>
            <span className="spinner" />
            Swinging...
          </div>
        )}
      </div>
    </div>
  );
}
