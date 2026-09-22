import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../../app/App";
import type { PublicOpportunity } from "../api/get-public-opportunity";
import {
  ApplicationSubmissionError,
  parseApplicationSubmissionHttpError,
} from "../api/submit-application";
import { ApplyPage } from "../routes/ApplyPage";
import { ApplicationForm } from "./ApplicationForm";

const {
  getApplicationPhotoStatusMock,
  getAttendanceMock,
  getPublicOpportunityMock,
  submitApplicationMock,
  uploadApplicationPhotoMock,
} = vi.hoisted(() => ({
  getApplicationPhotoStatusMock: vi.fn(),
  getAttendanceMock: vi.fn(),
  getPublicOpportunityMock: vi.fn(),
  submitApplicationMock: vi.fn(),
  uploadApplicationPhotoMock: vi.fn(),
}));

vi.mock("../api/attendance", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/attendance")>();
  return { ...original, getAttendance: getAttendanceMock };
});

vi.mock("../api/get-public-opportunity", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../api/get-public-opportunity")>();
  return { ...original, getPublicOpportunity: getPublicOpportunityMock };
});

vi.mock("../api/submit-application", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../api/submit-application")>();
  return { ...original, submitApplication: submitApplicationMock };
});

vi.mock("../api/application-photos", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../api/application-photos")>();
  return {
    ...original,
    getApplicationPhotoStatus: getApplicationPhotoStatusMock,
    uploadApplicationPhoto: uploadApplicationPhotoMock,
  };
});

const opportunityId = "00000000-0000-4000-8000-000000000001";
const applicationId = "00000000-0000-4000-8000-000000000101";
const pendingAttemptId = "00000000-0000-4000-8000-000000000201";
const pendingStorageKey = `model-pass:pending-photo:${opportunityId}`;
const attendanceStorageKey = `model-pass:attendance:${opportunityId}`;
const makeupOpportunity: PublicOpportunity = {
  id: opportunityId,
  category: "makeup_certification",
  title: "Makeup certification practical exam",
  startsAt: "2099-06-01T10:00:00.000Z",
  closesAt: "2099-05-31T10:00:00.000Z",
  venueDistrict: "서울 강남구",
  expectedMinutes: 120,
  benefit: {
    type: "cash",
    amount: 100000,
    description: "Cash after the exam",
  },
  rulesetId: "makeup-certification",
  rulesetVersion: 1,
  rules: [
    {
      id: "adult-only",
      field: "isAdult",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason: "This pilot is available to adults only.",
    },
    {
      id: "schedule-available",
      field: "isAvailable",
      operator: "equals",
      expected: true,
      effect: "hard_fail",
      reason: "This schedule is unavailable.",
    },
    {
      id: "remove-lenses",
      field: "wearsLenses",
      operator: "equals",
      expected: false,
      effect: "reminder",
      reason: "Remove lenses before the appointment.",
    },
  ],
};
const photoOpportunity: PublicOpportunity = {
  ...makeupOpportunity,
  category: "hair_promotion",
  title: "Hair promotion exam",
  rulesetId: "hair-photo",
  rules: [
    makeupOpportunity.rules[0],
    makeupOpportunity.rules[1],
    {
      id: "photo-required",
      field: "requestedPhoto",
      operator: "equals",
      expected: true,
      effect: "needs_review",
      reason: "Upload the requested job-specific photo.",
    },
  ],
};

beforeEach(() => {
  getAttendanceMock.mockResolvedValue({
    applicationId,
    viewerParty: "applicant",
    selected: true,
    allowedActions: ["applicant_confirmed"],
    events: [],
  });
});

