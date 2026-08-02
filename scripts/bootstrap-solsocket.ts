/**
 * One-time setup: creates the shared "webrush-lobby" solsocket room.
 *
 * Room addresses are deterministic from (creator pubkey, room name) --
 * see solsocket's `roomAddressForName`/`nameToRoomId`. `joinOrCreate`'s
 * `creator` option defaults to the CALLING wallet, so if every player's
 * own wallet were left as the creator, each distinct player would spin up
 * their own separate "webrush-lobby" room instead of sharing one. This
 * script creates the room once under a fixed, well-known wallet (this
 * project's existing deploy/treasury wallet); the frontend then has every
 * player explicitly pass that same pubkey as `creator` when joining, so
 * they all resolve to the identical on-chain room regardless of whose
 * wallet is actually connecting.
 *
 * Run with:
 *   ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/bootstrap-solsocket.ts
 */
import { SolSocket } from "solsocket";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";

function loadWallet(): Keypair {
  const path = process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json";
  const expanded = path.replace("~", process.env.HOME ?? process.env.USERPROFILE ?? "");
  const secret = JSON.parse(fs.readFileSync(expanded, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const wallet = loadWallet();
  const sock = SolSocket.connect({ wallet, cluster: "devnet", region: "us" });
  console.log("Lobby creator wallet (hardcode this in the frontend):", sock.walletPubkey.toBase58());

  const room = await sock.joinOrCreate("webrush-lobby", { maxPlayers: 16 });
  console.log("Room address:", room.address.toBase58());
  console.log("Presence address:", room.presenceAddress.toBase58());
  console.log("\nRoom is live. Leave it running -- do not call closeToBase() here.");

  // Just confirming it round-trips; don't leave the room, the whole point
  // is for it to persist for players to join.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
