import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (client !== undefined) {
    return client;
  }

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url === undefined || key === undefined) {
    throw new Error("Supabase client environment is not configured.");
  }

  client = createClient(url, key);
  return client;
}
