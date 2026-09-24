import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../../app/App";
import { I18nProvider } from "../../../i18n/I18nProvider";
import type { PublicOpportunity } from "../../applications/api/get-public-opportunity";
import {
  RecruiterAuthenticationError,
  type RecruiterApplication,
} from "../../applications/api/application-photos";
import { ApplicationForm } from "../../applications/components/ApplicationForm";
import { ApplicationCard } from "./ApplicationCard";
import { ApplicationsPage } from "../routes/ApplicationsPage";

const {
  createPhotoViewUrlMock,
  getAttendanceMock,
  getRecruiterApplicationsMock,
  getRecruiterOpportunityStateMock,
  submitApplicationMock,
  supabaseClientMock,
  uploadApplicationPhotoMock,
} = vi.hoisted(() => ({
  createPhotoViewUrlMock: vi.fn(),
  getAttendanceMock: vi.fn(),
  getRecruiterApplicationsMock: vi.fn(),
  getRecruiterOpportunityStateMock: vi.fn(),
  submitApplicationMock: vi.fn(),
  supabaseClientMock: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    functions: { invoke: vi.fn() },
  },
  uploadApplicationPhotoMock: vi.fn(),
}));

vi.mock("../../applications/api/attendance", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../applications/api/attendance")>();
  return { ...original, getAttendance: getAttendanceMock };
});

vi.mock("../../../lib/supabase/client", () => ({
  getSupabaseClient: () => supabaseClientMock,
}));

vi.mock("../../applications/api/application-photos", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../applications/api/application-photos")
    >();
  return {
    ...original,
    createPhotoViewUrl: createPhotoViewUrlMock,
    getRecruiterApplications: getRecruiterApplicationsMock,
    uploadApplicationPhoto: uploadApplicationPhotoMock,
  };
});

vi.mock("../../applications/api/submit-application", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../applications/api/submit-application")
    >();
  return { ...original, submitApplication: submitApplicationMock };
});

vi.mock("../../opportunities/api/close-opportunity", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../opportunities/api/close-opportunity")
    >();
  return {
    ...original,
    getRecruiterOpportunityState: getRecruiterOpportunityStateMock,
  };
});

const opportunityId = "00000000-0000-4000-8000-000000000001";
const applicationId = "00000000-0000-4000-8000-000000000101";
const photoId = "00000000-0000-4000-8000-000000000301";

