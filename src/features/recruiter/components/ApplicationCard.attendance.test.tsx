import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import type { RecruiterApplication } from "../../applications/api/application-photos";
import { ApplicationCard } from "./ApplicationCard";

const { getAttendanceMock, selectApplicationMock } = vi.hoisted(() => ({
  getAttendanceMock: vi.fn(),
  selectApplicationMock: vi.fn(),
}));

vi.mock("../../applications/api/attendance", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../applications/api/attendance")>();
  return {
    ...original,
    getAttendance: getAttendanceMock,
    selectApplication: selectApplicationMock,
  };
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
      allowedActions: [],
      events: [],
    })
    .mockResolvedValueOnce({
      applicationId,
      viewerParty: "recruiter",
      selected: true,
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
