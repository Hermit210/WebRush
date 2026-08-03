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

## 3D visual layer (branch: `3d-upgrade`)

**This is a separate, larger-scope track on top of the working 2D MVP, not a replacement for it.** `main` stays exactly as the flat-canvas 2D version (the safe fallback submission); all of this lives on `3d-upgrade` only. Per the honesty note this track started from: this is the closest realistic real-time approximation of a cinematic reference video buildable solo with free assets — moody neon city, animated character, bloom glow — not a pixel-match to a pre-rendered AI cinematic.

**Stack:** Three.js via React Three Fiber. Pinned to the React-18-compatible major versions (`@react-three/fiber@^8`, `@react-three/drei@^9`, `@react-three/postprocessing@^2`) — the current `@react-three/fiber@9` line requires React 19, which would conflict with the React 18 pin already in place for wallet-adapter compatibility (see "Wiring the frontend to the program" above).

**Character:** Mixamo and Ready Player Me both require an interactive account/export flow (signup, in-browser character creation, manual download) that can't be automated in an agentic session — so this uses `RobotExpressive.glb`, a real rigged glTF with 14 baked animation clips (verified by parsing the file's embedded JSON directly, not assumed: `Dance, Death, Idle, Jump, No, Punch, Running, Sitting, Standing, ThumbsUp, Walking, WalkJump, Wave, Yes`), sourced directly from three.js's own official examples repo. **License: CC0 1.0** (public domain, no attribution required) — see `app/public/models/RobotExpressive-LICENSE.txt`. Recolored in-engine (`app/src/three/Character.tsx`) to the existing brand palette: dark navy body, emissive cyan trim on the "Main" material, magenta accent on "Grey". Swapping in a real Mixamo/RPM export later just means replacing the model file and re-verifying clip names the same way (`node -e` snippet parsing the glb's JSON chunk, see git history) — `SwingRig.tsx` only needs `"Idle"`/`"Jump"`/`"WalkJump"` to exist.

**City:** procedural `BoxGeometry` towers (`app/src/three/cityLayout.ts` + `City.tsx`), not a hand-modeled asset pack, per the spec's own "don't hunt for the perfect kit" guidance. Layout is a seeded deterministic PRNG so the same file also derives swing anchor points (`getAnchorPoint`), keeping the city and the swing path in sync without needing to measure rendered meshes at runtime.

**Swing motion:** scripted quadratic-Bezier arc between two anchor points (`SwingRig.tsx`), driven by `useFrame` + `smoothstep` easing — explicitly not a physics simulation, matching spec section 6. Plays the `Jump` clip across the arc so the character reads as swinging even though the actual motion is a curve, not a simulated rope.

**Lighting/neon look:** dark navy ambient + one dim directional light + `@react-three/postprocessing`'s `Bloom` (the piece doing most of the work) plus subtle `ChromaticAberration`/`Vignette`. Real-time shadows are off entirely (`shadows={false}`); depth comes from fog + emissive glow instead, per the perf guardrail in spec section 9.

**Camera:** fixed third-person chase cam (`ChaseCamera.tsx`), lerped toward an offset from the character's position every frame, not `OrbitControls` — a fixed chase cam reads as gameplay, an orbit cam reads as a viewer/demo tool.

**UI:** the exact same HTML/CSS multiplier readout, cash-out button, and status messages as the 2D version, now absolutely-positioned over the `<Canvas>` as a semi-transparent gradient-backed overlay (`.game-stage`/`.hud-overlay` in `styles.css`) instead of an opaque card — no 3D in-scene text, per spec section 8.

