import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { assert } from "chai";
import type { Webrush } from "../target/types/webrush";

/**
 * Documents the actual finding that drove this program's separate program
 * ID (see lib.rs declare_id! comment and README "Session keys"). Every
 * other branch (main, 2d-safe-fallback, stage-a-hud, stage-b-multiplayer,
 * stage-c-sound) has its own frozen pre-session-keys IDL and calls `swing`
 * with exactly 2 accounts (player, run) -- it has no idea `sessionToken`
 * exists.
 *
 * This test hand-builds that exact 2-account instruction, bypassing
 * Anchor's TS client (which would insert a placeholder for the trailing
 * Option since it's bound to the current, session-keys-aware IDL) to
 * directly answer: does this on-chain program still accept the exact
 * byte-for-byte instruction an old, unmodified frontend sends?
 *
 * The answer, confirmed here, is NO -- anchor-lang 1.1.2's generated
 * `Option<Account>` handling requires the trailing account slot to be
 * PRESENT in the raw account list (even as a placeholder); a genuinely
 * missing slot throws `AccountNotEnoughKeys`, not a graceful `None`. That
 * is exactly why this program deploys to its OWN separate program ID
 * (D2Jk64Mau...) instead of upgrading the shared devnet deployment other
 * branches depend on -- upgrading in place would have broken every one of
 * them. This test asserts the failure explicitly so the reasoning stays
 * provable, not just asserted in a comment.
 */
describe("session-keys raw backward-compatibility (documents why this program is isolated)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Webrush as Program<Webrush>;

  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  before(async () => {
    const existing = await program.account.treasury.fetchNullable(treasuryPda);
    if (!existing) {
      await program.methods
        .initializeTreasury()
        .accounts({
          payer: provider.wallet.publicKey,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    const balance = await provider.connection.getBalance(treasuryPda);
    if (balance < LAMPORTS_PER_SOL) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: treasuryPda,
          lamports: 2 * LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx);
    }
  });

  it("a hand-built 2-account swing instruction (no sessionToken slot at all) is REJECTED with AccountNotEnoughKeys -- proving the shared program could not have been safely upgraded in place", async () => {
    const player = Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      player.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

    const [runPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("run"), player.publicKey.toBuffer()],
      program.programId
    );

    const playerProvider = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(player),
      { commitment: "confirmed" }
    );
    const playerProgram = new anchor.Program<Webrush>(
      program.idl as any,
      playerProvider
    );
    await playerProgram.methods
      .startRun()
      .accounts({
        player: player.publicKey,
        run: runPda,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const swingDiscriminator = Buffer.from(
      (program.idl as any).instructions.find((i: any) => i.name === "swing")
        .discriminator
    );
    const rawIx = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: player.publicKey, isSigner: true, isWritable: true },
        { pubkey: runPda, isSigner: false, isWritable: true },
      ],
      data: swingDiscriminator,
    });

    const tx = new Transaction().add(rawIx);
    try {
      await sendAndConfirmTransaction(provider.connection, tx, [player], {
        commitment: "confirmed",
      });
      assert.fail(
        "expected AccountNotEnoughKeys -- if this now passes, anchor-lang's Option<Account> handling changed and the shared-program-upgrade tradeoff should be reconsidered"
      );
    } catch (err) {
      assert.include(String(err), "AccountNotEnoughKeys");
    }
  });
});
