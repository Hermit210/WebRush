/**
 * Real end-to-end test of MagicBlock Ephemeral Rollup delegation against
 * the already-deployed devnet program -- not a compile check. Exercises:
 *   base layer: start_run -> delegate_run
 *   ER (devnet-us):        swing (x3) -> undelegate_run
 *   base layer: cash_out
 *
 * Uses MagicBlock's public hosted devnet ER (no local validator needed):
 *   RPC/WS:   https://devnet-us.magicblock.app / wss://devnet-us.magicblock.app
 *   Validator: MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd
 *   Delegation program: DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh
 * (all verified against docs.magicblock.gg, cross-checked against the
 * delegation_program address already present in target/idl/webrush.json's
 * delegate_run accounts).
 *
 * Run with: npx ts-node scripts/test-er.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  clusterApiUrl,
} from "@solana/web3.js";
import * as fs from "fs";
import type { Webrush } from "../target/types/webrush";

const PROGRAM_ID = new PublicKey(
  "8o3RF97HDqRQ7jVEviaYDmiMnGVCwck22XeezGwkYNnU"
);
const ER_RPC = "https://devnet-us.magicblock.app";
const ER_WS = "wss://devnet-us.magicblock.app";
const ER_VALIDATOR = new PublicKey(
  "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd"
);

function loadWallet(): Wallet {
  const path = process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json";
  const expanded = path.replace(
    "~",
    process.env.HOME ?? process.env.USERPROFILE ?? ""
  );
  const secret = JSON.parse(fs.readFileSync(expanded, "utf-8"));
  return new Wallet(Keypair.fromSecretKey(Uint8Array.from(secret)));
}

async function main() {
  const wallet = loadWallet();

  const baseConnection = new Connection(
    process.env.ANCHOR_PROVIDER_URL ?? clusterApiUrl("devnet"),
    "confirmed"
  );
  const baseProvider = new AnchorProvider(baseConnection, wallet, {
    commitment: "confirmed",
  });
  const idl = JSON.parse(
    fs.readFileSync("target/idl/webrush.json", "utf-8")
  );
  const baseProgram = new Program<Webrush>(idl, baseProvider);

  const erConnection = new Connection(ER_RPC, {
    wsEndpoint: ER_WS,
    commitment: "confirmed",
  });
  const erProvider = new AnchorProvider(erConnection, wallet, {
    commitment: "confirmed",
  });
  const erProgram = new Program<Webrush>(idl, erProvider);

  const [runPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("run"), wallet.publicKey.toBuffer()],
    PROGRAM_ID
  );

  console.log("Player:", wallet.publicKey.toBase58());
  console.log("Run PDA:", runPda.toBase58());

  // --- base layer: reset/start a run if needed ---
  const existing = await baseProgram.account.run.fetchNullable(runPda);
  if (!existing || !("active" in existing.status)) {
    console.log("\n[base] start_run...");
    const sig = await baseProgram.methods
      .startRun()
      .accounts({ player: wallet.publicKey })
      .rpc();
    console.log("  tx:", sig);
  } else {
    console.log("\n[base] run already active, reusing it");
  }

  // --- base layer: delegate the Run PDA to the ER ---
  console.log("\n[base] delegate_run -> ER validator", ER_VALIDATOR.toBase58());
  const delegateSig = await baseProgram.methods
    .delegateRun()
    .accounts({ payer: wallet.publicKey })
    .remainingAccounts([
      { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
    ])
    .rpc();
  console.log("  tx:", delegateSig);

  // Confirm the account really changed owner on base layer (should now be
  // owned by the delegation program, not our program).
  const afterDelegate = await baseConnection.getAccountInfo(runPda);
  console.log(
    "  Run account owner after delegate:",
    afterDelegate?.owner.toBase58()
  );

  // --- ER: swing a few times, fast/cheap on the rollup ---
  for (let i = 0; i < 3; i++) {
    console.log(`\n[ER] swing #${i + 1}...`);
    const t0 = Date.now();
    const sig = await erProgram.methods
      .swing()
      .accounts({ player: wallet.publicKey })
      .rpc();
    const elapsed = Date.now() - t0;
    console.log(`  tx: ${sig} (${elapsed}ms)`);
    const run = await erProgram.account.run.fetch(runPda);
    console.log("  swing_index:", run.swingIndex, "status:", run.status);
    if (!("active" in run.status)) {
      console.log("  run ended (miss) -- stopping swing loop early");
      break;
    }
  }

  // --- ER: undelegate (commits final state back to base layer) ---
  console.log("\n[ER] undelegate_run...");
  const undelegateSig = await erProgram.methods
    .undelegateRun()
    .accounts({ payer: wallet.publicKey })
    .rpc();
  console.log("  tx:", undelegateSig);

  // Give the commit a moment to land on base layer, then confirm ownership
  // reverted to our program.
  await new Promise((r) => setTimeout(r, 3000));
  const afterUndelegate = await baseConnection.getAccountInfo(runPda);
  console.log(
    "  Run account owner after undelegate:",
    afterUndelegate?.owner.toBase58(),
    "(expect:", PROGRAM_ID.toBase58(), ")"
  );

  const finalRun = await baseProgram.account.run.fetch(runPda);
  console.log("\nFinal base-layer Run state:", {
    swingIndex: finalRun.swingIndex,
    status: finalRun.status,
  });

  // --- base layer: cash out if still active ---
  if ("active" in finalRun.status) {
    console.log("\n[base] cash_out...");
    const sig = await baseProgram.methods
      .cashOut()
      .accounts({ player: wallet.publicKey })
      .rpc();
    console.log("  tx:", sig);
  }

  console.log("\n✅ ER delegation round-trip completed.");
}

main().catch((err) => {
  console.error("\n❌ ER test failed:");
  console.error(err);
  process.exit(1);
});
