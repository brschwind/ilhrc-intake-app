import { createClient } from "@supabase/supabase-js";

let cachedClient;
let cachedConfiguration = "";

export function createConnectionsSupabaseClientFromEnvironment(environment = {}) {
  const url = environment.VITE_CONNECTIONS_SUPABASE_URL;
  const anonymousKey = environment.VITE_CONNECTIONS_SUPABASE_ANON_KEY;
  if (!url || !anonymousKey) throw new Error("Connections data is not configured for this environment.");

  const configuration = `${url}\n${anonymousKey}`;
  if (!cachedClient || cachedConfiguration !== configuration) {
    cachedClient = createClient(url, anonymousKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "ilhrc-connections-auth",
      },
    });
    cachedConfiguration = configuration;
  }
  return cachedClient;
}
