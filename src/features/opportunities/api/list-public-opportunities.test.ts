import { afterEach, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  getSupabaseClient: () => ({ functions: { invoke: invokeMock } }),
}));

afterEach(() => invokeMock.mockReset());

it("loads public opportunity summaries without recruiter authentication", async () => {
  // Production break: home asks a protected recruiter endpoint for the cards.
  invokeMock.mockResolvedValue({
    data: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        category: "hair_promotion",
        title: "Hair promotion model",
        startsAt: "2026-09-29T03:00:00.000Z",
        closesAt: "2026-09-28T03:00:00.000Z",
        venueDistrict: "서울 강남구",
        expectedMinutes: 120,
        benefit: { type: "procedure", description: "Free haircut" },
      },
    ],
    error: null,
  });

  const { listPublicOpportunities } =
    await import("./list-public-opportunities");
  const opportunities = await listPublicOpportunities();

  expect(opportunities).toHaveLength(1);
  expect(opportunities[0]?.title).toBe("Hair promotion model");
  expect(invokeMock).toHaveBeenCalledWith("list-public-opportunities");
});

it("rejects an invalid public list response", async () => {
  // Production break: malformed server data silently becomes an empty list.
  invokeMock.mockResolvedValue({ data: [{ id: "broken" }], error: null });

  const { listPublicOpportunities } =
    await import("./list-public-opportunities");

  await expect(listPublicOpportunities()).rejects.toThrow(
    "The opportunity list response is invalid.",
  );
});
