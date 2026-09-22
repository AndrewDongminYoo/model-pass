import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ApplicantPrivacyResult } from "../api/applicant-privacy";
import { ApplicantPrivacyControls } from "./ApplicantPrivacyControls";

const { manageApplicantPrivacyMock } = vi.hoisted(() => ({
  manageApplicantPrivacyMock: vi.fn(),
}));

vi.mock("../api/applicant-privacy", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../api/applicant-privacy")>();
  return { ...original, manageApplicantPrivacy: manageApplicantPrivacyMock };
});

const capability = {
  applicationId: "00000000-0000-4000-8000-000000000011",
  opportunityId: "00000000-0000-4000-8000-000000000001",
  submissionAttemptId: "00000000-0000-4000-8000-000000000021",
};

afterEach(() => vi.clearAllMocks());

it("keeps applicant capability values out of rendered privacy controls", () => {
  // Production break: rendering a bearer capability exposes credentials that should only travel with a privacy command.
  render(<ApplicantPrivacyControls capability={capability} />);

  expect(screen.queryByText(capability.applicationId)).not.toBeInTheDocument();
  expect(screen.queryByText(capability.opportunityId)).not.toBeInTheDocument();
  expect(
    screen.queryByText(capability.submissionAttemptId),
  ).not.toBeInTheDocument();
});

it("revokes future-opportunity consent and disables both actions while the request is pending", async () => {
  // Production break: leaving either action enabled permits duplicate or conflicting privacy requests while the capability is in flight.
  const user = userEvent.setup();
  const request = deferred<ApplicantPrivacyResult>();
  manageApplicantPrivacyMock.mockReturnValueOnce(request.promise);
  render(<ApplicantPrivacyControls capability={capability} />);

  await user.click(
    screen.getByRole("button", { name: "Revoke future-opportunity consent" }),
  );

  expect(
    screen.getByRole("button", { name: "Revoke future-opportunity consent" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Request deletion" }),
  ).toBeDisabled();
  expect(manageApplicantPrivacyMock).toHaveBeenCalledWith({
    ...capability,
    action: "revoke_future_opportunity_consent",
  });

  request.resolve({
    action: "revoke_future_opportunity_consent",
    status: "accepted",
  });

  expect(
    await screen.findByText("Future-opportunity consent has been revoked."),
  ).toHaveAttribute("role", "status");
});

it("shows a pending deletion request without promising immediate erasure", async () => {
  // Production break: describing a pending request as deleted misstates the retention-boundary result to an applicant.
  const user = userEvent.setup();
  manageApplicantPrivacyMock.mockResolvedValueOnce({
    action: "request_deletion",
    status: "pending",
  });
  render(<ApplicantPrivacyControls capability={capability} />);

  expect(screen.getByText(/subject to retention obligations/i)).toBeVisible();
  expect(screen.getByText(/does not immediately erase records/i)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Request deletion" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Your deletion request is pending. Records are not immediately erased.",
  );
  expect(manageApplicantPrivacyMock).toHaveBeenCalledWith({
    ...capability,
    action: "request_deletion",
  });
});

it("offers a retry after a privacy request fails and reuses the same action", async () => {
  // Production break: dropping a failed request or changing its command makes a retry unsafe and leaves the applicant without recovery.
  const user = userEvent.setup();
  manageApplicantPrivacyMock
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ action: "request_deletion", status: "pending" });
  render(<ApplicantPrivacyControls capability={capability} />);

  await user.click(screen.getByRole("button", { name: "Request deletion" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not submit your privacy request. You can retry safely.",
  );
  await user.click(
    screen.getByRole("button", { name: "Retry privacy request" }),
  );

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Your deletion request is pending. Records are not immediately erased.",
  );
  expect(manageApplicantPrivacyMock).toHaveBeenNthCalledWith(2, {
    ...capability,
    action: "request_deletion",
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
