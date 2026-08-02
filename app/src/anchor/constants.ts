// Mirrors programs/webrush/src/constants.rs. Keep these two files in sync --
// this file is display/UX-only (estimating payouts client-side before a tx
// confirms); the on-chain program is always the source of truth for money.

export const ENTRY_FEE_LAMPORTS = 10_000_000; // 0.01 SOL
export const MAX_SWING_INDEX = 20;

export const MULTIPLIER_TABLE_X100: number[] = [
  100, 130, 169, 220, 286, 372, 484, 629, 818, 1063, 1382, 1797, 2000, 2000,
  2000, 2000, 2000, 2000, 2000, 2000, 2000,
];

export const MISS_PROBABILITY_BPS: number[] = [
  0, 0, 0, 400, 800, 1200, 1600, 2000, 2400, 2800, 3200, 3600, 4000, 4400,
  4800, 5200, 5600, 6000, 6400, 6800, 7200,
];

export const CASHOUT_FEE_BPS = 200;

export const RUN_SEED = "run";
export const TREASURY_SEED = "treasury";

export function multiplierAt(swingIndex: number): number {
  return MULTIPLIER_TABLE_X100[swingIndex] / 100;
}

export function estimatedPayoutLamports(
  stakeLamports: number,
  swingIndex: number
): number {
  const gross = (stakeLamports * MULTIPLIER_TABLE_X100[swingIndex]) / 100;
  const fee = (gross * CASHOUT_FEE_BPS) / 10_000;
  return Math.floor(gross - fee);
}