it("keeps a submitted applicant in the waiting state until recruiter selection", async () => {
  // Production break: showing attendance controls immediately after submission bypasses the recruiter decision.
  getAttendanceMock.mockResolvedValue({
    applicationId,
    viewerParty: "applicant",
    selected: false,
    allowedActions: [],
    events: [],
  });
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  expect(
    await screen.findByText("모집자의 선택을 기다리고 있습니다."),
  ).toHaveAttribute("role", "status");
  expect(
    screen.queryByRole("button", { name: "참여 확정" }),
  ).not.toBeInTheDocument();
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

it("restores a valid opportunity-scoped pending photo capability", async () => {
  // Production break: a reload after contact submission can strand a private draft before its required photo is supplied.
  localStorage.setItem(
    pendingStorageKey,
    JSON.stringify(pendingPhotoCapability()),
  );
  let resolveStatus: ((value: { status: "pending" }) => void) | undefined;
  getApplicationPhotoStatusMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
  );
  render(<ApplicationForm opportunity={photoOpportunity} />);

  expect(screen.getByRole("status")).toHaveTextContent(
    "사진 제출 상태를 확인하고 있습니다…",
  );
  expect(
    screen.queryByLabelText("이 공고에서 요청한 사진"),
  ).not.toBeInTheDocument();
  await act(async () => {
    resolveStatus?.({ status: "pending" });
  });
  expect(
    await screen.findByRole("heading", {
      name: "사진을 올려야 지원이 완료됩니다",
    }),
  ).toBeVisible();
  expect(screen.queryByLabelText("이름 또는 별명")).not.toBeInTheDocument();

  const file = new File([new Uint8Array([1])], "requested.jpg", {
    type: "image/jpeg",
  });
  uploadApplicationPhotoMock.mockResolvedValue({
    applicationId,
    photoId: "00000000-0000-4000-8000-000000000301",
    submissionState: "submitted",
  });
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("이 공고에서 요청한 사진"), file);
  await user.click(screen.getByRole("button", { name: "사진 올리기" }));

  expect(uploadApplicationPhotoMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
    submissionAttemptId: pendingAttemptId,
    file,
  });
  expect(getApplicationPhotoStatusMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
    submissionAttemptId: pendingAttemptId,
  });
});

it("restores a receipt when another tab already completed the photo", async () => {
  // Production break: asking for another file after authoritative completion creates needless sensitive-data collection.
  localStorage.setItem(
    pendingStorageKey,
    JSON.stringify(pendingPhotoCapability()),
  );
  getApplicationPhotoStatusMock.mockResolvedValue({
    status: "submitted",
    applicationId,
    photoId: "00000000-0000-4000-8000-000000000301",
  });
  render(<ApplicationForm opportunity={photoOpportunity} />);

  expect(
    await screen.findByRole("heading", { name: "지원서를 받았습니다" }),
  ).toBeVisible();
  expect(screen.getByText(`접수 번호: ${applicationId}`)).toBeVisible();
  expect(screen.getByRole("region", { name: "개인정보 관리" })).toBeVisible();
  expect(
    screen.queryByLabelText("이 공고에서 요청한 사진"),
  ).not.toBeInTheDocument();
  expect(uploadApplicationPhotoMock).not.toHaveBeenCalled();
  expect(localStorage.getItem(pendingStorageKey)).toBeNull();
});

it("clears an unavailable restored capability with an explicit message", async () => {
  // Production break: an early closure or non-pending server state must not leave a stale picker or generic upload error.
  localStorage.setItem(
    pendingStorageKey,
    JSON.stringify(pendingPhotoCapability()),
  );
  getApplicationPhotoStatusMock.mockResolvedValue({ status: "unavailable" });
  render(<ApplicationForm opportunity={photoOpportunity} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "이 사진 제출은 더 이상 이어서 진행할 수 없습니다.",
  );
  expect(
    screen.queryByLabelText("이 공고에서 요청한 사진"),
  ).not.toBeInTheDocument();
  expect(localStorage.getItem(pendingStorageKey)).toBeNull();
});

it("keeps the capability but shows an explicit status error", async () => {
  // Production break: a transient status failure must not expose the picker or destroy a retryable capability.
  localStorage.setItem(
    pendingStorageKey,
    JSON.stringify(pendingPhotoCapability()),
  );
  getApplicationPhotoStatusMock.mockRejectedValue(
    new Error("status unavailable"),
  );
  render(<ApplicationForm opportunity={photoOpportunity} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "사진 제출 상태를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.",
  );
  expect(
    screen.queryByLabelText("이 공고에서 요청한 사진"),
  ).not.toBeInTheDocument();
  expect(localStorage.getItem(pendingStorageKey)).not.toBeNull();
});