beforeEach(() => {
  getAttendanceMock.mockImplementation(() => new Promise(() => undefined));
  getRecruiterOpportunityStateMock.mockResolvedValue({
    status: "published",
    canSelect: true,
  });
  supabaseClientMock.auth.getSession.mockResolvedValue({
    data: {
      session: {
        user: { id: "00000000-0000-4000-8000-000000000111" },
      },
    },
    error: null,
  });
  supabaseClientMock.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

it("the applicant upload wrapper resolves only after the signed storage request succeeds", async () => {
  // Production break: resolving after grant issuance claims success before the private storage write completes.
  const { uploadApplicationPhoto } = await vi.importActual<
    typeof import("../../applications/api/application-photos")
  >("../../applications/api/application-photos");
  supabaseClientMock.functions.invoke.mockResolvedValue({
    data: {
      uploadUrl: "https://functions.test/create-photo-upload?token=signed",
      storagePath: `opportunity/${opportunityId}/application/${applicationId}/${photoId}`,
      expiresAt: "2026-09-22T03:10:00.000Z",
    },
    error: null,
  });
  let resolveStorage: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolveStorage = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const file = new File([new Uint8Array([1, 2, 3])], "requested.png", {
    type: "image/png",
  });
  let settled = false;

  const upload = uploadApplicationPhoto({
    applicationId,
    opportunityId,
    submissionAttemptId: "00000000-0000-4000-8000-000000000201",
    file,
  }).then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  await Promise.resolve();

  expect(settled).toBe(false);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://functions.test/create-photo-upload?token=signed",
    {
      method: "PUT",
      headers: {
        "Content-Type": "image/png",
        "X-Photo-Storage-Path": `opportunity/${opportunityId}/application/${applicationId}/${photoId}`,
      },
      body: file,
    },
  );

  resolveStorage?.(
    new Response(
      JSON.stringify({ applicationId, photoId, submissionState: "submitted" }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      },
    ),
  );
  await expect(upload).resolves.toEqual({
    applicationId,
    photoId,
    submissionState: "submitted",
  });
});

it("recovers a finalized upload without issuing another storage request", async () => {
  // Production break: losing the PUT response must not strand a submitted applicant or create a duplicate photo.
  const { uploadApplicationPhoto } = await vi.importActual<
    typeof import("../../applications/api/application-photos")
  >("../../applications/api/application-photos");
  supabaseClientMock.functions.invoke.mockResolvedValue({
    data: { applicationId, photoId, submissionState: "submitted" },
    error: null,
  });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    uploadApplicationPhoto({
      applicationId,
      opportunityId,
      submissionAttemptId: "00000000-0000-4000-8000-000000000201",
      file: new File([new Uint8Array([1, 2, 3])], "requested.png", {
        type: "image/png",
      }),
    }),
  ).resolves.toEqual({ applicationId, photoId, submissionState: "submitted" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("withholds the receipt when photo upload fails and supports retry", async () => {
  // Production break: showing a receipt for pending_photo exposes an incomplete application to the applicant as submitted.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  uploadApplicationPhotoMock
    .mockRejectedValueOnce(new Error("upload failed"))
    .mockResolvedValueOnce({
      applicationId,
      photoId,
      submissionState: "submitted",
    });
  render(<ApplicationForm opportunity={opportunity} />);
  await submitEligibleApplication(user);

  expect(
    screen.queryByText(`접수 번호: ${applicationId}`),
  ).not.toBeInTheDocument();
  const file = new File([new Uint8Array([1, 2, 3])], "requested.jpg", {
    type: "image/jpeg",
  });
  await user.upload(screen.getByLabelText("이 공고에서 요청한 사진"), file);
  await user.click(screen.getByRole("button", { name: "사진 올리기" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "사진을 올리지 못했습니다. 다시 시도해 주세요.",
  );
  expect(
    screen.queryByText(`접수 번호: ${applicationId}`),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "사진 올리기" }));
  expect(await screen.findByText(`접수 번호: ${applicationId}`)).toBeVisible();
  expect(uploadApplicationPhotoMock).toHaveBeenCalledTimes(2);
  expect(uploadApplicationPhotoMock).toHaveBeenLastCalledWith({
    applicationId,
    opportunityId,
    submissionAttemptId:
      submitApplicationMock.mock.calls[0]?.[0].submissionAttemptId,
    file,
  });
});

it("does not claim photo success until the storage upload completes", async () => {
  // Production break: acknowledging the photo after token issuance hides a failed storage write.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  let resolveUpload:
    | ((value: {
        applicationId: string;
        photoId: string;
        submissionState: "submitted";
      }) => void)
    | undefined;
  uploadApplicationPhotoMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
  );
  render(<ApplicationForm opportunity={opportunity} />);
  await submitEligibleApplication(user);
  await user.upload(
    screen.getByLabelText("이 공고에서 요청한 사진"),
    new File([new Uint8Array([1])], "requested.heic", {
      type: "image/heic",
    }),
  );

  await user.click(screen.getByRole("button", { name: "사진 올리기" }));
  expect(
    screen.getByRole("button", { name: "사진을 올리고 있습니다…" }),
  ).toBeDisabled();
  expect(
    screen.queryByText("Photo uploaded privately."),
  ).not.toBeInTheDocument();

  resolveUpload?.({ applicationId, photoId, submissionState: "submitted" });
  expect(await screen.findByText(`접수 번호: ${applicationId}`)).toBeVisible();
});

it("does not offer photo upload without a stored needs-review photo outcome", async () => {
  // Production break: showing photo collection for every receipt gathers sensitive content the job did not request.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue({
    ...successfulSubmission(),
    submissionState: "submitted",
    evaluation: {
      ...successfulSubmission().evaluation,
      reviews: [],
    },
  });
  render(
    <ApplicationForm
      opportunity={{ ...opportunity, rules: opportunity.rules.slice(0, 2) }}
    />,
  );

  await submitEligibleApplication(user);

  expect(await screen.findByText(`접수 번호: ${applicationId}`)).toBeVisible();
  expect(
    screen.queryByLabelText("이 공고에서 요청한 사진"),
  ).not.toBeInTheDocument();
});

it("does not treat a non-needs-review outcome as photo authority", async () => {
  // Production break: matching only the rule ID can collect a photo from a malformed non-review outcome.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue({
    ...successfulSubmission(),
    submissionState: "submitted",
    evaluation: {
      ...successfulSubmission().evaluation,
      reviews: [
        {
          ruleId: "photo-required",
          reason: "Upload the requested job-specific photo.",
          effect: "hard_fail",
          input: null,
        },
      ],
    },
  });
  render(<ApplicationForm opportunity={opportunity} />);

  await submitEligibleApplication(user);

  expect(await screen.findByText(`접수 번호: ${applicationId}`)).toBeVisible();
  expect(
    screen.queryByLabelText("이 공고에서 요청한 사진"),
  ).not.toBeInTheDocument();
});

