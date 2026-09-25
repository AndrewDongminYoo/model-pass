import {
  createListPublicOpportunitiesHandler,
  listPublicOpportunities,
  type OpportunitySummaryRow,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;

const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const now = new Date("2026-09-25T03:00:00.000Z");

function row(
  id: string,
  overrides: Partial<OpportunitySummaryRow> = {},
): OpportunitySummaryRow {
  return {
    id,
    category: "hair_promotion",
    title: "Hair promotion model",
    starts_at: "2026-09-29T03:00:00.000Z",
    closes_at: "2026-09-28T03:00:00.000Z",
    closed_at: null,
    venue_district: "서울 강남구",
    expected_minutes: 120,
    benefit: {
      type: "procedure",
      description: "Free haircut",
      internal_note: "Never expose this.",
    },
    status: "published",
    recruiter_id: "private-recruiter-id",
    ...overrides,
  };
}

registerTest(
  "returns only active published opportunity summaries in appointment order",
  async () => {
    // Production break: a draft, closed, or expired row appears on the public home screen.
    const result = await listPublicOpportunities({
      now: () => now,
      loadActiveOpportunities: () =>
        Promise.resolve([
          row("later"),
          row("draft", { status: "draft" }),
          row("closed", { closed_at: "2026-09-25T02:00:00.000Z" }),
          row("expired", { closes_at: "2026-09-25T03:00:00.000Z" }),
          row("sooner", {
            category: "makeup_certification",
            title: "Makeup exam model",
            starts_at: "2026-09-27T03:00:00.000Z",
            closes_at: "2026-09-26T03:00:00.000Z",
            benefit: {
              type: "cash",
              amount: 50000,
              description: "Cash after the exam",
              internal_note: "Never expose this.",
            },
          }),
        ]),
    });

    assertEquals(result, [
      {
        id: "sooner",
        category: "makeup_certification",
        title: "Makeup exam model",
        startsAt: "2026-09-27T03:00:00.000Z",
        closesAt: "2026-09-26T03:00:00.000Z",
        venueDistrict: "서울 강남구",
        expectedMinutes: 120,
        benefit: {
          type: "cash",
          amount: 50000,
          description: "Cash after the exam",
        },
      },
      {
        id: "later",
        category: "hair_promotion",
        title: "Hair promotion model",
        startsAt: "2026-09-29T03:00:00.000Z",
        closesAt: "2026-09-28T03:00:00.000Z",
        venueDistrict: "서울 강남구",
        expectedMinutes: 120,
        benefit: { type: "procedure", description: "Free haircut" },
      },
    ]);
  },
);

registerTest("caps the public response to twelve opportunities", async () => {
  // Production break: a query change makes the public response unbounded.
  const result = await listPublicOpportunities({
    now: () => now,
    loadActiveOpportunities: () =>
      Promise.resolve(
        Array.from({ length: 13 }, (_, index) => row(String(index))),
      ),
  });

  assertEquals(result.length, 12);
});

registerTest(
  "supports browser preflight and rejects non-POST reads",
  async () => {
    const handler = createListPublicOpportunitiesHandler({
      now: () => now,
      loadActiveOpportunities: () => Promise.resolve([]),
    });
    const url = "http://localhost/functions/v1/list-public-opportunities";

    const preflight = await handler(new Request(url, { method: "OPTIONS" }));
    assertEquals(preflight.status, 204);
    assertEquals(
      preflight.headers.get("Access-Control-Allow-Headers"),
      "authorization, x-client-info, apikey, content-type",
    );
    const get = await handler(new Request(url, { method: "GET" }));
    assertEquals(get.status, 405);
  },
);

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}