it("ignores a restored status response after unmount", async () => {
  // Production break: a late route response must not clear capability data or update an application form that has left the page.
  localStorage.setItem(
    pendingStorageKey,
    JSON.stringify(pendingPhotoCapability()),
  );
  let resolveStatus:
    | ((value: {
        status: "submitted";
        applicationId: string;
        photoId: string;
      }) => void)
    | undefined;
  getApplicationPhotoStatusMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
  );
  const view = render(<ApplicationForm opportunity={photoOpportunity} />);
  view.unmount();

  await act(async () => {
    resolveStatus?.({
      status: "submitted",
      applicationId,
      photoId: "00000000-0000-4000-8000-000000000301",
    });
  });

  expect(localStorage.getItem(pendingStorageKey)).not.toBeNull();
});

it("rejects and clears expired or ruleset-mismatched pending capabilities", () => {
  // Production break: stale local capability data must not render a photo upload surface for another ruleset or after closure.
  for (const stored of [
    { ...pendingPhotoCapability(), expiresAt: "2020-01-01T00:00:00.000Z" },
    { ...pendingPhotoCapability(), rulesetVersion: 2 },
  ]) {
    localStorage.setItem(pendingStorageKey, JSON.stringify(stored));
    const view = render(<ApplicationForm opportunity={photoOpportunity} />);
    expect(
      screen.queryByRole("heading", {
        name: "사진을 올려야 지원이 완료됩니다",
      }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(pendingStorageKey)).toBeNull();
    view.unmount();
  }
});

it("persists only the minimal pending photo capability and clears it on completion", async () => {
  // Production break: persisting application form state can place contact data, answers, consent, or photo bytes in localStorage.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue(pendingPhotoSubmission());
  uploadApplicationPhotoMock.mockResolvedValue({
    applicationId,
    photoId: "00000000-0000-4000-8000-000000000301",
    submissionState: "submitted",
  });
  render(<ApplicationForm opportunity={photoOpportunity} />);
  await answerBooleanQuestion(user, "만 19세 이상인가요?", true);
  await answerBooleanQuestion(user, "모집 일정에 참여할 수 있나요?", true);
  await user.click(screen.getByRole("button", { name: "지원 조건 확인" }));
  await user.click(screen.getByRole("button", { name: "지원서 작성하기" }));
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  const stored = localStorage.getItem(pendingStorageKey);
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored ?? "{}")).toEqual({
    applicationId,
    submissionAttemptId:
      submitApplicationMock.mock.calls[0]?.[0].submissionAttemptId,
    rulesetId: photoOpportunity.rulesetId,
    rulesetVersion: photoOpportunity.rulesetVersion,
    expiresAt: photoOpportunity.closesAt,
  });
  expect(stored).not.toContain("Applicant");
  expect(stored).not.toContain("010-1234-5678");
  expect(stored).not.toContain("2000-09-22");
  expect(stored).not.toContain("isAvailable");
  expect(stored).not.toContain("Consent");

  await user.upload(
    screen.getByLabelText("이 공고에서 요청한 사진"),
    new File([new Uint8Array([1])], "requested.jpg", { type: "image/jpeg" }),
  );
  await user.click(screen.getByRole("button", { name: "사진 올리기" }));
  expect(
    await screen.findByRole("heading", { name: "지원서를 받았습니다" }),
  ).toBeVisible();
  expect(localStorage.getItem(pendingStorageKey)).toBeNull();
});

it("clears capability data after a non-photo submission", async () => {
  // Production break: unrelated successful applications must not leave stale photo authority in browser storage.
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  localStorage.setItem(
    pendingStorageKey,
    JSON.stringify(pendingPhotoCapability()),
  );
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  await reachApplicationForm(user);
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  expect(localStorage.getItem(pendingStorageKey)).toBeNull();
});

