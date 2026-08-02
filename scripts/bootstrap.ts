/**
 * One-time setup after a fresh deploy: creates the Treasury PDA and funds
 * the house bankroll. Run with ANCHOR_PROVIDER_URL / ANCHOR_WALLET pointed
 * at the target cluster (see README "Deploying to devnet").
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/bootstrap.ts 2
 *
 * The trailing argument is how much SOL to seed the bankroll with (default
 * 2). Without a funded bankroll, cash_out on any multiplier > 1x will fail
 * with InsufficientBankroll.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { Webrush } from "../target/types/webrush";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Webrush as Program<Webrush>;

  const solToSeed = Number(process.argv[2] ?? "2");
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  const existing = await program.account.treasury.fetchNullable(treasuryPda);
  if (!existing) {
    console.log("Initializing treasury at", treasuryPda.toBase58());
    await program.methods
      .initializeTreasury()
      .accounts({
        payer: provider.wallet.publicKey,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log("Treasury already initialized at", treasuryPda.toBase58());
  }

  console.log(`Funding bankroll with ${solToSeed} SOL...`);
  const tx = new anchor.web3.Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: treasuryPda,
      lamports: solToSeed * LAMPORTS_PER_SOL,
    })
  );
  await provider.sendAndConfirm(tx);

  const balance = await provider.connection.getBalance(treasuryPda);
  console.log(`Treasury balance: ${balance / LAMPORTS_PER_SOL} SOL`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
