use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::constants::{MAX_SWING_INDEX, MISS_PROBABILITY_BPS, MULTIPLIER_TABLE_X100, RUN_SEED};
use crate::errors::WebRushError;
use crate::state::{Run, RunStatus};

/// `session_token` is a TRAILING optional account. A hand-built raw
/// instruction test (tests/session-keys-raw-compat.ts) proved Anchor's
/// on-chain `Option<Account>` deserialization (anchor-lang 1.1.2) rejects a
/// genuinely-shorter accounts list with `AccountNotEnoughKeys` rather than
/// treating the missing slot as `None` -- so this program could NOT have
/// been upgraded in place on the shared devnet deployment without breaking
/// every other branch's already-compiled `swing()` calls (they never send
/// this slot at all). That's why this program is deployed at its own
/// isolated address instead -- see README "Session keys" for the full
/// reasoning and the isolated program ID.
///
/// The `player` account keeps its original name (not renamed to `payer`
/// like the upstream session-keys reference example) purely for continuity
/// with the rest of this codebase's naming.
#[derive(Accounts, Session)]
pub struct Swing<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [RUN_SEED, run.player.as_ref()],
        bump = run.bump,
    )]
    pub run: Account<'info, Run>,

    /// CHECK: validated by the `session_auth_or` macro against `run.player`
    /// -- if present, its authority must match run.player and it must not
    /// be expired; if absent, `player` must equal `run.player` directly.
    #[session(signer = player, authority = run.player.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
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
/// Session-key aware (see Swing accounts struct doc comment above): a
/// player may call this directly with their real wallet (unchanged, original
/// behavior), OR via a scoped session key created once via
/// `@magicblock-labs/gum-sdk`'s `createSessionV2` -- this is what removes
/// the wallet-popup-per-swing problem. `cash_out` deliberately does NOT
/// accept a session token; cashing out always requires the real wallet, by
/// design, per the security model documented in the README.
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
#[session_auth_or(
    ctx.accounts.run.player.key() == ctx.accounts.player.key(),
    SessionError::InvalidToken
)]
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