it("explains the exact deterministic hard failure without requesting a photo", async () => {
  // Production break: continuing after a hard fail collects sensitive photo or contact data unnecessarily.
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  await answerBooleanQuestion(user, "만 19세 이상인가요?", false);
  await answerBooleanQuestion(user, "모집 일정에 참여할 수 있나요?", true);
  await answerBooleanQuestion(
    user,
    "시험 당일 렌즈를 착용할 예정인가요?",
    false,
  );
  await user.click(screen.getByRole("button", { name: "지원 조건 확인" }));

  expect(screen.getByText("만 19세 이상만 지원할 수 있습니다.")).toBeVisible();
  expect(screen.queryByLabelText("요청된 사진")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("이름 또는 별명")).not.toBeInTheDocument();
});

it("explains photo timing without showing an unusable upload before contact consent", async () => {
  // Production break: collecting contact details before non-photo hard rules pass violates progressive disclosure.
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  await answerAllEligibleQuestions(user);
  await user.click(screen.getByRole("button", { name: "지원 조건 확인" }));

  expect(screen.queryByLabelText("요청된 사진")).not.toBeInTheDocument();
  expect(
    screen.getByText(/이 단계에서는 사진을 올릴 수 없습니다/i),
  ).toBeVisible();
  expect(screen.queryByLabelText("이름 또는 별명")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "지원서 작성하기" }));

  expect(screen.getByLabelText("이름 또는 별명")).toBeVisible();
  expect(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  ).toBeVisible();
});

it("defaults future alerts to unchecked and submits false", async () => {
  // Production break: bundling optional future contact into required current-job consent records false consent.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);

  const futureConsent = screen.getByLabelText(
    "향후 모집 알림을 받겠습니다(선택)",
  );
  expect(futureConsent).not.toBeChecked();
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  expect(submitApplicationMock).toHaveBeenCalledWith({
    opportunityId,
    submissionAttemptId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    ),
    applicant: {
      displayName: "Applicant",
      phone: "010-1234-5678",
      birthDate: "2000-09-22",
    },
    answers: { isAvailable: true, wearsLenses: false },
    currentApplicationConsent: true,
    futureOpportunityConsent: false,
  });
});

