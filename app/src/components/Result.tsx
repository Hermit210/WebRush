import type { RunResult } from "./InRun";

export function Result({
  result,
  onPlayAgain,
}: {
  result: RunResult;
  onPlayAgain: () => void;
}) {
  const won = result.outcome === "cashed_out";

  return (
    <div className="card">
      <h1>{won ? "Cashed Out!" : "You Missed"}</h1>
      <p className="subtitle">
        {won
          ? `Locked in at ${result.multiplier.toFixed(2)}x`
          : `Fell at ${result.multiplier.toFixed(2)}x -- stake forfeited to the pot`}
      </p>

      <p className={`result-amount ${won ? "win" : "loss"}`}>
        {won ? `+${(result.payoutLamports / 1e9).toFixed(4)} SOL` : "-0.01 SOL"}
      </p>

      <button className="btn-primary" onClick={onPlayAgain} style={{ marginTop: 16 }}>
        Play Again
      </button>
    </div>
  );
}
