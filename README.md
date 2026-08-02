# WebRush

A web-swinging rising-multiplier cash-out game for **Solana Blitz v7** (MagicBlock hackathon). Original character/art direction only — no Marvel IP.

Core loop: pay a small entry fee, swing building to building while the multiplier climbs, cash out whenever you want — or miss a swing and lose your stake. See `BUILD_PROMPT.md` (the original spec pasted into this session) for full design rationale, honesty guardrails, and the day-by-day build order this project follows.

## Status

- [x] Anchor program: entry-fee escrow, multiplier ticks, cash-out, miss/forfeit — **built and passing 7/7 localnet tests**
- [x] Devnet deploy, live: program `8o3RF97HDqRQ7jVEviaYDmiMnGVCwck22XeezGwkYNnU`, Treasury bankroll initialized and funded
- [x] MagicBlock Ephemeral Rollup delegation — **verified end-to-end against the real hosted devnet ER** (`devnet-us.magicblock.app`), not just compile-checked. See "Testing ER delegation" below.
- [x] Frontend scaffold: wallet connect → lobby → in-run → result, wired to the real IDL, Phantom/Solflare explicitly configured
- [ ] Calling `delegate_run`/`undelegate_run` from the frontend itself (currently only exercised via `scripts/test-er.ts`; the running app still calls `swing` against base layer directly)
- [ ] Shared-multiplier collaboration mode / `solsocket` integration (stretch goal, only after solo mode is rock solid)

## Project layout

```
programs/webrush/src/
  lib.rs                 -- program entrypoint, #[ephemeral] + #[program] mod
  constants.rs            -- every tunable number (entry fee, multiplier table, miss curve, fees)
  state.rs                 -- Run + Treasury account structs
  errors.rs
  instructions/
    initialize_treasury.rs -- one-time: creates the shared house bankroll PDA
    start_run.rs            -- pay entry fee, open/reopen a player's Run
    swing.rs                 -- resolve one swing attempt (success or miss/forfeit)
    cash_out.rs              -- lock in multiplier, pay out of the Treasury
    delegate.rs               -- delegate_run / undelegate_run (MagicBlock ER)
tests/webrush.ts           -- localnet mocha test suite (the source of truth for expected behavior)
scripts/bootstrap.ts        -- one-time treasury init + bankroll funding, any cluster
scripts/test-er.ts           -- real end-to-end ER delegation test against devnet (not a compile check)
app/                          -- React + Vite frontend
```

## Design decisions worth knowing before you touch this code

**One Run PDA per player, reused across sessions.** Seeds are `["run", player]`, not a per-session nonce. This keeps a stable address to delegate to the ephemeral rollup every session, and avoids paying rent again on every run. `start_run` uses `init_if_needed` and manually resets fields; see the `RunStatus::Uninitialized` doc comment in `state.rs` for why that enum's variant order matters (a fresh zeroed account must not decode as `Active`).

**Treasury is a single shared house bankroll, not per-run escrow.** The entry fee goes straight into the Treasury PDA in `start_run`; `cash_out` pays out of that same pool. This is what lets a payout (up to 20x stake) exceed any single player's own stake — classic crash-game economics. It also means the Treasury **must be pre-funded** before a demo (see below) or early cash-outs will hit `InsufficientBankroll`.

