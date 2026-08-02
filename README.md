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

**This started as a separate, larger-scope track on top of the working 2D MVP, not a replacement for it.** It's since been merged into `main` via PR #1 -- if you're reading this on `main`, the app now renders the 3D scene, not the old flat `<Skyline>` canvas. The pure-2D, GPU-independent version still exists as its own branch, `2d-safe-fallback`, pinned to the last commit before that merge, kept specifically as a guaranteed-working fallback regardless of how the 3D/GPU story plays out on your machine. Per the honesty note this track started from: this is the closest realistic real-time approximation of a cinematic reference video buildable solo with free assets — moody neon city, animated character, bloom glow — not a pixel-match to a pre-rendered AI cinematic.

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

## Stage A polish: floating 3D HUD numbers (branch: `stage-a-hud`)

Not yet merged anywhere. Adds two things the original 3D build didn't have, matching a reference-video detail: a floating glow-outlined multiplier number that appears near the character on each successful swing (`FloatingMultiplier.tsx`), and a rotating gold radar-ring + badge shown when crossing 5x/10x/15x/20x milestones (`PeakMultiplierBadge.tsx`). The main flat multiplier readout is untouched.

Worth knowing: the first implementation used `@react-three/drei`'s `<Text>` (built on `troika-three-text`'s SDF shader) and it rendered **zero visible glyphs** in this sandbox's software-rendering fallback despite the font loading and parsing successfully with no thrown errors -- confirmed via headless-browser screenshots, not assumed. Likely an SDF-shader/hardware-derivative-extension gap specific to software rendering (SwiftShader), though this couldn't be confirmed either way without real GPU access. Switched to `<Html>` (a real DOM element anchored to a 3D position via CSS transform) instead, which sidesteps the WebGL text pipeline entirely and was confirmed rendering via multiple real screenshots. If you're on real hardware and curious whether `<Text>` actually works fine there, it's a one-line swap back in both files -- but there was no way to justify shipping something unverified either way from this sandbox.

Exact sizing (`distanceFactor` + CSS `font-size`) was tuned by eye against screenshots from degraded software rendering -- a final pass with real hardware is worth doing before calling this pixel-perfect.

## Stage B: shared-presence multiplayer via solsocket (branch: `stage-b-multiplayer`)

Not yet merged anywhere; branched off `main` (so it inherits the 3D layer). Builds the "Option A" mode: players see each other live in the same room, but every player's own money/escrow still runs entirely through the existing, untouched Anchor program -- solsocket only carries presence and ephemeral event messages, never SOL.

**Dependency check done first, not assumed:** solsocket's own `package.json` declares `@coral-xyz/anchor: 0.32.1` (exact) and `@solana/web3.js: ^1.98.0` -- both match WebRush's existing pinned versions exactly, so `npm install solsocket` added the package cleanly with zero version conflicts.

