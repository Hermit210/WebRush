use anchor_lang::prelude::*;

use crate::constants::{MAX_SWING_INDEX, MISS_PROBABILITY_BPS, MULTIPLIER_TABLE_X100, RUN_SEED};
use crate::errors::WebRushError;
use crate::state::{Run, RunStatus};

#[derive(Accounts)]
pub struct Swing<'info> {
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [RUN_SEED, player.key().as_ref()],
        bump = run.bump,
        has_one = player,
    )]
    pub run: Account<'info, Run>,
}

#[event]
pub struct SwingResolved {
    pub player: Pubkey,
    pub swing_index: u8,
    pub success: bool,
    pub multiplier_x100: u64,
}

/// Resolves one swing attempt. This single instruction covers both the
/// "multiplier tick" and the "miss/forfeit" behavior described in the spec:
/// on a miss there is nothing left to transfer, because the player's stake
/// already moved into the shared Treasury bankroll back in start_run -- a
/// miss just marks the run Missed and leaves the stake where it is.
///
/// This is the instruction meant to be called repeatedly against the
/// ephemeral-rollup-delegated copy of the Run account during a session, so
/// each swing is a sub-50ms ER transaction rather than a base-layer one.
///
/// Randomness (MVP fallback, explicitly NOT full VRF -- see spec section
/// 3.1): an xorshift64 mix of run.seed, the player key, swing_index, and
/// the current slot, truncated to a 0-9999 roll compared against
/// MISS_PROBABILITY_BPS. The current slot isn't known until the swing
/// transaction actually lands, so the outcome can't be predicted or
/// replayed by the client ahead of time -- good enough for an MVP, but not
/// a certified VRF. To upgrade: swap in MagicBlock's VRF plugin
/// (`ephemeral_rollups_sdk::vrf`, request/callback pattern) as demonstrated
/// in magicblock-labs/magicblock-engine-examples/roll-dice
/// (roll-dice-delegated program) -- that example is a near-exact template
/// for this instruction.
pub fn swing_handler(ctx: Context<Swing>) -> Result<()> {
    let run = &mut ctx.accounts.run;
    require!(run.status == RunStatus::Active, WebRushError::RunNotActive);
    require!(
        run.swing_index < MAX_SWING_INDEX,
        WebRushError::MaxSwingsReached
    );

    let clock = Clock::get()?;
    let player_bytes = run.player.to_bytes();
    let mut x = run.seed
        ^ clock.slot
        ^ (run.swing_index as u64)
        ^ u64::from_le_bytes(player_bytes[0..8].try_into().unwrap());
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    let roll = (x % 10_000) as u16;
    let miss_threshold = MISS_PROBABILITY_BPS[run.swing_index as usize];

    if roll < miss_threshold {
        emit!(SwingResolved {
            player: run.player,
            swing_index: run.swing_index,
            success: false,
            multiplier_x100: MULTIPLIER_TABLE_X100[run.swing_index as usize],
        });
        run.status = RunStatus::Missed;
    } else {
        run.swing_index = run.swing_index.saturating_add(1).min(MAX_SWING_INDEX);
        emit!(SwingResolved {
            player: run.player,
            swing_index: run.swing_index,
            success: true,
            multiplier_x100: MULTIPLIER_TABLE_X100[run.swing_index as usize],
        });
    }

    Ok(())
}
