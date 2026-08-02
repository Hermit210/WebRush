import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function ConnectScreen() {
  return (
    <div className="card">
      <h1>WebRush</h1>
      <p className="subtitle">
        Swing building to building. Cash out before you miss. Devnet only.
      </p>
      <WalletMultiButton style={{ width: "100%" }} />
    </div>
  );
}
