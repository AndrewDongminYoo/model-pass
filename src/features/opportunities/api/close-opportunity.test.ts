import { afterEach, expect, it, vi } from "vitest";
import {
  closeOpportunity,
  getRecruiterOpportunityState,
} from "./close-opportunity";

const { invokeMock, fromMock, maybeSingleMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  fromMock: vi.fn(),
  maybeSingleMock: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  getSupabaseClient: () => ({
    functions: { invoke: invokeMock },
    from: fromMock,
  }),
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

it("reads the owned opportunity state before offering selection", async () => {
  const opportunityId = "00000000-0000-4000-8000-000000000011";
  const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  fromMock.mockReturnValue({ select: selectMock });
  maybeSingleMock.mockResolvedValue({
    data: {
      status: "closed",
      closed_at: "2026-09-23T01:00:00.000Z",
      closes_at: "2099-09-24T01:00:00.000Z",
      starts_at: "2099-09-25T01:00:00.000Z",
      rules_snapshot: [
        {
          id: "hair-length",
          field: "hairLength",
          operator: "equals",
          expected: true,
          effect: "hard_fail",
          reason: "Long hair required.",
          question: {
            en: "Is your hair at least shoulder length?",
            ko: "현재 머리카락이 어깨 아래까지 내려오나요?",
          },
        },
      ],
    },
    error: null,
  });

  await expect(getRecruiterOpportunityState(opportunityId)).resolves.toEqual({
    status: "closed",
    canSelect: false,
    rules: [
      {
        id: "hair-length",
        field: "hairLength",
        operator: "equals",
        expected: true,
        effect: "hard_fail",
        reason: "Long hair required.",
        question: {
          en: "Is your hair at least shoulder length?",
          ko: "현재 머리카락이 어깨 아래까지 내려오나요?",
        },
      },
    ],
  });
  expect(fromMock).toHaveBeenCalledWith("opportunities");
  expect(eqMock).toHaveBeenCalledWith("id", opportunityId);
});
