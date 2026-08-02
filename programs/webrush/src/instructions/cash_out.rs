use anchor_lang::prelude::*;

use crate::constants::{CASHOUT_FEE_BPS, MULTIPLIER_TABLE_X100, RUN_SEED, TREASURY_SEED};
use crate::errors::WebRushError;
use crate::state::{Run, RunStatus, Treasury};

#[derive(Accounts)]
pub struct CashOut<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [RUN_SEED, player.key().as_ref()],
        bump = run.bump,
        has_one = player,
    )]
    pub run: Account<'info, Run>,

    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,
}

/// Locks in the run's current multiplier and pays the player out of the
/// shared Treasury bankroll (see start_run.rs for why the pot, not the Run
/// PDA, holds the money). Takes a 2% fee that stays in the Treasury.
///
/// Both `treasury` and the player wallet are accounts in this same
/// transaction, so the payout is a direct lamport debit/credit rather than
/// a System Program CPI: a program may always credit lamports to any
/// account, and may debit lamports only from accounts it owns -- the
/// Treasury PDA is owned by this program, so this is a legal, CPI-free
/// transfer.
pub fn cash_out_handler(ctx: Context<CashOut>) -> Result<()> {
    require!(
        ctx.accounts.run.status == RunStatus::Active,
        WebRushError::RunNotActive
    );

    let multiplier_x100 = MULTIPLIER_TABLE_X100[ctx.accounts.run.swing_index as usize];
    let gross_payout = (ctx.accounts.run.stake_lamports as u128)
        .checked_mul(multiplier_x100 as u128)
        .unwrap()
        / 100;
    let fee = gross_payout * CASHOUT_FEE_BPS as u128 / 10_000;
    let net_payout = (gross_payout - fee) as u64;

    let treasury_info = ctx.accounts.treasury.to_account_info();
    let rent_exempt_minimum = Rent::get()?.minimum_balance(treasury_info.data_len());
    require!(
        treasury_info.lamports().saturating_sub(rent_exempt_minimum) >= net_payout,
        WebRushError::InsufficientBankroll
    );

    **treasury_info.try_borrow_mut_lamports()? -= net_payout;
    **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += net_payout;

    ctx.accounts.treasury.total_paid_out_lamports = ctx
        .accounts
        .treasury
        .total_paid_out_lamports
        .saturating_add(net_payout);
    ctx.accounts.run.status = RunStatus::CashedOut;

    Ok(())
}
