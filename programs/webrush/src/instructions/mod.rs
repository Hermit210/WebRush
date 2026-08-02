pub mod cash_out;
pub mod delegate;
pub mod initialize_treasury;
pub mod start_run;
pub mod swing;

// Wildcard (not named) re-exports: the #[derive(Accounts)] macro on each
// struct below also generates a hidden `__client_accounts_*` module
// alongside it, and the `#[program]` macro's codegen expects that module
// reachable at the crate root (`crate::__client_accounts_start_run`, etc).
// A named `pub use start_run::StartRun;` would skip that hidden module and
// break the `#[program]` expansion with an "unresolved import `crate`"
// error -- see BUILD_PROMPT session notes / anchor-syn codegen/program/accounts.rs.
pub use cash_out::*;
pub use delegate::*;
pub use initialize_treasury::*;
pub use start_run::*;
pub use swing::*;
