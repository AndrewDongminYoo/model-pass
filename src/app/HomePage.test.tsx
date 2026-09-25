import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "./HomePage";

const opportunityId = "00000000-0000-4000-8000-000000000123";
const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock("../features/opportunities/api/list-public-opportunities", () => ({
  listPublicOpportunities: listMock,
}));

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue([]);
});

function renderAitHome() {
  vi.stubEnv("VITE_APP_SURFACE", "ait");
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/opportunities/:opportunityId/apply"
          element={<h1>Opened opportunity</h1>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

it("opens a shared applicant URL inside the miniapp", async () => {
  const user = userEvent.setup();
  renderAitHome();

  await user.type(
    screen.getByLabelText("공고 링크"),
    `https://pilot.example/opportunities/${opportunityId}/apply`,
  );
  await user.click(screen.getByRole("button", { name: "공고 확인하기" }));

  expect(
    screen.getByRole("heading", { name: "Opened opportunity" }),
  ).toBeVisible();
  expect(screen.queryByRole("link", { name: "모집 공고 만들기" })).toBeNull();
});

it("rejects an unrelated link without navigating away", async () => {
  const user = userEvent.setup();
  renderAitHome();

  await user.type(
    screen.getByLabelText("공고 링크"),
    `https://pilot.example/recruiter/opportunities/${opportunityId}/applications`,
  );
  await user.click(screen.getByRole("button", { name: "공고 확인하기" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "모델패스 공고 링크를 확인해 주세요.",
  );
  expect(
    screen.queryByRole("heading", { name: "Opened opportunity" }),
  ).toBeNull();
});

it("accepts a miniapp deep link", async () => {
  const user = userEvent.setup();
  renderAitHome();

  const input = screen.getByLabelText("공고 링크");
  await user.type(
    input,
    `intoss://model-pass/opportunities/${opportunityId}/apply`,
  );
  await user.click(screen.getByRole("button", { name: "공고 확인하기" }));
  expect(
    screen.getByRole("heading", { name: "Opened opportunity" }),
  ).toBeVisible();
});

it("opens an active opportunity from the home card without a shared link", async () => {
  // Production break: the first-time visitor sees a card but cannot enter the applicant flow.
  listMock.mockResolvedValue([
    {
      id: opportunityId,
      category: "hair_promotion",
      title: "Gangnam hair promotion model",
      startsAt: "2026-09-29T03:00:00.000Z",
      closesAt: "2026-09-28T03:00:00.000Z",
      venueDistrict: "서울 강남구",
      expectedMinutes: 120,
      benefit: { type: "procedure", description: "Free haircut" },
    },
  ]);
  const user = userEvent.setup();
  renderAitHome();

  expect(await screen.findByText("Gangnam hair promotion model")).toBeVisible();
  expect(screen.getByText("서울 강남구")).toBeVisible();
  await user.click(screen.getByRole("link", { name: "지원 조건 확인하기" }));

  expect(
    screen.getByRole("heading", { name: "Opened opportunity" }),
  ).toBeVisible();
});

it("explains an empty list while retaining link entry", async () => {
  // Production break: an empty result leaves the home screen looking broken.
  renderAitHome();

  expect(
    await screen.findByText("지금 열려 있는 공고가 없습니다."),
  ).toBeVisible();
  expect(screen.getByLabelText("공고 링크")).toBeVisible();
});

it("lets the visitor retry a failed public list read", async () => {
  // Production break: a transient network error strands the visitor on a dead-end message.
  listMock.mockRejectedValueOnce(new Error("Network unavailable"));
  listMock.mockResolvedValueOnce([]);
  const user = userEvent.setup();
  renderAitHome();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "공고 목록을 불러오지 못했습니다.",
  );
  await user.click(screen.getByRole("button", { name: "다시 시도" }));

  expect(
    await screen.findByText("지금 열려 있는 공고가 없습니다."),
  ).toBeVisible();
  expect(listMock).toHaveBeenCalledTimes(2);
});
