use anchor_lang::prelude::*;

/// Shared house bankroll. Every entry fee (start_run) flows in here, every
/// cash-out payout flows out of here. A single pool is what lets a player's
/// payout exceed their own stake -- see instructions/start_run.rs for the
/// full rationale. Must be pre-funded with a plain SOL transfer before a
/// demo (see README) or early cash-outs can hit InsufficientBankroll.
#[account]
pub struct Treasury {
    pub bump: u8,
    pub total_deposited_lamports: u64,
    pub total_paid_out_lamports: u64,
}

impl Treasury {
    pub const SPACE: usize = 8 + 1 + 8 + 8;
}

/// NOTE: `Uninitialized` is deliberately variant 0. Anchor's `init_if_needed`
/// deserializes a brand-new (all-zero) account through this same enum before
/// the handler body runs, so if `Active` were variant 0 every fresh account
/// would look "already active" and start_run would reject its own first
/// call. Keep `Uninitialized` first.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RunStatus {
    Uninitialized,
    Active,
    CashedOut,
    Missed,
}

/// One Run PDA per player (seeds = [RUN_SEED, player]), reused across
/// sessions via init_if_needed in start_run. Reuse means the address is
/// stable, which matters for ephemeral-rollup delegation: the same PDA gets
/// delegated at the start of every session and undelegated at the end.
#[account]
pub struct Run {
    pub player: Pubkey,
    pub stake_lamports: u64,
    /// Number of successful swings so far; also the index into
    /// MULTIPLIER_TABLE_X100 / MISS_PROBABILITY_BPS.
    pub swing_index: u8,
    pub status: RunStatus,
    /// MVP randomness seed (slot at start_run). Combined with per-swing
    /// slot + index in instructions/swing.rs. NOT full VRF -- see the doc
    /// comment on swing::handler for the documented upgrade path.
    pub seed: u64,
    pub bump: u8,
}

impl Run {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + 1 + 8 + 1;
}
