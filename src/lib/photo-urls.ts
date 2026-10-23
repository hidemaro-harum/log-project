import { getBrowserClient } from "./browser-client";
import { createExpiringUrlCache } from "./expiring-url-cache";

const lifetimeSeconds = 60 * 60;
const cache = createExpiringUrlCache(
  async (path) => {
    const client = getBrowserClient();
    if (!client) return null;
    const { data, error } = await client.storage
      .from("food-photos")
      .createSignedUrl(path, lifetimeSeconds);
    return error ? null : (data?.signedUrl ?? null);
  },
  (lifetimeSeconds - 60) * 1000,
);

export const getSignedPhotoUrl = cache.get;
export const clearPhotoUrlCache = cache.clear;
