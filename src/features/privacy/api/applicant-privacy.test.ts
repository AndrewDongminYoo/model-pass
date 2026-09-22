import { afterEach, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  getSupabaseClient: () => ({ functions: { invoke: invokeMock } }),
}));

import { manageApplicantPrivacy } from "./applicant-privacy";

const capability = {
  applicationId: "00000000-0000-4000-8000-000000000011",
  opportunityId: "00000000-0000-4000-8000-000000000001",
  submissionAttemptId: "00000000-0000-4000-8000-000000000021",
};

afterEach(() => {
  vi.clearAllMocks();
});

it("invokes the privacy function with the exact applicant capability", async () => {
  invokeMock.mockResolvedValue({
    data: { action: "request_deletion", status: "pending" },
    error: null,
  });

  await expect(
    manageApplicantPrivacy({ ...capability, action: "request_deletion" }),
  ).resolves.toEqual({ action: "request_deletion", status: "pending" });
  expect(invokeMock).toHaveBeenCalledWith("manage-applicant-privacy", {
    body: { ...capability, action: "request_deletion" },
  });
});

it("rejects a response that promises completed deletion", async () => {
  invokeMock.mockResolvedValue({
    data: { action: "request_deletion", status: "deleted" },
    error: null,
  });

  await expect(
    manageApplicantPrivacy({ ...capability, action: "request_deletion" }),
  ).rejects.toThrow("invalid");
});
