/**
 * Real two-client verification of the solsocket presence/messaging layer --
 * not a UI check, an actual data-flow test. Simulates two independent
 * players (two different Keypairs, solsocket accepts a raw Keypair as
 * `wallet` in a Node context same as a browser wallet adapter in the
 * frontend) joining the same shared room and confirms:
 *   1. player A's broadcast() is received by player B's onPresence
 *   2. player A's emit("miss") is received by player B's onMessage
 * This is the actual mechanic the frontend's useSolsocketRoom hook and
 * InRun.tsx wire up to the UI -- proving the underlying data flow works
 * end-to-end is a stronger signal than a headless page-load check, though
 * it still doesn't replace the user manually confirming the two-tab UI.
 *
 * Run with:
 *   ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/test-solsocket.ts
 */
import { SolSocket, type PresenceUpdate, type RoomMessage } from "solsocket";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";

const LOBBY_CREATOR = new PublicKey("B55s6G5z1HL4saF38ojeNDRWujoLbadZYCr1Wf3SWjEs");

function loadWallet(path: string): Keypair {
  const expanded = path.replace("~", process.env.HOME ?? process.env.USERPROFILE ?? "");
  const secret = JSON.parse(fs.readFileSync(expanded, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function waitFor<T>(
  subscribe: (cb: (v: T) => void) => () => void,
  predicate: (v: T) => boolean,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub();
      reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`));
    }, timeoutMs);
    const unsub = subscribe((v) => {
      if (predicate(v)) {
        clearTimeout(timeout);
        unsub();
        resolve(v);
      }
    });
  });
}

async function main() {
  // Both fresh wallets with no prior presence in the room -- avoids the
  // deployer wallet's stale presence slot forcing a longer "recover" code
  // path with more sequential RPC calls, which was hitting more transient
  // network failures than a plain first-time join.
  const walletA = loadWallet("/tmp/player1.json");
  const walletB = loadWallet("/tmp/player2.json");

  console.log("Player A:", walletA.publicKey.toBase58());
  console.log("Player B:", walletB.publicKey.toBase58());

  const sockA = SolSocket.connect({ wallet: walletA, cluster: "devnet", region: "us" });
  const sockB = SolSocket.connect({ wallet: walletB, cluster: "devnet", region: "us" });

  console.log("\n[A] joining webrush-lobby...");
  const roomA = await sockA.joinOrCreate("webrush-lobby", { creator: LOBBY_CREATOR });
  console.log("[A] joined:", roomA.address.toBase58());

  console.log("[B] joining webrush-lobby...");
  const roomB = await sockB.joinOrCreate("webrush-lobby", { creator: LOBBY_CREATOR });
  console.log("[B] joined:", roomB.address.toBase58());

  if (!roomA.address.equals(roomB.address)) {
    throw new Error(
      `Players landed in DIFFERENT rooms (${roomA.address.toBase58()} vs ${roomB.address.toBase58()}) -- the fixed-creator approach failed`
    );
  }
  console.log("✅ Both players resolved to the SAME room address.");

  // --- presence: A broadcasts, B should see it ---
  console.log("\n[test] A broadcasts {multiplier: 2.5, status: swinging}, waiting for B to see it...");
  const presenceSeen = waitFor<PresenceUpdate<any>>(
    (cb) => roomB.onPresence(cb),
    (u) => u.player.equals(walletA.publicKey) && u.data?.multiplier === 2.5,
    15000,
    "B's onPresence to see A's broadcast"
  );
  await roomA.broadcast({ multiplier: 2.5, status: "swinging" });
  const presenceResult = await presenceSeen;
  console.log("✅ B received A's presence broadcast:", presenceResult.data);

  // --- message: A emits "miss", B should see it ---
  console.log("\n[test] A emits miss{atMultiplier: 4.2}, waiting for B to see it...");
  const messageSeen = waitFor<RoomMessage<any>>(
    (cb) => roomB.onMessage("miss", cb),
    (m) => m.player.equals(walletA.publicKey),
    15000,
    "B's onMessage('miss') to see A's emit"
  );
  await roomA.emit("miss", { atMultiplier: 4.2 });
  const messageResult = await messageSeen;
  console.log("✅ B received A's miss event:", messageResult.data);

  console.log("\nLeaving room for both players...");
  await roomA.leave();
  await roomB.leave();

  console.log("\n✅ ALL CHECKS PASSED -- solsocket presence + messaging verified end-to-end.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ solsocket test failed:");
  console.error(err);
  process.exit(1);
});