**Randomness is a documented MVP fallback, not VRF.** `swing.rs` mixes `run.seed`, the player key, `swing_index`, and the current slot with a cheap xorshift, compared against `MISS_PROBABILITY_BPS`. This is unpredictable to the client ahead of time (the slot isn't known until the transaction lands) but is explicitly **not** a certified VRF — see the spec's own honesty guardrails on this point. The upgrade path is real and verified: `magicblock-labs/magicblock-engine-examples/roll-dice` (the `roll-dice-delegated` program) is a near-exact template using `ephemeral_rollups_sdk::vrf` request/callback instructions.

**`swing` covers both "multiplier tick" and "miss/forfeit" from the spec in one instruction.** A miss needs zero fund movement (the stake already sits in the Treasury from `start_run`), so a separate forfeit instruction would have nothing to do — `swing` just flips the run's status to `Missed`.

## Prerequisites

Run everything through **WSL Ubuntu**, not native Windows/PowerShell — the Solana/Anchor toolchain is Linux-native. This session used:

- `solana-cli 1.18.26`
- `anchor-cli 1.1.2` via `avm` (see note below — `anchor-lang` resolved to `1.1.2`, newer than the `1.0.2` this was originally pinned to; both anchor-cli and the crate need to be on the same 1.x line)
- Node `v24.11.1`, npm

If `anchor --version` shows something older (e.g. a directly `cargo install`'d binary shadowing avm), make sure `~/.avm/bin` comes **before** `~/.cargo/bin` on `PATH`, or just run anchor commands with:

```bash
export PATH="$HOME/.avm/bin:$PATH"
```

## Setup

```bash
# from the repo root
npm install
cd app && npm install && cd ..
```

## Running the localnet test suite

```bash
anchor test
```

This builds the program, spins up `solana-test-validator`, deploys, and runs `tests/webrush.ts` (7 tests: treasury init, escrow, guard against double-`start_run`, three guaranteed-safe swings, cash-out payout math, guard against acting on a finished run, and starting a fresh run afterward). `Anchor.toml`'s `[provider] cluster` is set to `localnet` for this — **don't** point it at devnet for routine iteration, or every test run spends real devnet SOL on a fresh deploy.

## Deploying to devnet

1. Make sure your devnet wallet has enough SOL (program deploys cost a few SOL in rent for the executable account): `solana balance`, top up via `solana airdrop 2` or https://faucet.solana.com if the CLI airdrop is rate-limited.
2. Switch `Anchor.toml`'s `[provider] cluster` to `"devnet"`.
3. `anchor build && anchor deploy`
4. Bootstrap the treasury (one-time per deploy):
   ```bash
   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
   ANCHOR_WALLET=~/.config/solana/id.json \
   npx ts-node scripts/bootstrap.ts 2   # seeds the bankroll with 2 SOL
   ```
5. Copy the IDL into the frontend: `cp target/idl/webrush.json app/src/anchor/webrush.json`
6. Copy `app/.env.example` to `app/.env` and confirm `VITE_PROGRAM_ID` matches `Anchor.toml`.

The program ID currently checked in (`8o3RF97HDqRQ7jVEviaYDmiMnGVCwck22XeezGwkYNnU`, keypair at `target/deploy/webrush-keypair.json`) is a real generated keypair, not a placeholder — `declare_id!` in `lib.rs` and both `[programs.*]` entries in `Anchor.toml` already match it, so no `anchor keys sync` dance is needed unless you regenerate the keypair.

## Wiring the frontend to the program

```bash
cd app
npm run dev
```

The frontend reads the IDL from `app/src/anchor/webrush.json`, which is already the real one generated by this session's `anchor build` (typed against `target/types/webrush.ts`, so `program.methods.startRun()` / `program.account.run.fetch()` etc. are compile-time checked, not `any`). Re-copy it any time the program changes (step 5 above).

`app/package.json` pins `@types/react`/`@types/react-dom` to `18.2.79`/`18.2.25` rather than latest 18.3.x -- a known incompatibility between recent `@types/react` 18.3.x patch releases and `@solana/wallet-adapter-react`'s component typings otherwise breaks the build (`ConnectionProvider cannot be used as a JSX component`).

**Verified so far**: `npm run build` (full `tsc -b` type-check + `vite build`) passes clean, and `npm run dev` boots the Vite server. **Not yet verified**: actually clicking through the connect → lobby → in-run → cash-out flow in a real browser against a live wallet -- that's the natural next step before calling the solo loop demo-ready.

## Testing ER delegation

**Verified working end-to-end against MagicBlock's real hosted devnet ER** — not a compile check. `scripts/test-er.ts` runs the full round trip against the live program:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node scripts/test-er.ts
```

It does, against real infrastructure: `start_run` (base layer) → `delegate_run` (base layer, targeting the US ER validator `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd`) → confirms the Run PDA's on-chain **owner actually changed** to the delegation program (`DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`) → three real `swing` calls sent to `https://devnet-us.magicblock.app` (the ER's RPC) → `undelegate_run` (called against the ER connection, which commits final state back and hands ownership back to our program) → confirms ownership **reverted** to our program on base layer → `cash_out` on base layer using the ER-produced final state.

No local validator needed — MagicBlock hosts public devnet ER endpoints per region:

| Region | RPC | WS | Validator pubkey |
|---|---|---|---|
| US | `https://devnet-us.magicblock.app` | `wss://devnet-us.magicblock.app` | `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd` |
| EU | `https://devnet-eu.magicblock.app` | `wss://devnet-eu.magicblock.app` | `MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e` |
| Asia | `https://devnet-as.magicblock.app` | `wss://devnet-as.magicblock.app` | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |

There's also a Magic Router (`https://devnet-router.magicblock.app`) that auto-routes a transaction to either the ER or base layer based on account ownership, if you'd rather not manage two separate connections manually.

**Note on the swing round-trip times** (~1.7–2.7s each in the test output): that's Anchor's client-side confirmation-polling overhead for this shell talking to the ER over the network, not the ER's own internal block time (MagicBlock advertises ~10ms internal blocks) — don't read those numbers as "the ER isn't actually fast."

**Not yet done**: the frontend itself still calls `swing` directly against base layer (see `InRun.tsx`) rather than delegating first — wiring `delegate_run`/`undelegate_run` into the actual UI flow is the next step to get real ER speed in the live app, not just in this test script.

## Known rough edges / next steps

- **Wallet-popup-per-swing**: `InRun.tsx`'s auto-swing loop currently signs each `swing()` call with the connected wallet on a ~2s timer, which means a wallet prompt every swing. Fine for a scaffold, bad for a live demo. The fix is a per-session burner keypair authorized to sign swings on the player's behalf once delegated to the ER — see `magicblock-engine-examples/session-keys` for the pattern, or reuse `solsocket`'s auto-managed session key if the collaboration/multiplayer layer gets built.
- **No admin withdrawal instruction** for the Treasury — fine for a hackathon demo, but a real deployment would want one.
- **Multiplier plateau above swing_index 12**: the table caps at 20x from index 12 onward while miss probability keeps climbing, so swinging past that point is pure downside. The frontend should nudge players to cash out once capped (not yet implemented — currently just tints the multiplier red past index 6 as an early warning).
