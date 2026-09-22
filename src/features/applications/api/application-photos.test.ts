import { afterEach, expect, it, vi } from "vitest";

const { fromMock, getUserMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  getSupabaseClient: () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  }),
}));

import {
  RecruiterAuthenticationError,
  getRecruiterApplications,
} from "./application-photos";

afterEach(() => {
  vi.clearAllMocks();
});

it("rejects an unauthenticated recruiter before starting an RLS read", async () => {
  // Production break: an anonymous RLS read looks like an empty applicant list instead of an authentication failure.
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });

  await expect(
    getRecruiterApplications("00000000-0000-4000-8000-000000000001"),
  ).rejects.toBeInstanceOf(RecruiterAuthenticationError);
  expect(fromMock).not.toHaveBeenCalled();
});

it("orders authenticated applications by created_at and application ID", async () => {
  // Production break: one-column ordering is unstable when two submissions share the same timestamp.
  getUserMock.mockResolvedValue({
    data: { user: { id: "00000000-0000-4000-8000-000000000401" } },
    error: null,
  });
  const orderMock = vi.fn();
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: orderMock,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  orderMock.mockReturnValueOnce(query).mockResolvedValueOnce({
    data: [applicationRow("102"), applicationRow("101")],
    error: null,
  });
  fromMock.mockReturnValue(query);

  const applications = await getRecruiterApplications(
    "00000000-0000-4000-8000-000000000001",
  );

  expect(orderMock).toHaveBeenNthCalledWith(1, "created_at", {
    ascending: true,
  });
  expect(orderMock).toHaveBeenNthCalledWith(2, "id", { ascending: true });
  expect(applications.map(({ id }) => id)).toEqual([
    "00000000-0000-4000-8000-000000000101",
    "00000000-0000-4000-8000-000000000102",
  ]);
});

function applicationRow(idSuffix: string) {
  return {
    id: `00000000-0000-4000-8000-000000000${idSuffix}`,
    created_at: "2026-09-22T03:00:00.000Z",
    applicant_display_name: `Applicant ${idSuffix}`,
    applicant_phone: "010-1234-5678",
    evaluation_snapshot: {
      rulesetId: "hair-promotion",
      rulesetVersion: 1,
      eligible: true,
      failures: [],
      reviews: [],
      reminders: [],
    },
    application_answers: [],
    application_photos: [],
    attendance_events: [],
  };
}
