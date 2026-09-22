import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../../app/App";
import type { PublicOpportunity } from "../api/get-public-opportunity";
import {
  ApplicationSubmissionError,
  parseApplicationSubmissionHttpError,
} from "../api/submit-application";
import { ApplyPage } from "../routes/ApplyPage";
import { ApplicationForm } from "./ApplicationForm";

const { getPublicOpportunityMock, submitApplicationMock } = vi.hoisted(() => ({
  getPublicOpportunityMock: vi.fn(),
  submitApplicationMock: vi.fn(),
}));

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

const opportunityId = "00000000-0000-4000-8000-000000000001";
const applicationId = "00000000-0000-4000-8000-000000000101";
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

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

it("explains the exact deterministic hard failure without requesting a photo", async () => {
  // Production break: continuing after a hard fail collects sensitive photo or contact data unnecessarily.
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  await answerBooleanQuestion(user, "Is adult", false);
  await answerBooleanQuestion(user, "Is available", true);
  await answerBooleanQuestion(user, "Wears lenses", false);
  await user.click(screen.getByRole("button", { name: "Check eligibility" }));

  expect(
    screen.getByText("This pilot is available to adults only."),
  ).toBeVisible();
  expect(screen.queryByLabelText("Requested photo")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
});

it("reveals the requested-photo step before contact and current-job consent", async () => {
  // Production break: collecting contact details before non-photo hard rules pass violates progressive disclosure.
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  await answerAllEligibleQuestions(user);
  await user.click(screen.getByRole("button", { name: "Check eligibility" }));

  expect(screen.getByLabelText("Requested photo")).toBeDisabled();
  expect(
    screen.getByText(/photo upload is not available in this step/i),
  ).toBeVisible();
  expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "Continue to application" }),
  );

  expect(screen.getByLabelText("Display name")).toBeVisible();
  expect(screen.getByLabelText("Consent to this application")).toBeVisible();
});

it("defaults future alerts to unchecked and submits false", async () => {
  // Production break: bundling optional future contact into required current-job consent records false consent.
  const user = userEvent.setup();
  submitApplicationMock.mockResolvedValue(successfulSubmission());
  render(<ApplicationForm opportunity={makeupOpportunity} />);
  await reachApplicationForm(user);

  const futureConsent = screen.getByLabelText("Future opportunity alerts");
  expect(futureConsent).not.toBeChecked();
  await completeContactFields(user);
  await user.click(screen.getByLabelText("Consent to this application"));
  await user.click(screen.getByRole("button", { name: "Submit application" }));

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
  await user.click(screen.getByLabelText("Consent to this application"));

  await user.click(screen.getByRole("button", { name: "Submit application" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not submit the application. Try again.",
  );
  expect(screen.getByLabelText("Display name")).toHaveValue("Applicant");
  expect(
    within(screen.getByRole("group", { name: "Is available" })).getByLabelText(
      "Yes",
    ),
  ).toBeChecked();

  await user.click(screen.getByRole("button", { name: "Submit application" }));
  expect(
    await screen.findByRole("heading", { name: "Application received" }),
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
  await user.click(screen.getByLabelText("Consent to this application"));
  await user.click(screen.getByRole("button", { name: "Submit application" }));

  expect(
    await screen.findByText("This schedule is unavailable."),
  ).toBeVisible();
  expect(screen.queryByLabelText("Requested photo")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Could not submit the application. Try again."),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Check eligibility" }));
  await user.click(
    screen.getByRole("button", { name: "Continue to application" }),
  );
  expect(screen.getByLabelText("Display name")).toHaveValue("Applicant");
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
  await user.click(screen.getByLabelText("Consent to this application"));
  await user.click(screen.getByRole("button", { name: "Submit application" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Applicants must be at least 19 years old.",
  );
  expect(screen.getByLabelText("Display name")).toHaveValue("Applicant");
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
  await user.click(screen.getByLabelText("Consent to this application"));

  const submitButton = screen.getByRole("button", {
    name: "Submit application",
  });
  await user.click(submitButton);
  expect(submitButton).toBeDisabled();
  await user.click(submitButton);
  expect(submitApplicationMock).toHaveBeenCalledTimes(1);

  resolveSubmission?.(successfulSubmission());
  expect(
    await screen.findByRole("heading", { name: "Application received" }),
  ).toBeVisible();
});

it("associates every eligibility and application validation error with its field", async () => {
  // Production break: visual-only errors leave assistive technology users without field-level guidance.
  const user = userEvent.setup();
  render(<ApplicationForm opportunity={makeupOpportunity} />);

  await user.click(screen.getByRole("button", { name: "Check eligibility" }));
  for (const label of ["Is adult", "Is available", "Wears lenses"]) {
    const group = screen.getByRole("group", { name: label });
    expectAssociatedError(group, "Choose yes or no.");
  }

  await answerAllEligibleQuestions(user);
  await user.click(screen.getByRole("button", { name: "Check eligibility" }));
  await user.click(
    screen.getByRole("button", { name: "Continue to application" }),
  );
  await user.click(screen.getByRole("button", { name: "Submit application" }));

  for (const label of [
    "Display name",
    "Phone number",
    "Birth date",
    "Consent to this application",
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
  await user.click(screen.getByLabelText("Consent to this application"));
  await user.click(screen.getByRole("button", { name: "Submit application" }));

  expect(
    await screen.findByRole("heading", { name: "Application received" }),
  ).toBeVisible();
  expect(screen.getByText(`Receipt: ${applicationId}`)).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /profile/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /profile/i }),
  ).not.toBeInTheDocument();
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
  expect(screen.getByRole("heading", { name: "Model Pass" })).toBeVisible();
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
  expect(screen.queryByText("Check eligibility")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading opportunity");

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
    "This opportunity is unavailable.",
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
  await user.click(within(group).getByLabelText(answer ? "Yes" : "No"));
}

async function answerAllEligibleQuestions(
  user: ReturnType<typeof userEvent.setup>,
) {
  await answerBooleanQuestion(user, "Is adult", true);
  await answerBooleanQuestion(user, "Is available", true);
  await answerBooleanQuestion(user, "Wears lenses", false);
}

async function reachApplicationForm(user: ReturnType<typeof userEvent.setup>) {
  await answerAllEligibleQuestions(user);
  await user.click(screen.getByRole("button", { name: "Check eligibility" }));
  await user.click(
    screen.getByRole("button", { name: "Continue to application" }),
  );
}

async function completeContactFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Display name"), "Applicant");
  await user.type(screen.getByLabelText("Phone number"), "010-1234-5678");
  await user.type(screen.getByLabelText("Birth date"), "2000-09-22");
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
