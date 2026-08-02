use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

pub use instructions::*;

// Separate program ID from the shared devnet deployment used by every
// other branch -- deliberate isolation, not an oversight. A raw-instruction
// test (tests/session-keys-raw-compat.ts) proved that upgrading the shared
// program in place would have broken every other branch's existing
// swing() calls (anchor-lang 1.1.2's Option<Account> handling requires the
// trailing account slot to be present, even as a placeholder -- an old
// client that doesn't know sessionToken exists can never supply that, and
// hits AccountNotEnoughKeys). See README "Session keys" for the full story.
declare_id!("D2Jk64MauFmg8GhWoe7C2AqLFdQqjTayb5iy2hqrsBFS");

/// `#[ephemeral]` wires up the undelegation callback handling this program
/// needs to be usable from a MagicBlock Ephemeral Rollup (required for
/// Solana Blitz v7 prize eligibility -- see BUILD_PROMPT section 1).
#[ephemeral]
#[program]
pub mod webrush {
    use super::*;

    /// One-time: create the shared Treasury bankroll PDA. Fund it with a
    /// plain SOL transfer afterward (see README) before demoing.
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        instructions::initialize_treasury::initialize_treasury_handler(ctx)
    }

    /// Pay the entry fee and open (or reopen) this player's Run.
    pub fn start_run(ctx: Context<StartRun>) -> Result<()> {
        instructions::start_run::start_run_handler(ctx)
    }

    /// Resolve one swing attempt: advances the multiplier on success, or
    /// forfeits the run on a miss. Meant to be called against the
    /// ER-delegated copy of the Run account during an active session.
    pub fn swing(ctx: Context<Swing>) -> Result<()> {
        instructions::swing::swing_handler(ctx)
    }

    /// Lock in the current multiplier and pay out from the Treasury.
    pub fn cash_out(ctx: Context<CashOut>) -> Result<()> {
        instructions::cash_out::cash_out_handler(ctx)
    }

    /// Delegate this player's Run PDA to the ephemeral rollup. Call once,
    /// right after start_run, before the first swing.
    pub fn delegate_run(ctx: Context<DelegateRun>) -> Result<()> {
        instructions::delegate::delegate_handler(ctx)
    }

    /// Commit final Run state back to base layer and undelegate. Call after
    /// cash_out or a miss, before the player's next start_run.
    pub fn undelegate_run(ctx: Context<UndelegateRun>) -> Result<()> {
        instructions::delegate::undelegate_handler(ctx)
    }
}
