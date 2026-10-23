import { createClient } from "./supabase";

// Share the browser session between the app and photo components.
let client: ReturnType<typeof createClient> | undefined;

export function getBrowserClient() {
  if (client === undefined) client = createClient();
  return client;
}