**What's actually verified, and how** (this matters — see the general project philosophy of not claiming success without seeing it work): this sandbox has no GPU passthrough and no root access, so the usual "just open a browser" and "just `playwright install --with-deps`" paths were both blocked. Rather than stop at "type-checks, can't confirm it renders":
- Downloaded the missing Chromium shared libraries as plain `.deb` files via `apt-get download` (works without root — it only fetches, doesn't install) and extracted them locally with `dpkg-deb -x` into `~/.local/chromium-libs`, then pointed `LD_LIBRARY_PATH` at the extracted `.so` files to get a real, working headless Chromium without ever touching system packages.
- Built an isolated debug entry point (`app/scene-debug.html` + `app/src/scene-debug.tsx`, dev-only, confirmed absent from `dist/` in production builds) that mounts `<Scene>` directly without needing a connected wallet, cycling through swing states on a timer.
- `scripts/check-scene.mjs` loads that page in headless Chromium, checks for uncaught JS errors, and **takes an actual screenshot** — read directly, not just asserted. First pass showed the camera framed so tight the character filled the whole screen with no city visible at all; fixed by pulling the chase-cam offset back (`(0,4,9)` → `(0,9,20)`) and re-verified with another real screenshot showing buildings, signage, glow, and character all correctly composed.
- Also measured FPS via `requestAnimationFrame` sampling and read back `WEBGL_debug_renderer_info`: this environment reports `SwiftShader Device (Subzero)` (Google's CPU-based software WebGL fallback, used because there's no real GPU passthrough here) at ~4fps. That number is **not a real-world performance result** — SwiftShader is typically 20-100x slower than actual hardware for a scene like this — so it can't be used to claim the scene is fast enough on a real machine, only that it renders correctly without crashing. Fixed one real, environment-independent issue found in the process anyway: `SwingRig`/`ChaseCamera` were allocating a fresh `THREE.Vector3` every single frame; both now reuse scratch vectors via refs.

**Still not done / needs your actual browser + GPU to confirm:** real-world frame rate on your machine, cross-browser check, and whether the neon/bloom tuning reads as intended on a real display rather than a screenshot from software rendering.

## Stage D: game shell / onboarding (branch: `stage-d-game-shell`)

Not yet merged; branched off `main`. Restructures the app's opening flow to read like an actual game instead of a wallet gate -- per the UX research that wallet-first onboarding is a major drop-off point, players should see the game's branding and be able to browse before ever touching a wallet.

- **`Splash.tsx`**: brief branded splash (auto-advances after ~1.6s, or click/tap to skip), no wallet UI present at all during this screen.
- **`Lobby.tsx`** (the menu) no longer has an `if (!ctx) return null` gate -- it always renders its branding, entry-fee, and max-multiplier info regardless of connection state. The wallet is only actually required at the instant **Play** is clicked: if not yet connected, that click opens the wallet picker modal contextually (via `useWalletModal`'s `setVisible(true)`, the same modal the corner pill already uses) and automatically resumes `start_run` the moment the connection completes -- no double-click needed, and no changes to the underlying wallet-adapter/Anchor/game-state logic per spec section D.3.
- **`WalletCornerPill.tsx`**: the wallet control moved to a small, persistent, fixed top-right pill (visible on menu/in-run/result, hidden during the splash) instead of gating the whole screen -- same `WalletMultiButton` component, just repositioned via CSS.

**Verified with real headless-browser screenshots** (`scripts/check-shell.mjs`), not just assumed from reading the code: confirmed the menu genuinely renders with zero wallet connected (entry fee/multiplier info and the Play button all visible, corner pill reads "Select Wallet"), and that clicking Play while disconnected opens the picker modal (Phantom/Solflare listed) rather than silently failing or requiring the corner pill to be found first. Zero uncaught errors across all three captured states (splash, menu, post-Play-click modal).

## Stage C: sound design (branch: `stage-c-sound`)

Not yet merged; branched off `main`. Only item #5 from the Stage C list -- item #1 (risk-profile selection) was deliberately **not** attempted: it requires changing the on-chain `Run` account's structure, and since `main`/`2d-safe-fallback`/`stage-a-hud`/`stage-b-multiplayer` all share the exact same live devnet program, a careless account-layout change risks breaking every existing `Run` account across every wallet that's ever used it (mine included) -- not a risk worth taking casually mid-hackathon without a real migration plan. Sound design carries zero such risk (frontend-only), which is why it's the one built here.

**Assets:** Kenney's "Interface Sounds" pack (CC0 1.0, license verified directly from the `License.txt` bundled inside the pack's own zip, not assumed from the site's branding) -- `tick_001.ogg` → multiplier tick-up, `confirmation_002.ogg` → cash-out, `error_003.ogg` → miss, `click_002.ogg` → button feedback. See `app/public/audio/LICENSE.txt`.

**`useSound.ts`**: caches one `Audio` element per clip, clones it per playback so overlapping triggers (e.g. clicking Cash Out right as a tick lands) don't cut each other off. Swallows autoplay-blocked errors silently -- harmless, since the next click/swing (a real user gesture) always succeeds.

**Verified, not assumed:** headless-browser check (`scripts/check-sound.mjs`) confirms clicking Play actually fires a real network request for `click.ogg` (not just that the code compiles) with zero uncaught errors. Actually *hearing* it, and judging volume/timing feel, needs your own browser with audio.

## Session keys: fixing wallet-popup-per-swing (branch: `stage-session-keys`)

Not yet merged; branched off `main`. Fixes the "Known rough edge" that used to be listed here: `InRun.tsx`'s auto-swing loop previously signed every `swing()` call with the connected wallet on a ~2s timer, meaning a wallet prompt roughly every 2 seconds during a run. This branch uses [MagicBlock's session-keys](https://github.com/magicblock-labs/session-keys) crate (on-chain, `session-keys = "3.1.1"`) and its matching [`@magicblock-labs/gum-sdk`](https://www.npmjs.com/package/@magicblock-labs/gum-sdk) client to cut that down to exactly two wallet approvals per run: one for `start_run`, one to create the session, then **zero** further popups until cash-out.

**Flow:** `Lobby.tsx` calls `start_run` (popup #1), then immediately calls `createSession` from `useSessionKey.ts` (popup #2) which generates a fresh in-memory `Keypair` and submits a `createSessionV2` transaction authorizing it. `InRun.tsx`'s swing loop then signs every `swing()` call directly with that in-memory session keypair — no wallet extension involved, no popup. `handleCashOut()` is deliberately **not** session-aware and always goes through the real wallet.

**Security model — what the session key can and can't do:**
- It is scoped to this program's `swing` instruction only, via the on-chain `#[session_auth_or(ctx.accounts.run.player.key() == ctx.accounts.player.key(), SessionError::InvalidToken)]` check in `swing.rs` — it authenticates as `run.player` *only* for calls that pass through that check.
- It **cannot** call `cash_out` — that instruction has no session-token parameter at all, so a session key can never move funds out of the Treasury.
- It **cannot** touch the Treasury, another player's `Run`, or any other program — `createSessionV2` binds the session to `targetProgram = PROGRAM_ID` (this program specifically).
- It expires automatically 30 minutes after creation (`SESSION_VALID_SECONDS` in `useSessionKey.ts`) even if never explicitly revoked — a bounded grant, not an indefinite one.
- It's funded with a small top-up (0.01 SOL, `SESSION_TOPUP_LAMPORTS`) sourced from the player's real wallet in the same approval that creates the session, just enough to cover ~15-20 swings' worth of fees.

**Why this program is deployed at a separate address instead of upgrading the shared one:** the original plan was to upgrade the existing shared devnet program (`8o3RF97HDqRQ7jVEviaYDmiMnGVCwck22XeezGwkYNnU`, used by `main`/`2d-safe-fallback`/`stage-a-hud`/`stage-b-multiplayer`/`stage-c-sound`) in place, since the new `session_token` account is a trailing, optional field that old clients simply never send. That assumption turned out to be wrong: a hand-built raw `TransactionInstruction` test (`tests/session-keys-raw-compat.ts`) proved that anchor-lang 1.1.2's on-chain `Option<Account>` handling requires the trailing slot to be genuinely *present* in the accounts list to resolve to `None` — a shorter accounts list (what every already-compiled `swing()` call on every other branch sends) is rejected outright with `AccountNotEnoughKeys`, not treated as "no session token." Upgrading the shared program in place would have broken every other branch's existing calls. This branch instead deploys as a completely separate, isolated program at `D2Jk64MauFmg8GhWoe7C2AqLFdQqjTayb5iy2hqrsBFS` with its own Treasury, so nothing about any other branch's deployment is touched.

**Verified so far:** all 12 localnet tests pass, including direct-wallet swing (unchanged, `sessionToken: null`), session-key-signed swing (zero wallet involvement, via `SessionTokenManager`), rejection of an invalid/random signer, and the `AccountNotEnoughKeys` raw-instruction test documenting the above finding. The isolated program is deployed and executable on devnet with its own funded Treasury. The frontend build is clean and a headless-browser check confirms the app loads with zero runtime errors through splash → menu → clicking Play while disconnected (opens the wallet picker as expected). **What still needs your own real-wallet, real-browser confirmation** (per this project's standing rule — headless checks can't drive an actual Phantom popup): connect a real wallet, click Play, confirm you see exactly two approvals (`start_run`, then session creation), then confirm the run proceeds through several swings with **zero** further popups, then confirm Cash Out still prompts your wallet normally.

## 3D idle preview: visible menu, wallet-after (branch: `stage-e-idle-preview`)

Not yet merged; branched off `main`. Fixes a real problem: opening the app used to show either a flat static menu card with no 3D visible at all, or require a wallet connection before showing anything -- neither matches how real games present a title/menu screen (the actual game world, idling, behind the menu UI). This makes the neon city + character visible and ambient-animated on the menu screen itself, with zero wallet interaction, exactly like a game's title-screen background.

**The core architectural change:** the `<Canvas>`/`<Scene>` used to be mounted only inside `InRun.tsx`, appearing for the first time once a run actually started. It's now mounted once, continuously, at the top level in `App.tsx`'s `GameFlow` -- present for every screen except the brief splash -- and never unmounts/remounts between menu → in-run → result. A `gamePhase: 'idle' | 'active' | 'result'` prop passed into `Scene` is a pure display-mode switch, not a remount: `'active'` (real gameplay) drives the existing chase-cam/HUD/swing-arc behavior from real on-chain `swingIndex`/`phase` exactly as before; anything else (`'idle'` or `'result'`) forces the character to its resting anchor point with the `Idle` animation clip and swaps in a new ambient `IdleCamera` in place of the chase cam, with the floating-multiplier/peak-badge HUD elements not rendered at all. `InRun.tsx` keeps its actual tick()/swing-transaction logic completely untouched -- it just reports its `swingIndex`/`phase` up to `GameFlow` via a new `onStateChange` callback instead of rendering its own canvas.

**`IdleCamera.tsx` (new):** a slow, continuous, non-repeating orbit around the character's resting position via `useFrame` -- deliberately not `OrbitControls` (no user input) and not a static locked shot, which reads as "broken/frozen" rather than atmospheric. A real gotcha found while checking this visually: the camera looking straight at the character put it dead-center, exactly where the menu's translucent card sits, hiding it completely behind the panel. Fixed with `camera.setViewOffset` (an asymmetric projection shift) so the character renders toward the lower-right of the frame, beside the card, while the camera still genuinely looks at it -- confirmed by screenshot, not assumed.

**`.card` (menu/result panel) is now translucent + `backdrop-filter: blur()`** instead of a solid background, since it always sits on top of the live canvas now -- the glow of the scene behind it shows through, rather than hiding it.

**Per-run state reset:** `FloatingMultiplier`/`PeakMultiplierBadge` track "already shown this milestone" internally; since they no longer remount between runs (the whole point of this change), a `runId` counter (bumped once per new run in `GameFlow`) is passed down as their React `key`, forcing exactly those two components to reset on replay while `SwingRig`/`City`/camera stay continuously mounted.

**Verified real, not just assumed:**
- Headless-browser screenshots across a 21+ second window show the idle camera genuinely orbiting (different buildings/signage visible each capture, not a static frame) with the character consistently visible and idling beside the menu card the whole time.
- Confirmed via an isolated debug harness (temporary, not committed) that the character model does render correctly in idle mode before diagnosing and fixing the dead-center occlusion problem above -- didn't just assume the fix was needed, verified the actual bug first.
- Clicking Play while disconnected still opens the wallet picker modal correctly with zero runtime errors, confirming the wallet-adapter/Anchor logic itself is untouched by this restructuring.
- `npm run build` passes clean.
- FPS comparison (via `scene-debug.html` for active mode vs a temporary idle-mode harness, both isolated from wallet/on-chain calls): idle mode measured *slightly faster* than active mode in this sandbox's software-rendered (SwiftShader) environment (idle skips the two HTML-anchored HUD components and simplifies the swing-arc math to a no-op). Absolute FPS numbers from this sandbox aren't representative of real hardware (documented elsewhere in this README), but the comparison itself is the meaningful signal: idle presentation is not heavier than active gameplay, so there's no expected frame-rate dip switching between them.

**What still needs your own real-browser look:** this is fundamentally a visual/feel change -- screenshots confirm it's *working*, but only you can judge whether the idle camera's speed/framing/composition actually looks good, and whether the transition from idle-preview into real gameplay (once a run starts) feels smooth rather than jarring on real hardware with a real GPU (this sandbox has neither).

## Real physics swing (branch: `stage-f-physics`)

Not yet merged; branched off `main`. Replaces the scripted Bezier-arc swing with a real physics-driven pendulum during active gameplay, using [`@react-three/rapier`](https://github.com/pmndrs/react-three-rapier) (Rapier, a Rust/WASM physics engine). Purely a rendering/physics-layer change -- Solana, Anchor, MagicBlock ER, session keys, and solsocket are completely untouched; the on-chain multiplier/payout logic doesn't know or care whether the visual swing is scripted or physics-driven.

**Dependency note:** pinned to `@react-three/rapier@1.5.0`, not latest (`2.x`) -- `2.x` requires `@react-three/fiber@^9.0.4` (React 19), incompatible with this project's React 18 + R3F `^8` stack (established back in the original 3D-visual-layer stage). Confirmed via `npm view @react-three/rapier@1.5.0 peerDependencies` before installing: `react >=18.0.0`, `@react-three/fiber >=8.9.0` -- matches exactly, no engine/React-version migration needed.

**Reference studied first, per the brief:** cloned and read [`Daudxu/CharacterControl-threejs`](https://github.com/Daudxu/CharacterControl-threejs) before writing any code. It's a floating-capsule WASD character controller (movement/jump/moving-platforms) -- useful for the basic `<RigidBody>`/`<CapsuleCollider>`/`useRapier()` API patterns and the "camera follows the physics body's real transform" idea, but it doesn't solve a rope-swing mechanic at all (no existing open-source repo does, in our exact stack) -- the joint-based swing itself was designed from Rapier's own joint-hook documentation.

**A real bug found only through your own real-browser testing, not caught by any headless check here:** the first version of this used `useSphericalJoint` ("typically used to simulate ragdoll arms, pendulums, etc." per react-three-rapier's own docs), which forces its two anchor points to be exactly coincident -- *including at the instant of creation*. The character starts near its own building, tens of units from the target anchor across the street; attaching a spherical joint between two points that far apart made Rapier's solver try to snap them together in a single step, a violent, physically-nonsensical correction. That impulse is what threw the character (and the chase camera following it) into a chaotic spin, which read as the whole static city "exploding into flying debris" even though the buildings themselves were never dynamic. **Fixed** by switching to `useRopeJoint`, which only *limits* the max distance between the two points rather than forcing them together, with the rope's length computed fresh from the character's real current position at the exact moment of attachment (not a stale precomputed value) -- so the rope starts already taut, zero correction needed, and the character just falls freely under gravity until the rope reaches its limit and it swings like an actual pendulum. This is exactly the kind of thing this project's standing rule about real-browser testing exists for -- every headless check here showed the swing "working," and it took your own eyes on the actual motion to catch that it wasn't.

**What changed, and what stayed cheap:** idle/result presentation (the menu's ambient preview, and the moment right after a run ends) still uses the original plain scripted `SwingRig` -- a standing-still character doesn't need physics simulation, so there's zero `<Physics>` cost there, confirmed unchanged via headless screenshot. Only active gameplay (`gamePhase === "active"`) mounts a `<Physics>` world:

- **`BuildingColliders.tsx`**: invisible fixed box colliders matching `City.tsx`'s visual buildings exactly (simple boxes, not trimesh -- the buildings are visually boxes too, so trimesh would cost more to simulate for zero visual gain), indexed the same way `cityLayout.ts`'s `getAnchorPoint` addresses them.
- **`PhysicsSwingRig.tsx`**: a dynamic capsule-collider character. The moment `phase` becomes `"swinging"` (the same optimistic, pre-on-chain-confirmation trigger the old scripted rig used -- this part of the flow is untouched), a rope joint attaches between the character and the *next* anchor building, with its length set to the character's real distance from that anchor at that exact moment; gravity plus that constraint produce the pendulum arc, not a precomputed curve. The joint is released (by unmounting a tiny `<SwingJoint>` wrapper -- react-three-rapier's `useRopeJoint` creates on mount, removes on unmount) the instant `phase` changes away from `"swinging"`. On a successful landing, the character is snapped onto the confirmed exact anchor point -- a small correction, not a teleport, since the physics motion already carried it most of the way there. On a miss, nothing extra happens: the joint is already gone, so gravity and whatever velocity the character already had take over as a **real physics fall against/away from the buildings**, not a scripted drop curve. Small `linearDamping`/`angularDamping` on the character's rigid body for extra stability against oscillation.
- **`getRestingPoint()`** (`cityLayout.ts`): a real bug caught during testing, not assumed -- the joint's own anchor has to sit exactly on the building surface (that's the actual pivot), but a capsule *centered* there visually clipped into the building once landed. This offsets the resting/landing position outward into the street by the capsule radius; the joint attach point itself is unaffected.
- **Camera**: `ChaseCamera.tsx` required **zero code changes** -- it was already designed to just follow whatever `onPositionUpdate` reports each frame, so it's now organically following the character's real physics transform instead of a scripted one.
- **Animation blending**: unchanged mechanism (`Character`'s existing `Idle`/`Jump`/`WalkJump` clip-switching by phase), just re-pointed at the physics rig instead of the scripted one -- `"swinging"` plays `Jump`, `"missed"` plays `WalkJump`, anything else plays `Idle`.

**A real bug caught along the way (not physics-related, but only surfaced because this was the first time `gamePhase="active"` got headlessly exercised since the idle-preview stage landed):** `FloatingMultiplier` and `PeakMultiplierBadge` were sibling elements both using `key={runId}` -- a genuine React key collision, fixed by giving them distinct key prefixes.

**Verified real, not just assumed:**
- Post rope-joint fix: multiple consecutive swings captured at tight (~200-300ms) screenshot intervals show clean, controlled arc motion -- no chaotic spinning, no camera whip, character and city both stable throughout. A full cycle (several successful swings, then the debug harness's deliberate miss) ran with zero console errors end to end.
- `scene-debug.html`'s debug harness (no wallet needed) now also deliberately triggers a miss partway through its cycle, not just successful swings -- this is a permanent addition to that harness, not a throwaway test, so future changes get this coverage too.
- Multiple consecutive swings complete without crashing (watched swingIndex progress 0→9 across repeated joint attach/release cycles).
- The miss/fall path is confirmed working via screenshots, not just code review: the character visibly separates from the city skyline and drops under real gravity once the joint releases on a miss.
- The landing-clip fix is confirmed via screenshot comparison (character embedded in the building face before the fix, standing clear of it after).
- Idle-preview/menu regression check: zero change, confirmed via screenshot -- still the cheap scripted path, `<Physics>` never mounts there.
- FPS comparison (idle menu vs. active/physics gameplay, both via headless `requestAnimationFrame` sampling): a small relative dip (roughly 3.8 → 3.6 in this sandbox's software-rendered environment) consistent with a genuinely lightweight setup (~23 total rigid bodies: 1 character + 22 buildings). As with earlier stages, absolute FPS numbers from this sandbox aren't representative of real hardware -- only the relative comparison is meaningful here.

**What still needs your own real-browser, real-gameplay confirmation (this is the honest, expected gap):** whether the swing actually *feels* good -- readable at speed, not too bouncy or too stiff, releasing with sensible momentum into the next anchor. This was flagged up front as an inherently iterative tuning problem that headless screenshots can't judge (no real GPU, no real physics-feel judgment possible in this sandbox), and that remains true: what's here is a genuinely working first pass (attaches, swings, releases, lands or falls, all confirmed functioning), not a fully-tuned final feel. Expect this to need several rounds of "try it, adjust joint/gravity parameters, try again" against your own real-browser impressions before calling it demo-ready. If time is tight, the scripted-arc version (`main`) remains a completely valid, demo-ready alternative on its own.

## Fix: stuck "Confirming transaction..." (branch: `fix-transaction-confirm`)

Not yet merged; branched off `main`. Fixes a real bug: after clicking Play/Start Run, the "Confirming transaction..."/"Setting up session..." status could sit indefinitely with no feedback if devnet was slow or the RPC had trouble -- no error, no timeout, just an unbounded spinner.

**Two independent causes fixed:**
1. **Wrong default commitment level.** `getProgram()` (`app/src/anchor/program.ts`) constructed its `Connection`/`AnchorProvider` with `"processed"` commitment -- the weakest level, whose subscription-based confirmation can be flaky on devnet's public RPC (a transaction can appear processed then get skipped without a clean notification). Every Anchor `.rpc()` call that doesn't pass its own explicit commitment (`start_run`, the direct-wallet swing fallback, `cash_out`) inherited this. Changed to `"confirmed"` -- the standard, well-supported choice for a responsive game (`"finalized"` would be safe but needlessly slow). The `<ConnectionProvider>` in `App.tsx` now also explicitly sets `commitment: "confirmed"` for consistency.
2. **No client-side timeout at all.** Even with the commitment fix, nothing bounded how long the UI would wait -- a genuinely slow/rate-limited RPC could still hang forever. Added `app/src/anchor/withTimeout.ts`, a small wrapper that races a promise against a hard deadline (45s) and rejects with a clear, specific message ("start_run is taking too long to confirm...", "Swing is taking too long...", etc.) if it fires. Wrapped around every network-bound step: `start_run`, session creation, each swing attempt (both the session-signed and direct-wallet paths), and cash-out. These errors flow into the exact same `error-banner` UI that already existed -- the fix is about guaranteeing an error eventually *appears*, not adding new error-handling UI.

**Verified:** a standalone test of the `withTimeout` logic (three cases: a never-resolving promise rejects at the deadline with the right error type, a promise that resolves before the deadline resolves normally without a spurious timeout, and a promise that rejects with its own error on time propagates that real error rather than the timeout message) -- all three passed. Headless-browser check confirms the app still loads and behaves identically otherwise (zero runtime errors, Play still opens the wallet picker). **What still needs your own real-browser confirmation:** whether the underlying stuck-transaction symptom is actually gone when you click Play with a real wallet on real devnet -- this fix addresses the two most likely causes (commitment level, no timeout), but only your own repeated real attempts can confirm the hang itself doesn't recur.

## Known rough edges / next steps

- **No admin withdrawal instruction** for the Treasury — fine for a hackathon demo, but a real deployment would want one.
- **Multiplier plateau above swing_index 12**: the table caps at 20x from index 12 onward while miss probability keeps climbing, so swinging past that point is pure downside. The frontend should nudge players to cash out once capped (not yet implemented — currently just tints the multiplier red past index 6 as an early warning).
