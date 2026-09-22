import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ApplicantPrivacyResult } from "../api/applicant-privacy";
import { I18nProvider } from "../../../i18n/I18nProvider";
import { LanguageSwitch } from "../../../i18n/LanguageSwitch";
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
    screen.getByRole("button", { name: "향후 모집 알림 동의 철회" }),
  );

  expect(
    screen.getByRole("button", { name: "향후 모집 알림 동의 철회" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "개인정보 삭제 요청" }),
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
    await screen.findByText("향후 모집 알림 동의를 철회했습니다."),
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

  expect(screen.getByText(/법정 보관 의무/)).toBeVisible();
  expect(screen.getByText(/즉시 삭제되지 않을 수 있습니다/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "개인정보 삭제 요청" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "삭제 요청을 접수했습니다. 기록은 즉시 삭제되지 않을 수 있습니다.",
  );
  expect(manageApplicantPrivacyMock).toHaveBeenCalledWith({
    ...capability,
    action: "request_deletion",
  });
});

it("translates an existing privacy status when the language changes", async () => {
  window.localStorage.removeItem("model-pass-locale");
  const user = userEvent.setup();
  manageApplicantPrivacyMock.mockResolvedValueOnce({
    action: "request_deletion",
    status: "pending",
  });
  render(
    <I18nProvider>
      <LanguageSwitch />
      <ApplicantPrivacyControls capability={capability} />
    </I18nProvider>,
  );

  await user.click(screen.getByRole("button", { name: "개인정보 삭제 요청" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "삭제 요청을 접수했습니다.",
  );
  await user.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Your deletion request is pending.",
  );
});

it("offers a retry after a privacy request fails and reuses the same action", async () => {
  // Production break: dropping a failed request or changing its command makes a retry unsafe and leaves the applicant without recovery.
  const user = userEvent.setup();
  manageApplicantPrivacyMock
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ action: "request_deletion", status: "pending" });
  render(<ApplicantPrivacyControls capability={capability} />);

  await user.click(screen.getByRole("button", { name: "개인정보 삭제 요청" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "요청을 보내지 못했습니다. 다시 시도해 주세요.",
  );
  await user.click(screen.getByRole("button", { name: "다시 시도" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "삭제 요청을 접수했습니다. 기록은 즉시 삭제되지 않을 수 있습니다.",
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
