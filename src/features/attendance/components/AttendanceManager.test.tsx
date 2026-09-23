import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  AttendanceRequestError,
  type AttendanceStatus,
} from "../../applications/api/attendance";
import { I18nProvider } from "../../../i18n/I18nProvider";
import { LanguageSwitch } from "../../../i18n/LanguageSwitch";
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

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

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

  await user.click(await screen.findByRole("button", { name: "참여 확정" }));

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
    "참여 기록을 업데이트했습니다.",
  );
  expect(screen.getByText("참여 확정: 1")).toBeVisible();
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
    await screen.findByRole("button", { name: "지원자 불참 이의 제기" }),
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
    screen.queryByRole("button", { name: "지원자 불참 기록" }),
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
      name: "지원자 취소 기록",
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
    "참여 이력을 불러오지 못했습니다.",
  );
  await user.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(
    await screen.findByRole("button", { name: "참여 확정" }),
  ).toBeEnabled();
  expect(getAttendanceMock).toHaveBeenCalledTimes(2);
});

it("translates an existing server timing error when the language changes", async () => {
  const user = userEvent.setup();
  getAttendanceMock.mockResolvedValue(status("recruiter", ["completed"]));
  recordAttendanceMock.mockRejectedValue(
    new AttendanceRequestError(
      "Attendance outcomes are only available after the appointment starts.",
    ),
  );
  render(
    <I18nProvider>
      <LanguageSwitch />
      <AttendanceManager
        capability={{ applicationId, opportunityId }}
        viewerParty="recruiter"
      />
    </I18nProvider>,
  );

  await user.click(
    await screen.findByRole("button", { name: "일정 완료 기록" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "약속 시간이 시작된 뒤",
  );
  await user.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Attendance outcomes are only available after the appointment starts.",
  );
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
    await screen.findByText("모집자의 선택을 기다리고 있습니다."),
  ).toHaveAttribute("role", "status");
  expect(
    screen.queryByRole("group", { name: "참여 기록 작업" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "참여 확정" }),
  ).not.toBeInTheDocument();
});

it("shows localized attendance errors and actions when English is selected", async () => {
  // Production break: storing Korean error text in state leaves English users without a translated recovery action.
  localStorage.setItem("model-pass-locale", "en");
  getAttendanceMock.mockRejectedValue(new Error("network"));
  render(
    <I18nProvider>
      <AttendanceManager
        capability={{ applicationId, opportunityId, submissionAttemptId }}
        viewerParty="applicant"
      />
    </I18nProvider>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load attendance history.",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

function status(
  viewerParty: "recruiter" | "applicant",
  allowedActions: AttendanceStatus["allowedActions"],
  events: AttendanceStatus["events"] = [],
  selected = true,
): AttendanceStatus {
  return {
    applicationId,
    viewerParty,
    selected,
    canUnselect: false,
    allowedActions,
    events,
  };
}
