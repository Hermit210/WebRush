use anchor_lang::prelude::*;

#[error_code]
pub enum WebRushError {
    #[msg("This player already has an active run in progress.")]
    RunAlreadyActive,
    #[msg("This run is not active (already cashed out, or missed).")]
    RunNotActive,
    #[msg("Maximum swing count reached; cash out instead of swinging again.")]
    MaxSwingsReached,
    #[msg("Treasury bankroll has insufficient funds to cover this payout.")]
    InsufficientBankroll,
}
