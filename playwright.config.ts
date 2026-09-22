import { defineConfig, devices } from "@playwright/test";
import { resolveLocalSupabasePublicEnvironment } from "./e2e/local-supabase";

const localSupabase = resolveLocalSupabasePublicEnvironment();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "pnpm build && pnpm vite preview --host 127.0.0.1 --port 4173",
    env: {
      VITE_SUPABASE_URL: localSupabase.apiUrl,
      VITE_SUPABASE_ANON_KEY: localSupabase.anonKey,
    },
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
