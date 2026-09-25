import { afterEach, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({ functions: {} })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  createClientMock.mockClear();
});

it("uses the configured publishable key for the Supabase client", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "legacy-anon-key");
  expect(import.meta.env.VITE_SUPABASE_URL).toBe("https://example.supabase.co");

  const { getSupabaseClient } = await import("./client");
  getSupabaseClient();

  expect(createClientMock).toHaveBeenCalledWith(
    "https://example.supabase.co",
    "sb_publishable_example",
  );
});

it("keeps the local legacy anon-key configuration working", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "legacy-anon-key");

  const { getSupabaseClient } = await import("./client");
  getSupabaseClient();

  expect(createClientMock).toHaveBeenCalledWith(
    "http://127.0.0.1:54321",
    "legacy-anon-key",
  );
});
