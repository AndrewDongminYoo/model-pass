import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "./HomePage";

const opportunityId = "00000000-0000-4000-8000-000000000123";

afterEach(() => vi.unstubAllEnvs());

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
