import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { RecruiterApplication } from "../../applications/api/application-photos";
import { ApplicationCard } from "./ApplicationCard";

const { getAttendanceMock, selectApplicationMock, unselectApplicationMock } =
  vi.hoisted(() => ({
    getAttendanceMock: vi.fn(),
    selectApplicationMock: vi.fn(),
    unselectApplicationMock: vi.fn(),
  }));

afterEach(() => vi.resetAllMocks());

vi.mock("../../applications/api/attendance", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../applications/api/attendance")>();
  return {
    ...original,
    getAttendance: getAttendanceMock,
    selectApplication: selectApplicationMock,
    unselectApplication: unselectApplicationMock,
  };
});

it("lets the recruiter undo selection before attendance activity", async () => {
  // Production break: an accidental selection is permanent if the recruiter has no server-backed undo action.
  const user = (await import("@testing-library/user-event")).default.setup();
  let selectedOnServer = true;
  getAttendanceMock.mockImplementation(() =>
    Promise.resolve({
      applicationId,
      viewerParty: "recruiter",
      selected: selectedOnServer,
      canUnselect: selectedOnServer,
      allowedActions: selectedOnServer ? ["recruiter_confirmed"] : [],
      events: [],
    }),
  );
  unselectApplicationMock.mockImplementation(() => {
    selectedOnServer = false;
    return Promise.resolve({ applicationId });
  });
  render(
    <MemoryRouter
      initialEntries={[
        `/recruiter/opportunities/${opportunityId}/applications`,
      ]}
    >
      <Routes>
        <Route
          path="/recruiter/opportunities/:opportunityId/applications"
          element={<ApplicationCard application={application} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  await user.click(await screen.findByRole("button", { name: "선택 취소" }));

  expect(
    await screen.findByRole("button", { name: "지원자 선택" }),
  ).toBeEnabled();
  expect(unselectApplicationMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
  });
});

it("hides undo selection after attendance activity is loaded", async () => {
  getAttendanceMock.mockResolvedValue({
    applicationId,
    viewerParty: "recruiter",
    selected: true,
    canUnselect: false,
    allowedActions: [],
    events: [
      {
        id: "00000000-0000-4000-8000-000000000401",
        party: "recruiter",
        eventType: "recruiter_confirmed",
        occurredAt: "2026-09-22T03:00:00.000Z",
      },
    ],
  });
  render(
    <MemoryRouter
      initialEntries={[
        `/recruiter/opportunities/${opportunityId}/applications`,
      ]}
    >
      <Routes>
        <Route
          path="/recruiter/opportunities/:opportunityId/applications"
          element={<ApplicationCard application={application} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByText(/모집자 참여 확정/);
  expect(
    screen.queryByRole("button", { name: "선택 취소" }),
  ).not.toBeInTheDocument();
});

it("hides undo when server reports activity not visible in the event list", async () => {
  getAttendanceMock.mockResolvedValue({
    applicationId,
    viewerParty: "recruiter",
    selected: true,
    canUnselect: false,
    allowedActions: ["recruiter_confirmed"],
    events: [],
  });
  render(
    <MemoryRouter
      initialEntries={[
        `/recruiter/opportunities/${opportunityId}/applications`,
      ]}
    >
      <Routes>
        <Route
          path="/recruiter/opportunities/:opportunityId/applications"
          element={<ApplicationCard application={application} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole("button", { name: "참여 확정" });
  expect(
    screen.queryByRole("button", { name: "선택 취소" }),
  ).not.toBeInTheDocument();
});

const applicationId = "00000000-0000-4000-8000-000000000101";
const opportunityId = "00000000-0000-4000-8000-000000000001";

it("requires an authenticated recruiter selection before loading attendance actions", async () => {
  // Production break: rendering attendance controls from an application row skips the persisted recruiter selection contract.
  const user = (await import("@testing-library/user-event")).default.setup();
  getAttendanceMock
    .mockResolvedValueOnce({
      applicationId,
      viewerParty: "recruiter",
      selected: false,
      canUnselect: false,
      allowedActions: [],
      events: [],
    })
    .mockResolvedValueOnce({
      applicationId,
      viewerParty: "recruiter",
      selected: true,
      canUnselect: true,
      allowedActions: ["recruiter_confirmed"],
      events: [],
    });
  selectApplicationMock.mockResolvedValue({
    applicationId,
    selectedAt: "2026-09-22T03:00:00.000Z",
  });
  render(
    <MemoryRouter
      initialEntries={[
        `/recruiter/opportunities/${opportunityId}/applications`,
      ]}
    >
      <Routes>
        <Route
          path="/recruiter/opportunities/:opportunityId/applications"
          element={<ApplicationCard application={application} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  expect(
    await screen.findByText("모집자의 선택을 기다리고 있습니다."),
  ).toHaveAttribute("role", "status");
  expect(
    screen.queryByRole("button", { name: "참여 확정" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "지원자 선택" }));
  expect(selectApplicationMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
  });
  expect(
    await screen.findByRole("button", { name: "참여 확정" }),
  ).toBeEnabled();
  expect(getAttendanceMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
  });
  expect(getAttendanceMock).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(getAttendanceMock.mock.calls)).not.toContain(
    "submissionAttemptId",
  );
});

const application: RecruiterApplication = {
  id: applicationId,
  createdAt: "2026-09-22T01:00:00.000Z",
  applicantDisplayName: "Applicant",
  applicantPhone: "010-1234-5678",
  evaluation: {
    rulesetId: "hair-promotion",
    rulesetVersion: 1,
    eligible: true,
    failures: [],
    reviews: [],
    reminders: [],
  },
  answers: [],
  photos: [],
  attendance: [],
};
