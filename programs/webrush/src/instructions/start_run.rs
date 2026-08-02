use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::{ENTRY_FEE_LAMPORTS, RUN_SEED, TREASURY_SEED};
use crate::errors::WebRushError;
use crate::state::{Run, RunStatus, Treasury};

#[derive(Accounts)]
pub struct StartRun<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// One Run PDA per player, reused across sessions. Reuse avoids paying
    /// rent again on every run and gives the account a stable address to
    /// delegate to the ephemeral rollup each session.
    #[account(
        init_if_needed,
        payer = player,
        space = Run::SPACE,
        seeds = [RUN_SEED, player.key().as_ref()],
        bump,
    )]
    pub run: Account<'info, Run>,

    /// The entry fee is transferred straight into the shared Treasury
    /// bankroll rather than staying in the Run PDA. A single pool is what
    /// funds cash-out payouts larger than any one player's own stake
    /// (classic rising-multiplier / crash-game economics) -- see
    /// instructions/cash_out.rs for the payout side of this.
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

pub fn start_run_handler(ctx: Context<StartRun>) -> Result<()> {
    require!(
        ctx.accounts.run.status != RunStatus::Active,
        WebRushError::RunAlreadyActive
    );

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        ),
        ENTRY_FEE_LAMPORTS,
    )?;
    ctx.accounts.treasury.total_deposited_lamports = ctx
        .accounts
        .treasury
        .total_deposited_lamports
        .saturating_add(ENTRY_FEE_LAMPORTS);

    let run = &mut ctx.accounts.run;
    run.player = ctx.accounts.player.key();
    run.stake_lamports = ENTRY_FEE_LAMPORTS;
    run.swing_index = 0;
    run.status = RunStatus::Active;
    // MVP randomness seed: the slot this run started on, combined with a
    // fresh slot on every swing() call. NOT full VRF -- documented fallback,
    // see swing::handler for the upgrade path.
    run.seed = Clock::get()?.slot;
    run.bump = ctx.bumps.run;

    Ok(())
}
