import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/I18nProvider";
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

  const applicant = screen.getByRole("group", { name: "지원자 기록" });
  expect(within(applicant).getByText("참여 확정: 1")).toBeVisible();
  expect(within(applicant).getByText("일정 완료: 1")).toBeVisible();
  expect(
    screen.getByText(
      new Date("2026-09-23T04:00:00.000Z").toLocaleString("ko-KR"),
    ),
  ).toBeVisible();
  expect(screen.queryByText(/score|rating|rank/i)).not.toBeInTheDocument();
});

it("does not render unresolved disputed no-show history to the counterparty", () => {
  render(
    <AttendanceSummary
      viewerParty="recruiter"
      events={[
        {
          id: "no-show",
          eventType: "applicant_no_show",
          party: "applicant",
          occurredAt: "2026-09-22T03:00:00.000Z",
        },
        {
          id: "dispute",
          eventType: "dispute_opened",
          party: "applicant",
          relatedEventId: "no-show",
          occurredAt: "2026-09-22T04:00:00.000Z",
        },
      ]}
    />,
  );

  expect(screen.queryByText("applicant_no_show")).not.toBeInTheDocument();
  expect(screen.queryByText("dispute_opened")).not.toBeInTheDocument();
  expect(
    screen.queryByText("2026-09-22T03:00:00.000Z"),
  ).not.toBeInTheDocument();
});

it("renders attendance event enums in English when English is selected", () => {
  // Production break: exposing stored event enum values makes attendance history unreadable outside Korean.
  localStorage.setItem("model-pass-locale", "en");
  render(
    <I18nProvider>
      <AttendanceSummary
        viewerParty="recruiter"
        events={[
          {
            id: "completed",
            eventType: "completed",
            party: "applicant",
            occurredAt: "2026-09-23T04:00:00.000Z",
          },
        ]}
      />
    </I18nProvider>,
  );

  expect(
    screen.getByRole("heading", { name: "Attendance history" }),
  ).toBeVisible();
  expect(screen.getByText("Applicant: Schedule completed")).toBeVisible();
  expect(
    screen.getByText(
      new Date("2026-09-23T04:00:00.000Z").toLocaleString("en-US"),
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("group", { name: "Applicant facts" })).getByText(
      "Completed: 1",
    ),
  ).toBeVisible();
  localStorage.clear();
});
