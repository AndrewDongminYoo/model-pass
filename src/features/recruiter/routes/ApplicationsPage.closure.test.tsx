import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n/I18nProvider";
import type { RecruiterApplication } from "../../applications/api/application-photos";
import { ApplicationsPage } from "./ApplicationsPage";

const {
  getRecruiterApplicationsMock,
  getRecruiterOpportunityStateMock,
  getAttendanceMock,
  closeOpportunityMock,
} = vi.hoisted(() => ({
  getRecruiterApplicationsMock: vi.fn(),
  getRecruiterOpportunityStateMock: vi.fn(),
  getAttendanceMock: vi.fn(),
  closeOpportunityMock: vi.fn(),
}));

vi.mock(
  "../../applications/api/application-photos",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../applications/api/application-photos")
    >()),
    getRecruiterApplications: getRecruiterApplicationsMock,
  }),
);
vi.mock("../../opportunities/api/close-opportunity", () => ({
  closeOpportunity: closeOpportunityMock,
  getRecruiterOpportunityState: getRecruiterOpportunityStateMock,
}));
vi.mock("../../applications/api/attendance", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../applications/api/attendance")
  >()),
  getAttendance: getAttendanceMock,
}));

afterEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

it("requires explicit confirmation before closing the owned opportunity", async () => {
  const opportunityId = "00000000-0000-4000-8000-000000000011";
  getRecruiterApplicationsMock.mockResolvedValue([application]);
  getRecruiterOpportunityStateMock.mockResolvedValue({
    status: "published",
    canSelect: true,
  });
  getAttendanceMock.mockResolvedValue({
    applicationId: application.id,
    viewerParty: "recruiter",
    selected: false,
    canUnselect: false,
    allowedActions: [],
    events: [],
  });
  closeOpportunityMock.mockResolvedValue({
    opportunityId,
    status: "closed",
    closedAt: "2026-09-23T01:00:00.000Z",
  });
  const user = userEvent.setup();
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

  expect(
    await screen.findByRole("button", { name: "지원자 선택" }),
  ).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "공고 마감" }));
  expect(closeOpportunityMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "공고 마감 확정" }));

  expect(closeOpportunityMock).toHaveBeenCalledWith(opportunityId);
  expect(await screen.findByText("공고가 마감되었습니다.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "공고 마감" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "지원자 선택" }),
  ).not.toBeInTheDocument();
});

it("does not offer selection when an owned opportunity was already closed", async () => {
  const opportunityId = "00000000-0000-4000-8000-000000000011";
  getRecruiterApplicationsMock.mockResolvedValue([application]);
  getRecruiterOpportunityStateMock.mockResolvedValue({
    status: "closed",
    canSelect: false,
  });
  getAttendanceMock.mockResolvedValue({
    applicationId: application.id,
    viewerParty: "recruiter",
    selected: false,
    canUnselect: false,
    allowedActions: [],
    events: [],
  });
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

  expect(await screen.findByText("공고가 마감되었습니다.")).toBeVisible();
  expect(getRecruiterOpportunityStateMock).toHaveBeenCalledWith(opportunityId);
  expect(
    screen.queryByRole("button", { name: "지원자 선택" }),
  ).not.toBeInTheDocument();
});

const application: RecruiterApplication = {
  id: "00000000-0000-4000-8000-000000000101",
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
