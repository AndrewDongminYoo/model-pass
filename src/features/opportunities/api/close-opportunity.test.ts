import { afterEach, expect, it, vi } from "vitest";
import { closeOpportunity } from "./close-opportunity";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  getSupabaseClient: () => ({ functions: { invoke: invokeMock } }),
}));

afterEach(() => vi.clearAllMocks());

it("requests a server-controlled closure without a caller-supplied recruiter id", async () => {
  const opportunityId = "00000000-0000-4000-8000-000000000011";
  const closedAt = "2026-09-23T01:00:00.000Z";
  invokeMock.mockResolvedValue({
    data: { opportunityId, status: "closed", closedAt },
    error: null,
  });

  await expect(closeOpportunity(opportunityId)).resolves.toEqual({
    opportunityId,
    status: "closed",
    closedAt,
  });
  expect(invokeMock).toHaveBeenCalledWith("close-opportunity", {
    body: { opportunityId },
  });
});