it("preserves answers after a recoverable submit error and allows retry", async () => {
  // Production break: clearing personal-data fields after a transient error forces applicants to re-enter them.
  const user = userEvent.setup();
  submitApplicationMock
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce(successfulSubmission());
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );

  await user.click(screen.getByRole("button", { name: "지원서 제출" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "지원서를 제출하지 못했습니다. 다시 시도해 주세요.",
  );
  expect(screen.getByLabelText("이름 또는 별명")).toHaveValue("Applicant");
  expect(
    within(
      screen.getByRole("group", { name: "모집 일정에 참여할 수 있나요?" }),
    ).getByLabelText("예"),
  ).toBeChecked();

  await user.click(screen.getByRole("button", { name: "지원서 제출" }));
  expect(
    await screen.findByRole("heading", { name: "지원서를 받았습니다" }),
  ).toBeVisible();
  expect(submitApplicationMock).toHaveBeenCalledTimes(2);
  const firstAttemptId =
    submitApplicationMock.mock.calls[0]?.[0].submissionAttemptId;
  const secondAttemptId =
    submitApplicationMock.mock.calls[1]?.[0].submissionAttemptId;
  expect(firstAttemptId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  expect(secondAttemptId).toBe(firstAttemptId);
});

it("parses a safe Edge HTTP error body and rejects transport or malformed bodies", async () => {
  // Production break: treating every invocation failure as a network error discards authoritative rule reasons.
  const evaluation = serverHardFailEvaluation();
  const parsed = await parseApplicationSubmissionHttpError(
    new FunctionsHttpError(
      new Response(
        JSON.stringify({
          error: "The application does not satisfy this opportunity's rules.",
          evaluation,
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );

  expect(parsed).toBeInstanceOf(ApplicationSubmissionError);
  expect(parsed?.message).toBe(
    "The application does not satisfy this opportunity's rules.",
  );
  expect(parsed?.evaluation).toEqual(evaluation);
  const validationError = await parseApplicationSubmissionHttpError(
    new FunctionsHttpError(
      new Response(
        JSON.stringify({
          error: "Applicants must be at least 19 years old.",
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  expect(validationError?.message).toBe(
    "Applicants must be at least 19 years old.",
  );
  expect(validationError?.evaluation).toBeUndefined();
  expect(
    await parseApplicationSubmissionHttpError(new Error("Network unavailable")),
  ).toBeNull();
  expect(
    await parseApplicationSubmissionHttpError(
      new FunctionsHttpError(
        new Response(
          JSON.stringify({
            error: "Unsafe malformed response",
            evaluation: { eligible: false },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ),
  ).toBeNull();
});

it("renders authoritative server hard-fail reasons and hides later collection", async () => {
  // Production break: presenting a server rule rejection as retry-only keeps sensitive collection visible.
  const user = userEvent.setup();
  submitApplicationMock.mockRejectedValue(
    new ApplicationSubmissionError(
      "The application does not satisfy this opportunity's rules.",
      serverHardFailEvaluation(),
    ),
  );
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  expect(
    await screen.findByText("모집 일정에 참여할 수 있어야 합니다."),
  ).toBeVisible();
  expect(screen.queryByLabelText("요청된 사진")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("이름 또는 별명")).not.toBeInTheDocument();
  expect(
    screen.queryByText("지원서를 제출하지 못했습니다. 다시 시도해 주세요."),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "지원 조건 확인" }));
  await user.click(screen.getByRole("button", { name: "지원서 작성하기" }));
  expect(screen.getByLabelText("이름 또는 별명")).toHaveValue("Applicant");
});

it("shows a safe server validation message without an evaluation", async () => {
  // Production break: replacing a safe age validation with a generic network message prevents correction.
  const user = userEvent.setup();
  submitApplicationMock.mockRejectedValue(
    new ApplicationSubmissionError("Applicants must be at least 19 years old."),
  );
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "지원자는 만 19세 이상이어야 합니다.",
  );
  expect(screen.getByLabelText("이름 또는 별명")).toHaveValue("Applicant");
});

it("disables a pending submission and prevents a double submit", async () => {
  // Production break: a second click while pending can create duplicate applications.
  const user = userEvent.setup();
  let resolveSubmission:
    ((value: ReturnType<typeof successfulSubmission>) => void) | undefined;
  submitApplicationMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSubmission = resolve;
      }),
  );
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );

  const submitButton = screen.getByRole("button", {
    name: "지원서 제출",
  });
  await user.click(submitButton);
  expect(submitButton).toBeDisabled();
  await user.click(submitButton);
  expect(submitApplicationMock).toHaveBeenCalledTimes(1);

  resolveSubmission?.(successfulSubmission());
  expect(
    await screen.findByRole("heading", { name: "지원서를 받았습니다" }),
  ).toBeVisible();
});

it("associates every eligibility and application validation error with its field", async () => {
  // Production break: visual-only errors leave assistive technology users without field-level guidance.
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  await user.click(screen.getByRole("button", { name: "지원 조건 확인" }));
  for (const label of [
    "만 19세 이상인가요?",
    "모집 일정에 참여할 수 있나요?",
    "시험 당일 렌즈를 착용할 예정인가요?",
  ]) {
    const group = screen.getByRole("group", { name: label });
    expectAssociatedError(group, "예 또는 아니요를 선택해 주세요.");
  }

  await answerAllEligibleQuestions(user);
  await user.click(screen.getByRole("button", { name: "지원 조건 확인" }));
  await user.click(screen.getByRole("button", { name: "지원서 작성하기" }));
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  for (const label of [
    "이름 또는 별명",
    "전화번호",
    "생년월일",
    "이 공고 지원을 위한 개인정보 처리에 동의합니다",
  ]) {
    expectAssociatedError(screen.getByLabelText(label), expect.any(String));
  }
});

it("shows a private receipt without creating public profile UI", async () => {
  // Production break: turning successful submission into a public profile violates the product boundary.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  expect(
    await screen.findByRole("heading", { name: "지원서를 받았습니다" }),
  ).toBeVisible();
  expect(screen.getByText(`접수 번호: ${applicationId}`)).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /profile/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /profile/i }),
  ).not.toBeInTheDocument();
});

it("persists only the applicant attendance capability and restores operable attendance", async () => {
  // Production break: clearing the submission attempt on receipt makes post-close attendance impossible, while persisting the form would retain PII.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  const view = render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  expect(
    await screen.findByRole("button", { name: "참여 확정" }),
  ).toBeEnabled();
  const stored = localStorage.getItem(attendanceStorageKey);
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored ?? "{}")).toEqual({
    applicationId,
    submissionAttemptId:
      submitApplicationMock.mock.calls[0]?.[0].submissionAttemptId,
    expiresAt: "2099-07-01T10:00:00.000Z",
  });
  expect(stored).not.toContain("Applicant");
  expect(stored).not.toContain("010-1234-5678");
  expect(stored).not.toContain("2000-09-22");
  expect(stored).not.toContain("isAvailable");
  expect(stored).not.toContain("Consent");
  expect(getAttendanceMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
    submissionAttemptId:
      submitApplicationMock.mock.calls[0]?.[0].submissionAttemptId,
  });

  view.unmount();
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  expect(
    await screen.findByRole("heading", { name: "지원서를 받았습니다" }),
  ).toBeVisible();
  expect(screen.getByText(`접수 번호: ${applicationId}`)).toBeVisible();
  expect(screen.getByRole("button", { name: "참여 확정" })).toBeEnabled();
});