it("does not use a photo outcome from a different stored ruleset", async () => {
  // Production break: a stale evaluation can request sensitive content for rules that are not this job's snapshot.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue({
    ...successfulSubmission(),
    submissionState: "submitted",
    evaluation: {
      ...successfulSubmission().evaluation,
      rulesetVersion: 2,
    },
  });
  render(<ApplicationForm opportunity={opportunity} />);

  await submitEligibleApplication(user);

  expect(await screen.findByText(`접수 번호: ${applicationId}`)).toBeVisible();
  expect(
    screen.queryByLabelText("이 공고에서 요청한 사진"),
  ).not.toBeInTheDocument();
});

it("renders deterministic evidence, private photos, and factual attendance without ranking UI", async () => {
  // Production break: omitting stored evidence or adding inferred ranking changes recruiter review into scoring.
  const user = userEvent.setup();
  createPhotoViewUrlMock.mockResolvedValue(
    "https://storage.test/private-photo",
  );
  render(
    <ApplicationCard
      application={application("Applicant one", "2026-09-22T03:00:00.000Z")}
    />,
  );

  expect(screen.getByText("Applicant one")).toBeVisible();
  expect(
    screen.getByText(
      new Date("2026-09-22T03:00:00.000Z").toLocaleString("ko-KR"),
    ),
  ).toBeVisible();
  expect(screen.getByText("지원 가능")).toBeVisible();
  expect(screen.getByText("규칙 버전: hair-promotion v1")).toBeVisible();
  expect(
    screen.getByText(
      "photo-required · 입력: 없음 · 판정: 검토 필요 · 이유: Upload the requested job-specific photo.",
    ),
  ).toBeVisible();
  expect(screen.getByText("모집 일정 참여: 예")).toBeVisible();
  expect(
    within(screen.getByRole("group", { name: "지원자 기록" })).getByText(
      "일정 완료: 1",
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      new Date("2026-09-22T04:00:00.000Z").toLocaleString("ko-KR"),
    ),
  ).toBeVisible();
  expect(
    screen.queryByText(/rank|attractiveness|AI score|inferred fit/i),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "비공개 사진 1 보기" }));
  expect(createPhotoViewUrlMock).toHaveBeenCalledWith(applicationId, photoId);
  expect(
    await screen.findByRole("link", { name: "비공개 사진 1 열기" }),
  ).toHaveAttribute("href", "https://storage.test/private-photo");
});

it("shows the stored condition question beside the recruiter's answer", () => {
  render(
    <ApplicationCard
      application={{
        ...application("Applicant one", "2026-09-22T03:00:00.000Z"),
        answers: [{ field: "hairLength", value: true }],
      }}
      rules={[
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
      ]}
    />,
  );

  expect(
    screen.getByText("현재 머리카락이 어깨 아래까지 내려오나요?: 예"),
  ).toBeVisible();
});

