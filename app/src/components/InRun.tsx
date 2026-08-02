import { useEffect, useRef, useState } from "react";
import { useWebRushProgram } from "../hooks/useWebRushProgram";
import { useSound } from "../hooks/useSound";
import type { SessionHandle } from "../hooks/useSessionKey";
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
 * Auto-swing loop. If a session key is available (created in Lobby right
 * after start_run -- see App.tsx/useSessionKey.ts), each swing is signed
 * directly by the in-memory session Keypair with ZERO wallet popups -- this
 * is the actual fix for the "wallet prompt every ~2s" problem. Falls back
 * to the original direct-wallet-signed path (one popup per swing) if no
 * session is available, so the run still works either way rather than
 * silently failing.
 *
 * The 3D <Scene> below is a pure rendering swap over the old <Skyline>
 * canvas -- it reacts to the exact same swingIndex/phase data derived from
 * on-chain state here, no new game logic lives in the 3D layer itself.
 */
export function InRun({
  session,
  onFinished,
}: {
  session: SessionHandle | null;
  onFinished: (result: RunResult) => void;
}) {
  const ctx = useWebRushProgram();
  const playSound = useSound();
  const [swingIndex, setSwingIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<SwingPhase>("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      if (cancelled || finishedRef.current || !ctx) return;
      setBusy(true);
      setPhase("swinging");
      try {
        let sig: string;
        if (session) {
          // Session-signed path: no wallet popup. `run`'s PDA must be
          // passed explicitly -- its seeds are self-referential
          // (derived from run.player, not the signer) precisely so the
          // same Run account resolves whether the direct wallet or a
          // session key is doing the signing, which means Anchor's
          // client can no longer auto-derive it from context.
          // `as any`: Anchor's generated type for this instruction's
          // accounts object omits `run` entirely, on the (here, incorrect)
          // assumption that anything with a `pda` seed spec is always
          // auto-derivable client-side. That's not true for a
          // self-referential seed (run.player) -- it genuinely cannot be
          // computed without already knowing the value, so it must be
          // passed explicitly despite what the type says. Verified working
          // at runtime via tests/session-keys.ts, which does the same.
          const swingTx = await ctx.program.methods
            .swing()
            .accounts({
              player: session.sessionKeypair.publicKey,
              run: ctx.run,
              sessionToken: session.sessionTokenPda,
            } as any)
            .transaction();
          swingTx.feePayer = session.sessionKeypair.publicKey;
          swingTx.recentBlockhash = (
            await ctx.connection.getLatestBlockhash()
          ).blockhash;
          swingTx.sign(session.sessionKeypair);
          sig = await ctx.connection.sendRawTransaction(swingTx.serialize());
        } else {
          // Fallback: original direct-wallet path (one popup per swing).
          // `as any` for the same reason as the session path above.
          sig = await ctx.program.methods
            .swing()
            .accounts({ player: ctx.wallet.publicKey, run: ctx.run, sessionToken: null } as any)
            .rpc();
        }
        await ctx.connection.confirmTransaction(sig, "confirmed");
        const run = await ctx.program.account.run.fetch(ctx.run);
        const status = run.status as any;

        if (status.missed) {
          finishedRef.current = true;
          setSwingIndex(run.swingIndex);
          setPhase("missed");
          playSound("miss");
          setTimeout(() => {
            onFinished({ outcome: "missed", multiplier: multiplierAt(run.swingIndex) });
          }, MISS_ANIMATION_MS);
          return;
        }
        setSwingIndex(run.swingIndex);
        setPhase("idle");
        playSound("tick");
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
  }, [ctx, session]);

  async function handleCashOut() {
    if (!ctx || finishedRef.current) return;
    playSound("click");
    finishedRef.current = true;
    setStatusMsg("Confirming cash-out...");
    try {
      // cash_out is deliberately NOT session-aware -- cashing out always
      // requires the real wallet, by design (see README security model).
      const sig = await ctx.program.methods
        .cashOut()
        .accounts({ player: ctx.wallet.publicKey })
        .rpc();
      await ctx.connection.confirmTransaction(sig, "confirmed");
      setPhase("cashed_out");
      playSound("cashout");
      const payoutLamports = estimatedPayoutLamports(ENTRY_FEE_LAMPORTS, swingIndex);
      const multiplier = multiplierAt(swingIndex);
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
