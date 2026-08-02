/// Single source of truth for every game-balance number. Referenced from
/// instructions instead of being re-hardcoded, so tuning the game later is a
/// one-file edit + redeploy. See BUILD_PROMPT section 2.2 for the design
/// rationale behind each curve.

/// Entry fee to start a run, in lamports. Default 0.01 SOL (devnet).
pub const ENTRY_FEE_LAMPORTS: u64 = 10_000_000;

/// Number of discrete swing steps modeled (index 0..=MAX_SWING_INDEX).
/// Index 0 = pre-swing, locked-in multiplier 1.00x.
pub const MAX_SWING_INDEX: u8 = 20;

/// Multiplier at each swing_index, in hundredths (100 = 1.00x). Grows ~1.3x
/// per successful swing, matching the spec's example curve
/// (1.0 -> 1.3 -> 1.7 -> 2.2 -> 2.9 -> 3.8 -> 5.0 ...), hard-capped at
/// 20.00x from index 12 onward to avoid unbounded-payout edge cases.
pub const MULTIPLIER_TABLE_X100: [u64; 21] = [
    100, 130, 169, 220, 286, 372, 484, 629, 818, 1063, 1382, 1797, 2000, 2000, 2000, 2000, 2000,
    2000, 2000, 2000, 2000,
];

/// Miss probability at each swing_index, in basis points (10_000 = 100%).
/// Near-zero for the first 2-3 swings, then rises ~4pp per step, so early
/// swings feel safe and late swings feel risky (the greed-vs-fear tension
/// the spec asks for). A pure tuning knob -- adjust freely during
/// playtesting.
pub const MISS_PROBABILITY_BPS: [u16; 21] = [
    0, 0, 0, 400, 800, 1200, 1600, 2000, 2400, 2800, 3200, 3600, 4000, 4400, 4800, 5200, 5600,
    6000, 6400, 6800, 7200,
];

/// Fee taken out of a successful cash-out payout, in basis points (2%).
/// The fee stays in the Treasury bankroll (see instructions/cash_out.rs).
pub const CASHOUT_FEE_BPS: u16 = 200;

pub const RUN_SEED: &[u8] = b"run";
pub const TREASURY_SEED: &[u8] = b"treasury";
