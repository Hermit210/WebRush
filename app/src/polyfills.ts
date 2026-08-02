// @solana/web3.js and the wallet-adapter packages assume Node's Buffer/
// global exist (they're written for a bundler like webpack that shims
// these automatically). Vite does not, so without this, PublicKey/Buffer
// calls throw `ReferenceError: Buffer is not defined` at module-load time --
// before React ever mounts, producing a silent blank page with no visible
// error boundary. Must be imported first, before anything that touches
// web3.js (see main.tsx).
import { Buffer } from "buffer";

(window as any).Buffer = window.Buffer ?? Buffer;
(window as any).global = window.global ?? window;