it("shows the submission attempt as a private management code on a successful receipt", async () => {
  // Production break: a receipt without the submission attempt strands the applicant when browser storage later expires.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);
  await completeContactFields(user);
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  expect(
    await screen.findByRole("heading", { name: "지원서를 받았습니다" }),
  ).toBeVisible();
  const submissionAttemptId =
    submitApplicationMock.mock.calls[0]?.[0].submissionAttemptId;
  expect(screen.getByText(`접수 번호: ${applicationId}`)).toBeVisible();
  expect(
    screen.getByText(`비공개 관리 코드: ${submissionAttemptId}`),
  ).toBeVisible();
  expect(screen.getByText(/다른 사람에게 공유하지 마세요/)).toBeVisible();
});

it("keeps recovery fields out of the primary application flow until requested", () => {
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  expect(screen.getByText("기존 지원 내역 찾기")).toBeVisible();
  expect(screen.getByLabelText("접수 번호")).not.toBeVisible();
});

it("recovers attendance and privacy controls from manually entered UUIDs after attendance storage expires", async () => {
  // Production break: an expired local capability must not permanently remove an applicant's management controls.
  localStorage.setItem(
    attendanceStorageKey,
    JSON.stringify({
      applicationId,
      submissionAttemptId: pendingAttemptId,
      expiresAt: "2020-01-01T00:00:00.000Z",
    }),
  );
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  expect(screen.getByText("기존 지원 내역 찾기")).toBeVisible();
  await user.click(screen.getByText("기존 지원 내역 찾기"));
  await user.type(screen.getByLabelText("접수 번호"), applicationId);
  await user.type(screen.getByLabelText("비공개 관리 코드"), pendingAttemptId);
  await user.click(screen.getByRole("button", { name: "지원 내역 확인" }));

  expect(
    await screen.findByRole("button", { name: "참여 확정" }),
  ).toBeEnabled();
  expect(screen.getByRole("region", { name: "개인정보 관리" })).toBeVisible();
  expect(getAttendanceMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
    submissionAttemptId: pendingAttemptId,
  });
});

