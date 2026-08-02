import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import type { Webrush } from "../target/types/webrush";

// These tests exercise the base-layer program logic on localnet: escrow,
// multiplier ticks, cash-out payout math, and the basic state guards.
// They do NOT exercise delegate_run / undelegate_run against a real
// ephemeral rollup validator -- that requires the MagicBlock ER validator
// running locally or on devnet (see README "Testing ER delegation").
describe("webrush", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Webrush as Program<Webrush>;
  const player = provider.wallet.publicKey;

  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );
  const [runPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("run"), player.toBuffer()],
    program.programId
  );

  const ENTRY_FEE_LAMPORTS = 10_000_000; // 0.01 SOL, must match constants.rs

  it("initializes the treasury and funds the bankroll", async () => {
    // Idempotent: tests/session-keys.ts's own before() hook may have
    // already created (and possibly funded) this same shared treasury PDA
    // if mocha loads that file first -- a second unconditional `init` call
    // would fail with "already in use".
    const existing = await program.account.treasury.fetchNullable(treasuryPda);
    if (!existing) {
      await program.methods
        .initializeTreasury()
        .accounts({
          payer: player,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Fund the house bankroll with a plain SOL transfer -- no custom
    // instruction needed, since crediting lamports to a program-owned
    // account doesn't require that program's authorization. Without this,
    // cash_out on a multiplier > 1x would hit InsufficientBankroll.
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: player,
        toPubkey: treasuryPda,
        lamports: 2 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx);

    const treasury = await program.account.treasury.fetch(treasuryPda);
    assert.isAtLeast(treasury.totalDepositedLamports.toNumber(), 0);
  });

  it("starts a run and escrows the entry fee into the treasury", async () => {
    const treasuryBefore = await provider.connection.getBalance(treasuryPda);

    await program.methods
      .startRun()
      .accounts({
        player,
        run: runPda,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const run = await program.account.run.fetch(runPda);
    assert.equal(run.swingIndex, 0);
    assert.deepEqual(run.status, { active: {} });
    assert.equal(run.stakeLamports.toNumber(), ENTRY_FEE_LAMPORTS);

    const treasuryAfter = await provider.connection.getBalance(treasuryPda);
    assert.equal(treasuryAfter - treasuryBefore, ENTRY_FEE_LAMPORTS);
  });

  it("rejects starting a second run while one is already active", async () => {
    try {
      await program.methods
        .startRun()
        .accounts({
          player,
          run: runPda,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected RunAlreadyActive error");
    } catch (err) {
      assert.include(err.toString(), "RunAlreadyActive");
    }
  });

  it("resolves guaranteed-safe early swings (miss probability is 0% for swing_index 0-2)", async () => {
    for (let expectedIndex = 1; expectedIndex <= 3; expectedIndex++) {
      // sessionToken is a new, optional trailing account (see the
      // session-keys work) -- Anchor's TS client, bound to the IDL that
      // knows about it, requires it to be explicitly nulled rather than
      // omitted. This has no bearing on other, separately-frozen IDL
      // copies on other branches, which don't know this account exists.
      await program.methods
        .swing()
        .accounts({ player, run: runPda, sessionToken: null })
        .rpc();
      const run = await program.account.run.fetch(runPda);
      assert.equal(run.swingIndex, expectedIndex);
      assert.deepEqual(run.status, { active: {} });
    }
  });

  it("cashes out at the current multiplier and pays out of the treasury", async () => {
    const playerBefore = await provider.connection.getBalance(player);

    const txSig = await program.methods
      .cashOut()
      .accounts({
        player,
        run: runPda,
        treasury: treasuryPda,
      })
      .rpc();
    await provider.connection.confirmTransaction(txSig, "confirmed");

    const run = await program.account.run.fetch(runPda);
    assert.deepEqual(run.status, { cashedOut: {} });

    // swing_index is 3 after the previous test -> multiplier 2.20x (220 / 100)
    // gross = 0.01 SOL * 2.20 = 0.022 SOL, net after 2% fee = 0.02156 SOL
    const expectedNet = Math.round(
      ((ENTRY_FEE_LAMPORTS * 220) / 100) * 0.98
    );

    const playerAfter = await provider.connection.getBalance(player);
    // Allow for the tx fee paid by the player wallet itself.
    const delta = playerAfter - playerBefore;
    assert.isAbove(delta, expectedNet - 20_000);
  });

  it("rejects cashing out again or swinging a finished run", async () => {
    try {
      await program.methods
        .cashOut()
        .accounts({ player, run: runPda, treasury: treasuryPda })
        .rpc();
      assert.fail("expected RunNotActive error");
    } catch (err) {
      assert.include(err.toString(), "RunNotActive");
    }

    try {
      await program.methods
        .swing()
        .accounts({ player, run: runPda, sessionToken: null })
        .rpc();
      assert.fail("expected RunNotActive error");
    } catch (err) {
      assert.include(err.toString(), "RunNotActive");
    }
  });

  it("allows starting a fresh run after the previous one finished", async () => {
    await program.methods
      .startRun()
      .accounts({
        player,
        run: runPda,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const run = await program.account.run.fetch(runPda);
    assert.equal(run.swingIndex, 0);
    assert.deepEqual(run.status, { active: {} });
  });
});
