import { useMemo } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { getProgram, runPda, treasuryPda } from "../anchor/program";

/**
 * Thin wrapper around the generated Anchor client. Returns null until a
 * wallet is connected -- callers should gate on that (see Lobby.tsx).
 */
export function useWebRushProgram() {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();

  return useMemo(() => {
    if (!wallet) return null;
    const program = getProgram(wallet);
    const [treasury] = treasuryPda();
    const [run] = runPda(wallet.publicKey);
    return { program, connection, wallet, treasury, run };
  }, [wallet, connection]);
}
