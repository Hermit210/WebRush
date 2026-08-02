use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::RUN_SEED;
use crate::state::Run;

/// Delegates a player's Run PDA to the ephemeral rollup so swing() calls
/// during the session land on the ER (~sub-50ms, no base-layer fee per
/// tick) instead of Solana base layer. Call once, right after start_run,
/// before the first swing. Follows the exact pattern verified against
/// magicblock-labs/magicblock-engine-examples (counter/anchor, public-counter
/// program): the `#[delegate]` macro on this Accounts struct plus
/// `#[account(mut, del, ...)]` on the PDA field generates a
/// `delegate_<field_name>` method used in the handler below.
#[delegate]
#[derive(Accounts)]
pub struct DelegateRun<'info> {
    pub payer: Signer<'info>,
    /// CHECK: the PDA being delegated; ownership transfer is validated by
    /// the delegation program itself.
    #[account(mut, del, seeds = [RUN_SEED, payer.key().as_ref()], bump)]
    pub run: UncheckedAccount<'info>,
}

pub fn delegate_handler(ctx: Context<DelegateRun>) -> Result<()> {
    ctx.accounts.delegate_run(
        &ctx.accounts.payer,
        &[RUN_SEED, ctx.accounts.payer.key().as_ref()],
        DelegateConfig {
            // Optionally pin a specific ER validator, passed as the first
            // remaining account (see docs.magicblock.gg local-setup guide).
            validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
            ..Default::default()
        },
    )?;
    Ok(())
}

/// Commits the final Run state back to Solana base layer and returns
/// ownership to this program, so start_run can reuse the same PDA for the
/// player's next session. Call this right after cash_out or a miss.
#[commit]
#[derive(Accounts)]
pub struct UndelegateRun<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [RUN_SEED, payer.key().as_ref()], bump = run.bump)]
    pub run: Account<'info, Run>,
}

pub fn undelegate_handler(ctx: Context<UndelegateRun>) -> Result<()> {
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.run.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}
