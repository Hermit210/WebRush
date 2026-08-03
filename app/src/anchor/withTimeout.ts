/**
 * Wraps a promise with a hard client-side deadline. Needed because a stuck
 * devnet RPC (rate-limited, slow to confirm, or a dropped websocket
 * subscription) can otherwise leave a transaction confirmation hanging
 * indefinitely with no feedback -- the UI just sits on "Confirming
 * transaction..." forever. This guarantees the user sees a clear error
 * within `ms`, regardless of what the underlying library/RPC does.
 */
export class TransactionTimeoutError extends Error {}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TransactionTimeoutError(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
