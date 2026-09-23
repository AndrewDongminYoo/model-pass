import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n/I18nProvider";
import { ApplicationsPage } from "./ApplicationsPage";

const { getRecruiterApplicationsMock, closeOpportunityMock } = vi.hoisted(
  () => ({
    getRecruiterApplicationsMock: vi.fn(),
    closeOpportunityMock: vi.fn(),
  }),
);

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
}));

afterEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

it("requires explicit confirmation before closing the owned opportunity", async () => {
  const opportunityId = "00000000-0000-4000-8000-000000000011";
  getRecruiterApplicationsMock.mockResolvedValue([]);
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

  await screen.findByText("아직 지원 내역이 없습니다.");
  await user.click(screen.getByRole("button", { name: "공고 마감" }));
  expect(closeOpportunityMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "공고 마감 확정" }));

  expect(closeOpportunityMock).toHaveBeenCalledWith(opportunityId);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "공고가 마감되었습니다.",
  );
  expect(
    screen.queryByRole("button", { name: "공고 마감" }),
  ).not.toBeInTheDocument();
});