it("renders recruiter evidence in English when the English locale is selected", () => {
  // Production break: hardcoding Korean labels conceals the stored deterministic reason and boolean answer from English-speaking recruiters.
  localStorage.setItem("model-pass-locale", "en");
  render(
    <I18nProvider>
      <ApplicationCard
        application={application("Applicant one", "2026-09-22T03:00:00.000Z")}
      />
    </I18nProvider>,
  );

  expect(
    screen.getByRole("heading", { name: "Deterministic evaluation" }),
  ).toBeVisible();
  expect(screen.getByText("Eligible")).toBeVisible();
  expect(
    screen.getByText(
      "photo-required · Input: None · Effect: Needs review · Reason: Upload the requested job-specific photo.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText("Available at the scheduled time: Yes"),
  ).toBeVisible();
});

it("keeps recruiter applications in chronological submission order", async () => {
  // Production break: rendering response order without enforcing created_at ASC presents a hidden ranking.
  getRecruiterApplicationsMock.mockResolvedValue([
    application("Later ID applicant", "2026-09-22T03:00:00.000Z", "102"),
    application("Earlier ID applicant", "2026-09-22T03:00:00.000Z", "101"),
  ]);
  render(
    <MemoryRouter
      initialEntries={[
        `/recruiter/opportunities/${opportunityId}/applications`,
      ]}
    >
      <Routes>
        <Route
          path="/recruiter/opportunities/:opportunityId/applications"
          element={<ApplicationsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );

  const cards = await screen.findAllByRole("article");
  expect(within(cards[0]).getByText("Earlier ID applicant")).toBeVisible();
  expect(within(cards[1]).getByText("Later ID applicant")).toBeVisible();
  expect(getRecruiterApplicationsMock).toHaveBeenCalledWith(opportunityId);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

it("renders an authentication error instead of an anonymous empty state", async () => {
  // Production break: RLS returns no anonymous rows, which can be misreported as a valid empty list.
  getRecruiterApplicationsMock.mockRejectedValue(
    new RecruiterAuthenticationError(),
  );
  render(
    <MemoryRouter
      initialEntries={[
        `/recruiter/opportunities/${opportunityId}/applications`,
      ]}
    >
      <Routes>
        <Route
          path="/recruiter/opportunities/:opportunityId/applications"
          element={<ApplicationsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "지원 내역을 보려면 로그인해 주세요.",
  );
  expect(
    screen.queryByText("아직 지원 내역이 없습니다."),
  ).not.toBeInTheDocument();
});

it("localizes a recruiter application load failure in English", async () => {
  localStorage.setItem("model-pass-locale", "en");
  getRecruiterApplicationsMock.mockRejectedValue(new Error("network failure"));
  render(
    <I18nProvider>
      <MemoryRouter
        initialEntries={[
          `/recruiter/opportunities/${opportunityId}/applications`,
        ]}
      >
        <Routes>
          <Route
            path="/recruiter/opportunities/:opportunityId/applications"
            element={<ApplicationsPage />}
          />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load applications.",
  );
});

it("exposes the recruiter applications route", async () => {
  // Production break: omitting the route leaves the authenticated review page unreachable.
  getRecruiterApplicationsMock.mockResolvedValue([]);
  window.history.replaceState(
    {},
    "",
    `/recruiter/opportunities/${opportunityId}/applications`,
  );
  render(<App />);

  expect(
    await screen.findByRole("heading", { name: "지원 내역" }),
  ).toBeVisible();
});

const opportunity: PublicOpportunity = {
  id: opportunityId,
  category: "hair_promotion",
  title: "Hair promotion exam",
  startsAt: "2099-06-01T10:00:00.000Z",
  closesAt: "2099-05-31T10:00:00.000Z",
  venueDistrict: "서울 강남구",
  expectedMinutes: 120,
  benefit: { type: "procedure", description: "Hair service" },
  rulesetId: "hair-promotion",
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
      id: "photo-required",
      field: "requestedPhoto",
      operator: "equals",
      expected: true,
      effect: "needs_review",
      reason: "Upload the requested job-specific photo.",
    },
  ],
};

function application(
  displayName: string,
  createdAt: string,
  idSuffix = "101",
): RecruiterApplication {
  return {
    id: `00000000-0000-4000-8000-000000000${idSuffix}`,
    createdAt,
    applicantDisplayName: displayName,
    applicantPhone: "010-1234-5678",
    evaluation: {
      rulesetId: "hair-promotion",
      rulesetVersion: 1,
      eligible: true,
      failures: [],
      reviews: [
        {
          ruleId: "photo-required",
          reason: "Upload the requested job-specific photo.",
          effect: "needs_review",
          input: null,
        },
      ],
      reminders: [],
    },
    answers: [{ field: "isAvailable", value: true }],
    photos: [{ id: photoId, contentType: "image/jpeg", byteSize: 3 }],
    attendance: [
      {
        id: "00000000-0000-4000-8000-000000000501",
        party: "applicant",
        eventType: "completed",
        occurredAt: "2026-09-22T04:00:00.000Z",
      },
    ],
  };
}

async function submitEligibleApplication(
  user: ReturnType<typeof userEvent.setup>,
) {
  for (const label of [
    "만 19세 이상인가요?",
    "모집 일정에 참여할 수 있나요?",
  ]) {
    await user.click(
      within(screen.getByRole("group", { name: label })).getByLabelText("예"),
    );
  }
  await user.click(screen.getByRole("button", { name: "지원 조건 확인" }));
  await user.click(screen.getByRole("button", { name: "지원서 작성하기" }));
  await user.type(screen.getByLabelText("이름 또는 별명"), "Applicant");
  await user.type(screen.getByLabelText("전화번호"), "010-1234-5678");
  await user.type(screen.getByLabelText("생년월일"), "2000-09-22");
  await user.click(
    screen.getByLabelText("이 공고 지원을 위한 개인정보 처리에 동의합니다"),
  );
  await user.click(screen.getByRole("button", { name: "지원서 제출" }));
}

function successfulSubmission() {
  return {
    applicationId,
    submissionState: "pending_photo" as const,
    evaluation: {
      rulesetId: "hair-promotion",
      rulesetVersion: 1,
      eligible: true,
      failures: [],
      reviews: [
        {
          ruleId: "photo-required",
          reason: "Upload the requested job-specific photo.",
          effect: "needs_review",
          input: null,
        },
      ],
      reminders: [],
    },
  };
}
