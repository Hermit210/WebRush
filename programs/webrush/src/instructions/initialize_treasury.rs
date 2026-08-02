use anchor_lang::prelude::*;

use crate::constants::TREASURY_SEED;
use crate::state::Treasury;

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Treasury::SPACE,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

/// One-time setup, callable by anyone (it's a plain `init`, so it can only
/// ever succeed once -- there's nothing to grief). After this, fund the
/// bankroll with a normal SOL transfer to the treasury PDA address printed
/// by the deploy script (see README) before running a demo, since cash-out
/// payouts are paid out of this pool.
pub fn initialize_treasury_handler(ctx: Context<InitializeTreasury>) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;
    treasury.bump = ctx.bumps.treasury;
    treasury.total_deposited_lamports = 0;
    treasury.total_paid_out_lamports = 0;
    Ok(())
}
