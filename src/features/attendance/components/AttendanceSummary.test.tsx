import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { AttendanceSummary } from "./AttendanceSummary";

it("renders separate factual counts and timestamped history without a score", () => {
  // Production break: replacing facts with a combined trust score creates prohibited candidate ranking.
  render(
    <AttendanceSummary
      viewerParty="recruiter"
      events={[
        {
          id: "1",
          eventType: "applicant_confirmed",
          party: "applicant",
          occurredAt: "2026-09-22T03:00:00.000Z",
        },
        {
          id: "2",
          eventType: "completed",
          party: "applicant",
          occurredAt: "2026-09-23T04:00:00.000Z",
        },
      ]}
    />,
  );

  const applicant = screen.getByRole("group", { name: "Applicant facts" });
  expect(within(applicant).getByText("Confirmed: 1")).toBeVisible();
  expect(within(applicant).getByText("Completed: 1")).toBeVisible();
  expect(screen.getByText("2026-09-23T04:00:00.000Z")).toBeVisible();
  expect(screen.queryByText(/score|rating|rank/i)).not.toBeInTheDocument();
});
