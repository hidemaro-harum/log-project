/** Share in-flight requests, expire signed URLs, and allow a failed request to retry. */
export function createExpiringUrlCache(
  resolve: (path: string) => Promise<string | null>,
  lifetimeMs: number,
  now: () => number = Date.now,
) {
  const entries = new Map<
    string,
    { expiresAt: number; promise: Promise<string | null> }
  >();

  return {
    get(path: string) {
      const cached = entries.get(path);
      if (cached && cached.expiresAt > now()) return cached.promise;
      const entry = {
        expiresAt: now() + lifetimeMs,
        promise: Promise.resolve()
          .then(() => resolve(path))
          .catch(() => null)
          .then((url) => {
            // An older failed request must not evict a newer request for the same path.
            if (!url && entries.get(path) === entry) entries.delete(path);
            return url;
          }),
      };
      entries.set(path, entry);
      return entry.promise;
    },
    clear() {
      entries.clear();
    },
  };
}
