import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../../app/App";
import type { PublicOpportunity } from "../../applications/api/get-public-opportunity";
import type { RecruiterApplication } from "../../applications/api/application-photos";
import { ApplicationForm } from "../../applications/components/ApplicationForm";
import { ApplicationCard } from "./ApplicationCard";
import { ApplicationsPage } from "../routes/ApplicationsPage";

const {
  createPhotoViewUrlMock,
  getRecruiterApplicationsMock,
  submitApplicationMock,
  supabaseClientMock,
  uploadApplicationPhotoMock,
} = vi.hoisted(() => ({
  createPhotoViewUrlMock: vi.fn(),
  getRecruiterApplicationsMock: vi.fn(),
  submitApplicationMock: vi.fn(),
  supabaseClientMock: {
    functions: { invoke: vi.fn() },
  },
  uploadApplicationPhotoMock: vi.fn(),
}));

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

const opportunityId = "00000000-0000-4000-8000-000000000001";
const applicationId = "00000000-0000-4000-8000-000000000101";
const photoId = "00000000-0000-4000-8000-000000000301";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
    new Response(JSON.stringify({ photoId }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await expect(upload).resolves.toEqual({ photoId });
});

it("preserves the private receipt when photo upload fails and supports retry", async () => {
  // Production break: replacing the receipt with an upload error loses the applicant's submission proof.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  uploadApplicationPhotoMock
    .mockRejectedValueOnce(new Error("upload failed"))
    .mockResolvedValueOnce({ photoId });
  render(<ApplicationForm opportunity={opportunity} />);
  await submitEligibleApplication(user);

  const receipt = await screen.findByText(`Receipt: ${applicationId}`);
  const file = new File([new Uint8Array([1, 2, 3])], "requested.jpg", {
    type: "image/jpeg",
  });
  await user.upload(screen.getByLabelText("Job-specific photo"), file);
  await user.click(screen.getByRole("button", { name: "Upload photo" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not upload the photo. Try again.",
  );
  expect(receipt).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Upload photo" }));
  expect(await screen.findByText("Photo uploaded privately.")).toBeVisible();
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
  let resolveUpload: ((value: { photoId: string }) => void) | undefined;
  uploadApplicationPhotoMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
  );
  render(<ApplicationForm opportunity={opportunity} />);
  await submitEligibleApplication(user);
  await user.upload(
    screen.getByLabelText("Job-specific photo"),
    new File([new Uint8Array([1])], "requested.heic", {
      type: "image/heic",
    }),
  );

  await user.click(screen.getByRole("button", { name: "Upload photo" }));
  expect(
    screen.getByRole("button", { name: "Uploading photo" }),
  ).toBeDisabled();
  expect(
    screen.queryByText("Photo uploaded privately."),
  ).not.toBeInTheDocument();

  resolveUpload?.({ photoId });
  expect(await screen.findByText("Photo uploaded privately.")).toBeVisible();
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
  expect(screen.getByText("2026-09-22T03:00:00.000Z")).toBeVisible();
  expect(screen.getByText("Eligible")).toBeVisible();
  expect(screen.getByText("isAvailable: true")).toBeVisible();
  expect(screen.getByText("applicant: completed")).toBeVisible();
  expect(
    screen.queryByText(/rank|attractiveness|AI score|inferred fit/i),
  ).not.toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "View private photo 1" }),
  );
  expect(createPhotoViewUrlMock).toHaveBeenCalledWith(applicationId, photoId);
  expect(
    await screen.findByRole("link", { name: "Open private photo 1" }),
  ).toHaveAttribute("href", "https://storage.test/private-photo");
});

it("keeps recruiter applications in chronological submission order", async () => {
  // Production break: rendering response order without enforcing created_at ASC presents a hidden ranking.
  getRecruiterApplicationsMock.mockResolvedValue([
    application("Later applicant", "2026-09-22T04:00:00.000Z", "102"),
    application("Earlier applicant", "2026-09-22T03:00:00.000Z", "101"),
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
  expect(within(cards[0]).getByText("Earlier applicant")).toBeVisible();
  expect(within(cards[1]).getByText("Later applicant")).toBeVisible();
  expect(getRecruiterApplicationsMock).toHaveBeenCalledWith(opportunityId);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "Applications" }),
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
      reviews: [],
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
  for (const label of ["Is adult", "Is available"]) {
    await user.click(
      within(screen.getByRole("group", { name: label })).getByLabelText("Yes"),
    );
  }
  await user.click(screen.getByRole("button", { name: "Check eligibility" }));
  await user.click(
    screen.getByRole("button", { name: "Continue to application" }),
  );
  await user.type(screen.getByLabelText("Display name"), "Applicant");
  await user.type(screen.getByLabelText("Phone number"), "010-1234-5678");
  await user.type(screen.getByLabelText("Birth date"), "2000-09-22");
  await user.click(screen.getByLabelText("Consent to this application"));
  await user.click(screen.getByRole("button", { name: "Submit application" }));
}

function successfulSubmission() {
  return {
    applicationId,
    evaluation: {
      rulesetId: "hair-promotion",
      rulesetVersion: 1,
      eligible: true,
      failures: [],
      reviews: [],
      reminders: [],
    },
  };
}
