import assert from "node:assert/strict";
import test from "node:test";
import { createExpiringUrlCache } from "./expiring-url-cache.ts";

test("shares in-flight requests and refreshes expired signed URLs", async () => {
  let time = 0;
  let calls = 0;
  const cache = createExpiringUrlCache(
    async () => `url-${++calls}`,
    100,
    () => time,
  );
  const first = cache.get("photo");
  assert.equal(first, cache.get("photo"));
  assert.equal(await first, "url-1");
  time = 100;
  assert.equal(await cache.get("photo"), "url-2");
});

test("failed requests are retryable and clearing the session invalidates cached URLs", async () => {
  let calls = 0;
  const cache = createExpiringUrlCache(async () => {
    if (++calls === 1) throw new Error("offline");
    return `url-${calls}`;
  }, 1000);
  assert.equal(await cache.get("photo"), null);
  assert.equal(await cache.get("photo"), "url-2");
  cache.clear();
  assert.equal(await cache.get("photo"), "url-3");
});

test("a stale failed request does not evict a new session's request", async () => {
  let complete!: (url: string | null) => void;
  const cache = createExpiringUrlCache(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    1000,
  );
  const old = cache.get("photo");
  await Promise.resolve();
  const completeOld = complete;
  cache.clear();
  const fresh = cache.get("photo");
  await Promise.resolve();
  completeOld(null);
  await old;
  assert.equal(cache.get("photo"), fresh);
  complete("fresh");
  assert.equal(await fresh, "fresh");
});
