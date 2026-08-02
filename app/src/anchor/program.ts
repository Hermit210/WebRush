import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import idl from "./webrush.json";
import type { Webrush } from "../../../target/types/webrush";
import { RUN_SEED, TREASURY_SEED } from "./constants";

export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID ??
    "8o3RF97HDqRQ7jVEviaYDmiMnGVCwck22XeezGwkYNnU"
);

export const RPC_ENDPOINT =
  import.meta.env.VITE_RPC_ENDPOINT ?? "https://api.devnet.solana.com";

/**
 * Regenerate `webrush.json` any time the program changes:
 *   anchor build && cp target/idl/webrush.json app/src/anchor/webrush.json
 * (see README "Wiring the frontend to the program"). Typed against the
 * generated `target/types/webrush.ts` so `program.account.run` /
 * `.methods.startRun()` etc. are compile-time checked instead of `any`.
 */
export function getProgram(wallet: AnchorWallet) {
  const connection = new Connection(RPC_ENDPOINT, "processed");
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "processed",
  });
  return new Program<Webrush>(idl as Webrush, provider);
}

export function treasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TREASURY_SEED)],
    PROGRAM_ID
  );
}

export function runPda(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(RUN_SEED), player.toBuffer()],
    PROGRAM_ID
  );
}
