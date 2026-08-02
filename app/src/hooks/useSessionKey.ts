import { useCallback, useRef, useState } from "react";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { PROGRAM_ID, RPC_ENDPOINT } from "../anchor/program";

export interface SessionHandle {
  sessionKeypair: Keypair;
  sessionTokenPda: PublicKey;
}

// Generous relative to an actual 30-90s run, but still a hard, short-lived
// bound -- not an indefinite grant. See README "Session keys" security
// model for the full reasoning.
const SESSION_VALID_SECONDS = 60 * 30;
// Covers session-signed fees for ~15-20 swings with headroom; sourced from
// the player's real wallet in the SAME approval as session creation, not a
// separate charge.
const SESSION_TOPUP_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;

/**
 * Creates a scoped session key (via @magicblock-labs/gum-sdk) authorized to
 * call THIS program's `swing` instruction on the connected wallet's behalf,
 * for a bounded time window. This is what removes the wallet-popup-per-
 * swing problem: one approval here creates the session (the real wallet
 * signs once), then every subsequent swing is signed directly by the
 * in-memory session Keypair -- no further wallet popups until the player
 * cashes out (which still requires the real wallet, by design).
 *
 * Security model: the session key can ONLY do what the on-chain program's
 * `#[session_auth_or]` check on `swing` allows -- advance this specific
 * run's swing_index or mark it missed. It cannot call `cash_out` (not
 * session-aware at all, real wallet required), cannot touch the Treasury,
 * cannot sign for any OTHER program, and stops working once `validUntil`
 * passes even if never explicitly revoked.
 */
export function useSessionKey() {
  const [session, setSession] = useState<SessionHandle | null>(null);
  const creatingRef = useRef(false);

  const createSession = useCallback(
    async (wallet: AnchorWallet): Promise<SessionHandle> => {
      if (creatingRef.current) {
        throw new Error("Session creation already in progress");
      }
      creatingRef.current = true;
      try {
        const connection = new Connection(RPC_ENDPOINT, "confirmed");
        const sessionKeypair = Keypair.generate();
        const sessionTokenManager = new SessionTokenManager(
          wallet as any,
          connection
        );

        const validUntil = new anchor.BN(
          Math.floor(Date.now() / 1000) + SESSION_VALID_SECONDS
        );
        const topUp = new anchor.BN(SESSION_TOPUP_LAMPORTS);

        const tx = await sessionTokenManager.program.methods
          .createSessionV2(true, validUntil, topUp)
          .accounts({
            targetProgram: PROGRAM_ID,
            sessionSigner: sessionKeypair.publicKey,
            feePayer: wallet.publicKey,
            authority: wallet.publicKey,
          })
          .transaction();
        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = (
          await connection.getLatestBlockhash()
        ).blockhash;

        // Session keypair signs locally, no popup -- it's a real in-memory
        // Keypair, not a wallet extension. The real wallet then signs once
        // for its own (the fee-payer/authority) slot -- this IS the "one
        // approval to start" transaction.
        tx.partialSign(sessionKeypair);
        const signed = await wallet.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(sig, "confirmed");

        const [sessionTokenPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("session_token_v2"),
            PROGRAM_ID.toBytes(),
            sessionKeypair.publicKey.toBytes(),
            wallet.publicKey.toBytes(),
          ],
          sessionTokenManager.program.programId
        );

        const handle: SessionHandle = { sessionKeypair, sessionTokenPda };
        setSession(handle);
        return handle;
      } finally {
        creatingRef.current = false;
      }
    },
    []
  );

  const clearSession = useCallback(() => setSession(null), []);

  return { session, createSession, clearSession };
}