**A real gotcha, found by reading the installed package's actual `.d.ts` files, not the SDK's own example snippets:** `room.joinOrCreate(name, opts)`'s `creator` option defaults to the *calling* wallet. If every player's own wallet were left as the creator, each distinct player would silently spin up their own separate `"webrush-lobby"` room instead of landing in one shared room together -- the whole point of the feature would silently fail while looking like it worked. Fixed by pre-creating the room once under a fixed, well-known wallet (this project's existing devnet deploy/treasury wallet, `B55s6G5z1HL4saF38ojeNDRWujoLbadZYCr1Wf3SWjEs`) via `scripts/bootstrap-solsocket.ts`, and having the frontend hook (`useSolsocketRoom.ts`) always pass that same pubkey as `creator` so every player resolves to the identical on-chain room.

**Verified real, not just assumed from the SDK's docs:**
- Ran `scripts/bootstrap-solsocket.ts` against devnet -- it actually created the room on-chain. Confirmed independently via a raw `getAccountInfo` RPC call: the room account exists, 575 bytes, owned by `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` (MagicBlock's delegation program -- the same one our own program's ER delegation uses), meaning solsocket had already delegated it to the ephemeral rollup as documented.
- Frontend build passes clean; headless-browser check shows zero runtime errors and the same working wallet-picker modal as before -- solsocket's code is bundled and inert until a wallet connects, exactly as intended.
- Attempted a full two-client live test (`scripts/test-solsocket.ts`, two independent devnet keypairs simulating two players, checking that player A's `broadcast()`/`emit("miss")` actually reach player B's `onPresence`/`onMessage`) repeatedly across two separate sessions; still blocked by the same real, isolated environment issue: Node's native `fetch` (undici) intermittently times out specifically against `api.devnet.solana.com` from this sandbox, while `curl` to the exact same endpoint and Node `fetch` to unrelated hosts (example.com, npm registry) both work fine, and even `curl`/`fetch` to `api.devnet.solana.com` itself succeed on some attempts and not others -- genuinely intermittent, not a hard block. Most likely explanation: this session made a very large number of requests to Solana's public devnet RPC over its total duration (program deploys, treasury funding, ER tests, multiple bootstrap runs), and the provider is rate-limiting this sandbox's IP for that specific connection pattern. This is a sandbox/session-usage artifact, not a code defect. **New evidence from a retry:** on one of several attempts, both simulated players got far enough to actually resolve to the identical on-chain room address (`✅ Both players resolved to the SAME room address`) before the run was cut off by the same fetch flakiness partway through the broadcast step -- so room-joining itself is now confirmed working end-to-end, not just assumed from the SDK's docs. The broadcast → `onPresence` delivery step specifically has still not been confirmed end-to-end by anything other than reading the source.

**What still needs your own two-browser-profile test** (see the walkthrough below): does the other-players panel actually populate with a second wallet's live multiplier, and do the miss/cashout toast notifications actually appear.

### Manual multiplayer test walkthrough

You'll need two browser profiles (or a normal window + an incognito/private window) each with their own Phantom wallet funded with devnet SOL, since solsocket's shared room needs two genuinely different wallets connected to see presence between them.

```bash
cd /home/saloni/projects/WebRush
git checkout stage-b-multiplayer
git pull
cd app && npm install
npm run dev -- --host
```

1. In **both** browser profiles: open the printed URL, connect a different Phantom wallet in each, start a run in both.
2. In **profile 1**, once in the in-run screen: within a few seconds you should see an **"In this room"** panel in the top-right listing profile 2's wallet (shortened, e.g. `Ab3d..Xy9z`) with their current multiplier. *If broken:* the panel never appears in either profile → check the browser console for a solsocket connection error.
3. Let one profile miss (or cash out) -- the *other* profile should see a brief toast near the bottom, e.g. "Ab3d..Xy9z missed at 3.71x" or "...cashed out at 2.20x". *If broken:* the panel updates fine but toasts never appear → the presence channel works but message emission doesn't, worth reporting with which one you saw.
4. Confirm the panel entry disappears a few seconds after the other player leaves/closes their tab (stale-presence cleanup, ~8s timeout).

## Known rough edges / next steps

- **Wallet-popup-per-swing**: `InRun.tsx`'s auto-swing loop currently signs each `swing()` call with the connected wallet on a ~2s timer, which means a wallet prompt every swing. Fine for a scaffold, bad for a live demo. The fix is a per-session burner keypair authorized to sign swings on the player's behalf once delegated to the ER — see `magicblock-engine-examples/session-keys` for the pattern, or reuse `solsocket`'s auto-managed session key if the collaboration/multiplayer layer gets built.
- **No admin withdrawal instruction** for the Treasury — fine for a hackathon demo, but a real deployment would want one.
- **Multiplier plateau above swing_index 12**: the table caps at 20x from index 12 onward while miss probability keeps climbing, so swinging past that point is pure downside. The frontend should nudge players to cash out once capped (not yet implemented — currently just tints the multiplier red past index 6 as an early warning).