it("rejects invalid application recovery identifiers before rendering management controls", async () => {
  // Production break: accepting malformed recovery identifiers can invoke applicant management with an invalid capability.
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  await user.click(screen.getByText("기존 지원 내역 찾기"));
  await user.type(screen.getByLabelText("접수 번호"), "not-a-uuid");
  await user.type(screen.getByLabelText("비공개 관리 코드"), "also-not-a-uuid");
  await user.click(screen.getByRole("button", { name: "지원 내역 확인" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "올바른 접수 번호와 비공개 관리 코드를 입력해 주세요.",
  );
  expect(
    screen.queryByRole("button", { name: "참여 확정" }),
  ).not.toBeInTheDocument();
  expect(getAttendanceMock).not.toHaveBeenCalled();
});

it("keeps manually entered management codes out of the URL and logs", async () => {
  // Production break: serializing a recovery capability into navigation or diagnostics leaks a private management code.
  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  const user = userEvent.setup();
  window.history.replaceState({}, "", `/opportunities/${opportunityId}/apply`);
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  await user.click(screen.getByText("기존 지원 내역 찾기"));
  await user.type(screen.getByLabelText("접수 번호"), applicationId);
  await user.type(screen.getByLabelText("비공개 관리 코드"), pendingAttemptId);
  await user.click(screen.getByRole("button", { name: "지원 내역 확인" }));

  expect(
    await screen.findByRole("region", { name: "개인정보 관리" }),
  ).toBeVisible();
  expect(window.location.href).not.toContain(applicationId);
  expect(window.location.href).not.toContain(pendingAttemptId);
  expect(consoleLog).not.toHaveBeenCalled();
});

it("exposes the direct applicant route and keeps the recruiter drafting route usable", async () => {
  // Production break: a wildcard-only route makes shared applicant links open the recruiter drafting screen.
  getPublicOpportunityMock.mockResolvedValue(makeupOpportunity);
  window.history.replaceState({}, "", `/opportunities/${opportunityId}/apply`);
  const { unmount } = render(<App />);

  expect(
    await screen.findByRole("heading", {
      name: "Makeup certification practical exam",
    }),
  ).toBeVisible();
  expect(getPublicOpportunityMock).toHaveBeenCalledWith(opportunityId);
  unmount();

  window.history.replaceState({}, "", "/opportunities/new");
  render(<App />);
  expect(screen.getByRole("heading", { name: "모델패스" })).toBeVisible();
});

it("switches a dirty applicant form to English without losing entered values", async () => {
  getPublicOpportunityMock.mockResolvedValue(makeupOpportunity);
  window.history.replaceState({}, "", `/opportunities/${opportunityId}/apply`);
  const user = userEvent.setup();
  render(<App />);

  await screen.findByRole("heading", {
    name: "Makeup certification practical exam",
  });
  await reachApplicationForm(user);
  await user.type(screen.getByLabelText("이름 또는 별명"), "Applicant");
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));

  await user.click(screen.getByRole("button", { name: "English" }));

  expect(
    screen.getByRole("heading", { name: "Applicant information" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Name or preferred name")).toHaveValue(
    "Applicant",
  );
  expect(screen.getByText("Enter your phone number.")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Submit application" }),
  ).toBeEnabled();
});

it("hides the old opportunity during a same-component route transition", async () => {
  // Production break: retaining state by component type briefly exposes the prior job and its form under a new URL.
  const secondOpportunity = {
    ...makeupOpportunity,
    id: "00000000-0000-4000-8000-000000000002",
    title: "Second makeup certification exam",
  };
  let resolveSecond: ((opportunity: PublicOpportunity) => void) | undefined;
  getPublicOpportunityMock.mockImplementation((requestedId: string) => {
    if (requestedId === opportunityId) {
      return Promise.resolve(makeupOpportunity);
    }
    return new Promise<PublicOpportunity>((resolve) => {
      resolveSecond = resolve;
    });
  });
  const router = createMemoryRouter(
    [
      {
        path: "/opportunities/:opportunityId/apply",
        element: <ApplyPage />,
      },
    ],
    { initialEntries: [`/opportunities/${opportunityId}/apply`] },
  );
  render(<RouterProvider router={router} />);
  expect(
    await screen.findByRole("heading", {
      name: "Makeup certification practical exam",
    }),
  ).toBeVisible();

  await act(async () => {
    await router.navigate(`/opportunities/${secondOpportunity.id}/apply`);
  });

  expect(
    screen.queryByRole("heading", {
      name: "Makeup certification practical exam",
    }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("지원 조건 확인")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "공고를 불러오고 있습니다…",
  );

  await act(async () => {
    resolveSecond?.(secondOpportunity);
  });
  expect(
    await screen.findByRole("heading", {
      name: "Second makeup certification exam",
    }),
  ).toBeVisible();
});

it("rejects a loader response whose opportunity ID does not match the route", async () => {
  // Production break: trusting a mismatched loader row renders another job under the requested job URL.
  getPublicOpportunityMock.mockResolvedValue({
    ...makeupOpportunity,
    id: "00000000-0000-4000-8000-000000000099",
  });
  const router = createMemoryRouter(
    [
      {
        path: "/opportunities/:opportunityId/apply",
        element: <ApplyPage />,
      },
    ],
    { initialEntries: [`/opportunities/${opportunityId}/apply`] },
  );
  render(<RouterProvider router={router} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "이 공고를 볼 수 없습니다.",
  );
  expect(
    screen.queryByRole("heading", {
      name: "Makeup certification practical exam",
    }),
  ).not.toBeInTheDocument();
});

async function answerBooleanQuestion(
  user: ReturnType<typeof userEvent.setup>,
  question: string,
  answer: boolean,
) {
  const group = screen.getByRole("group", { name: question });
  await user.click(within(group).getByLabelText(answer ? "예" : "아니요"));
}

async function answerAllEligibleQuestions(
  user: ReturnType<typeof userEvent.setup>,
) {
  await answerBooleanQuestion(user, "만 19세 이상인가요?", true);
  await answerBooleanQuestion(user, "모집 일정에 참여할 수 있나요?", true);
  await answerBooleanQuestion(
    user,
    "시험 당일 렌즈를 착용할 예정인가요?",
    false,
  );
}

async function reachApplicationForm(user: ReturnType<typeof userEvent.setup>) {
  await answerAllEligibleQuestions(user);
  await user.click(screen.getByRole("button", { name: "지원 조건 확인" }));
  await user.click(screen.getByRole("button", { name: "지원서 작성하기" }));
}

async function completeContactFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("이름 또는 별명"), "Applicant");
  await user.type(screen.getByLabelText("전화번호"), "010-1234-5678");
  await user.type(screen.getByLabelText("생년월일"), "2000-09-22");
}

function expectAssociatedError(
  field: HTMLElement,
  expectedMessage: string | ReturnType<typeof expect.any>,
) {
  const descriptionId = field.getAttribute("aria-describedby");
  expect(descriptionId).toBeTruthy();
  const error = document.getElementById(descriptionId ?? "");
  expect(error).not.toBeNull();
  if (typeof expectedMessage === "string") {
    expect(error).toHaveTextContent(expectedMessage);
  } else {
    expect(error?.textContent).not.toBe("");
  }
}

function successfulSubmission() {
  return {
    applicationId,
    submissionState: "submitted" as const,
    evaluation: {
      rulesetId: "makeup-certification",
      rulesetVersion: 1,
      eligible: true,
      failures: [],
      reviews: [],
      reminders: [],
    },
  };
}

function pendingPhotoSubmission() {
  return {
    applicationId,
    submissionState: "pending_photo" as const,
    evaluation: {
      rulesetId: photoOpportunity.rulesetId,
      rulesetVersion: photoOpportunity.rulesetVersion,
      eligible: true,
      failures: [],
      reviews: [
        {
          ruleId: "photo-required",
          reason: "Upload the requested job-specific photo.",
          effect: "needs_review" as const,
          input: null,
        },
      ],
      reminders: [],
    },
  };
}

function pendingPhotoCapability() {
  return {
    applicationId,
    submissionAttemptId: pendingAttemptId,
    rulesetId: photoOpportunity.rulesetId,
    rulesetVersion: photoOpportunity.rulesetVersion,
    expiresAt: photoOpportunity.closesAt,
  };
}

function serverHardFailEvaluation() {
  return {
    rulesetId: "makeup-certification",
    rulesetVersion: 1,
    eligible: false,
    failures: [
      {
        ruleId: "schedule-available",
        reason: "This schedule is unavailable.",
        effect: "hard_fail" as const,
        input: false,
      },
    ],
    reviews: [],
    reminders: [],
  };
}
