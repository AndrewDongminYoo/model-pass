import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AttendanceStatus } from "../../applications/api/attendance";
import { AttendanceManager } from "./AttendanceManager";

const { getAttendanceMock, recordAttendanceMock } = vi.hoisted(() => ({
  getAttendanceMock: vi.fn(),
  recordAttendanceMock: vi.fn(),
}));

vi.mock("../../applications/api/attendance", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../applications/api/attendance")>();
  return {
    ...original,
    getAttendance: getAttendanceMock,
    recordAttendance: recordAttendanceMock,
  };
});

const applicationId = "00000000-0000-4000-8000-000000000011";
const opportunityId = "00000000-0000-4000-8000-000000000001";
const submissionAttemptId = "00000000-0000-4000-8000-000000000021";
const noShowId = "00000000-0000-4000-8000-000000000101";

afterEach(() => vi.clearAllMocks());

it("shows only recruiter actions and refreshes authoritative history after recording", async () => {
  // Production break: trusting an unexpected action list can expose applicant or operator actions in recruiter review.
  const user = userEvent.setup();
  getAttendanceMock
    .mockResolvedValueOnce(
      status("recruiter", [
        "recruiter_confirmed",
        "applicant_confirmed",
        "dispute_resolved",
      ]),
    )
    .mockResolvedValueOnce(
      status(
        "recruiter",
        [],
        [
          {
            id: "00000000-0000-4000-8000-000000000103",
            eventType: "recruiter_confirmed",
            party: "recruiter",
            occurredAt: "2026-09-22T02:00:00.000Z",
          },
        ],
      ),
    );
  recordAttendanceMock.mockResolvedValue({});
  render(
    <AttendanceManager
      capability={{ applicationId, opportunityId }}
      viewerParty="recruiter"
    />,
  );

  await user.click(
    await screen.findByRole("button", { name: "Confirm attendance" }),
  );

  expect(
    screen.queryByRole("button", { name: "Confirm applicant attendance" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /resolve/i }),
  ).not.toBeInTheDocument();
  expect(recordAttendanceMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
    eventType: "recruiter_confirmed",
    party: "recruiter",
  });
  expect(getAttendanceMock).toHaveBeenCalledTimes(2);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Attendance updated.",
  );
  expect(screen.getByText("Confirmed: 1")).toBeVisible();
});

it("lets the applicant dispute its no-show by event id and suppresses recruiter actions", async () => {
  // Production break: omitting the factual event id or exposing recruiter actions prevents a scoped applicant dispute.
  const user = userEvent.setup();
  getAttendanceMock
    .mockResolvedValueOnce(
      status(
        "applicant",
        ["completed", "applicant_no_show"],
        [
          {
            id: noShowId,
            eventType: "applicant_no_show",
            party: "applicant",
            occurredAt: "2026-09-22T03:00:00.000Z",
          },
        ],
      ),
    )
    .mockResolvedValueOnce(
      status(
        "applicant",
        [],
        [
          {
            id: noShowId,
            eventType: "applicant_no_show",
            party: "applicant",
            occurredAt: "2026-09-22T03:00:00.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000102",
            eventType: "dispute_opened",
            party: "applicant",
            relatedEventId: noShowId,
            occurredAt: "2026-09-22T04:00:00.000Z",
          },
        ],
      ),
    );
  recordAttendanceMock.mockResolvedValue({});
  render(
    <AttendanceManager
      capability={{ applicationId, opportunityId, submissionAttemptId }}
      viewerParty="applicant"
    />,
  );

  await user.click(
    await screen.findByRole("button", { name: "Dispute applicant no-show" }),
  );

  expect(recordAttendanceMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
    submissionAttemptId,
    eventType: "dispute_opened",
    party: "applicant",
    relatedEventId: noShowId,
  });
  expect(
    screen.queryByRole("button", { name: "Record applicant no-show" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /resolve/i }),
  ).not.toBeInTheDocument();
});

it("offers the applicant's own cancellation action when it is allowed before the appointment", async () => {
  // Production break: filtering away a server-authorized applicant cancellation strands the applicant without the required action.
  getAttendanceMock.mockResolvedValue(
    status("applicant", ["applicant_confirmed", "applicant_cancelled"]),
  );
  render(
    <AttendanceManager
      capability={{ applicationId, opportunityId, submissionAttemptId }}
      viewerParty="applicant"
    />,
  );

  expect(
    await screen.findByRole("button", {
      name: "Record applicant cancellation",
    }),
  ).toBeEnabled();
});

it("announces load failure and retries without discarding the capability", async () => {
  // Production break: a silent one-shot load failure strands the participant without an accessible retry path.
  const user = userEvent.setup();
  getAttendanceMock
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(status("applicant", ["applicant_confirmed"]));
  render(
    <AttendanceManager
      capability={{ applicationId, opportunityId, submissionAttemptId }}
      viewerParty="applicant"
    />,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load attendance history.",
  );
  await user.click(screen.getByRole("button", { name: "Retry attendance" }));
  expect(
    await screen.findByRole("button", { name: "Confirm attendance" }),
  ).toBeEnabled();
  expect(getAttendanceMock).toHaveBeenCalledTimes(2);
});

it("shows an accessible waiting state without attendance actions before selection", async () => {
  // Production break: rendering an empty action group hides why attendance is unavailable and can regress into pre-selection controls.
  getAttendanceMock.mockResolvedValue(
    status("applicant", ["applicant_confirmed"], [], false),
  );
  render(
    <AttendanceManager
      capability={{ applicationId, opportunityId, submissionAttemptId }}
      viewerParty="applicant"
    />,
  );

  expect(
    await screen.findByText("Waiting for recruiter selection."),
  ).toHaveAttribute("role", "status");
  expect(
    screen.queryByRole("group", { name: "Attendance actions" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Confirm attendance" }),
  ).not.toBeInTheDocument();
});

function status(
  viewerParty: "recruiter" | "applicant",
  allowedActions: AttendanceStatus["allowedActions"],
  events: AttendanceStatus["events"] = [],
  selected = true,
): AttendanceStatus {
  return { applicationId, viewerParty, selected, allowedActions, events };
}
