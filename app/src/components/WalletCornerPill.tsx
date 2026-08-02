import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

/**
 * Persistent, corner-positioned wallet control -- replaces the old
 * full-screen connect gate. Visible across menu/in-run/result so the
 * player's connection state is always glanceable, the same way a mobile
 * game keeps currency/settings icons in a fixed corner instead of
 * demanding login before showing anything (see README "Stage D").
 *
 * Reuses the exact same WalletMultiButton/WalletModalProvider wiring
 * already in App.tsx -- no wallet-adapter logic changes, just placement.
 */
export function WalletCornerPill() {
  return (
    <div className="wallet-corner-pill">
      <WalletMultiButton />
    </div>
  );
}
