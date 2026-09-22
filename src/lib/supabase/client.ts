import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (client !== undefined) {
    return client;
  }

  const environment = (
    import.meta as ImportMeta & {
      readonly env: Record<string, string | undefined>;
    }
  ).env;
  const url = environment.VITE_SUPABASE_URL;
  const anonKey = environment.VITE_SUPABASE_ANON_KEY;
  if (url === undefined || anonKey === undefined) {
    throw new Error("Supabase client environment is not configured.");
  }

  client = createClient(url, anonKey);
  return client;
}
