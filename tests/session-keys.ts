import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { assert } from "chai";
import type { Webrush } from "../target/types/webrush";

/**
 * Real localnet test of the session-key swing path -- not a compile check.
 * Exercises BOTH:
 *   (a) the original direct-wallet swing call (must still work unmodified --
 *       this is the backward-compatibility guarantee every other branch's
 *       existing swing() calls depend on)
 *   (b) a swing signed ONLY by a session keypair, with zero involvement of
 *       the real player wallet for that specific transaction
 *
 * Requires gpl_session cloned onto the local validator -- see Anchor.toml's
 * [[test.validator.clone]] entry.
 */
describe("session-keys", () => {
  const baseProvider = anchor.AnchorProvider.env();
  anchor.setProvider(baseProvider);
  const program = anchor.workspace.Webrush as Program<Webrush>;

  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  let player: Keypair;
  let runPda: PublicKey;

  before(async () => {
    // Ensure the treasury exists and is funded, independent of whether
    // tests/webrush.ts already did this in the same `anchor test` run.
    const existing = await program.account.treasury.fetchNullable(treasuryPda);
    if (!existing) {
      await program.methods
        .initializeTreasury()
        .accounts({ payer: baseProvider.wallet.publicKey, treasury: treasuryPda, systemProgram: SystemProgram.programId })
        .rpc();
    }
    const treasuryBalance = await baseProvider.connection.getBalance(treasuryPda);
    if (treasuryBalance < LAMPORTS_PER_SOL) {
      const tx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: baseProvider.wallet.publicKey,
          toPubkey: treasuryPda,
          lamports: 2 * LAMPORTS_PER_SOL,
        })
      );
      await baseProvider.sendAndConfirm(tx);
    }

    // Fresh player, independent of whatever wallet tests/webrush.ts used.
    player = Keypair.generate();
    const airdropSig = await baseProvider.connection.requestAirdrop(
      player.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await baseProvider.connection.confirmTransaction(airdropSig, "confirmed");

    [runPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("run"), player.publicKey.toBuffer()],
      program.programId
    );
  });

  it("starts a run with the real player wallet", async () => {
    const playerProvider = new anchor.AnchorProvider(
      baseProvider.connection,
      new anchor.Wallet(player),
      { commitment: "confirmed" }
    );
    const playerProgram = new anchor.Program<Webrush>(
      program.idl as any,
      playerProvider
    );
    await playerProgram.methods
      .startRun()
      .accounts({ player: player.publicKey, run: runPda, treasury: treasuryPda, systemProgram: SystemProgram.programId })
      .rpc();
    const run = await program.account.run.fetch(runPda);
    assert.equal(run.swingIndex, 0);
    assert.deepEqual(run.status, { active: {} });
  });

  it("swings once with the direct wallet -- unchanged, backward-compatible path", async () => {
    const playerProvider = new anchor.AnchorProvider(
      baseProvider.connection,
      new anchor.Wallet(player),
      { commitment: "confirmed" }
    );
    const playerProgram = new anchor.Program<Webrush>(
      program.idl as any,
      playerProvider
    );
    // `run`'s seed now depends on run.player (self-referential, needed so
    // the SAME PDA resolves regardless of whether the direct wallet or a
    // session key is the actual signer) -- Anchor's client can no longer
    // auto-derive it, so it must be passed explicitly from here on.
    await playerProgram.methods
      .swing()
      .accounts({ player: player.publicKey, run: runPda, sessionToken: null })
      .rpc();
    const run = await program.account.run.fetch(runPda);
    assert.equal(run.swingIndex, 1, "swing_index should advance to 1 (0% miss chance at index 0)");
    assert.deepEqual(run.status, { active: {} });
  });

  it("creates a session and swings using ONLY the session keypair -- zero wallet involvement", async () => {
    const sessionKeypair = Keypair.generate();
    const sessionTokenManager = new SessionTokenManager(
      new anchor.Wallet(player) as any,
      baseProvider.connection
    );

    const validUntil = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour
    const topUpLamports = new anchor.BN(0.01 * LAMPORTS_PER_SOL);

    const createSessionTx = await sessionTokenManager.program.methods
      .createSessionV2(true, validUntil, topUpLamports)
      .accounts({
        targetProgram: program.programId,
        sessionSigner: sessionKeypair.publicKey,
        feePayer: player.publicKey,
        authority: player.publicKey,
      })
      .transaction();
    createSessionTx.feePayer = player.publicKey;

    await sendAndConfirmTransaction(
      baseProvider.connection,
      createSessionTx,
      [player, sessionKeypair],
      { commitment: "confirmed" }
    );

    const [sessionTokenPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("session_token_v2"),
        program.programId.toBytes(),
        sessionKeypair.publicKey.toBytes(),
        player.publicKey.toBytes(),
      ],
      sessionTokenManager.program.programId
    );

    // The swing tx below is built and sent using ONLY the session keypair --
    // the real player wallet (a Keypair we hold in this test, but which a
    // real browser wallet extension would NOT expose for silent signing)
    // never signs this transaction at all.
    const swingTx = await program.methods
      .swing()
      .accounts({
        player: sessionKeypair.publicKey,
        run: runPda,
        sessionToken: sessionTokenPda,
      })
      .transaction();
    swingTx.feePayer = sessionKeypair.publicKey;
    await sendAndConfirmTransaction(
      baseProvider.connection,
      swingTx,
      [sessionKeypair],
      { commitment: "confirmed" }
    );

    const run = await program.account.run.fetch(runPda);
    assert.equal(run.swingIndex, 2, "swing_index should advance to 2 via the session-signed swing");
    assert.deepEqual(run.status, { active: {} });
  });

  it("rejects a swing signed by a random keypair with no valid session", async () => {
    const randomKeypair = Keypair.generate();
    try {
      const tx = await program.methods
        .swing()
        .accounts({ player: randomKeypair.publicKey, run: runPda, sessionToken: null })
        .transaction();
      tx.feePayer = randomKeypair.publicKey;
      await baseProvider.connection.confirmTransaction(
        await baseProvider.connection.requestAirdrop(randomKeypair.publicKey, LAMPORTS_PER_SOL),
        "confirmed"
      );
      await sendAndConfirmTransaction(baseProvider.connection, tx, [randomKeypair], {
        commitment: "confirmed",
      });
      assert.fail("expected this swing to be rejected");
    } catch (err) {
      assert.include(String(err), "InvalidToken");
    }
  });
});
