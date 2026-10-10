import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApplicationLookupPage } from "./ApplicationLookupPage";

const { getAttendanceMock, resolveApplicationMock } = vi.hoisted(() => ({
  getAttendanceMock: vi.fn(),
  resolveApplicationMock: vi.fn(),
}));

vi.mock("../api/attendance", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/attendance")>();
  return { ...original, getAttendance: getAttendanceMock };
});

vi.mock("../api/resolve-application", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../api/resolve-application")>();
  return { ...original, resolveApplication: resolveApplicationMock };
});

const applicationId = "00000000-0000-4000-8000-000000000101";
const submissionAttemptId = "00000000-0000-4000-8000-000000000201";
const opportunityId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  getAttendanceMock.mockResolvedValue({
    applicationId,
    viewerParty: "applicant",
    selected: true,
    canUnselect: false,
    allowedActions: ["applicant_confirmed"],
    events: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function submitReceipt(
  user: ReturnType<typeof userEvent.setup>,
  receipt = applicationId,
  code = submissionAttemptId,
) {
  await user.type(screen.getByLabelText("접수 번호"), receipt);
  await user.type(screen.getByLabelText("비공개 관리 코드"), code);
  await user.click(screen.getByRole("button", { name: "지원 내역 확인" }));
}

it("opens attendance confirmation for a matching receipt", async () => {
  // Production break: without this page, a closed opportunity leaves applicants no way to confirm attendance.
  const user = userEvent.setup();
  resolveApplicationMock.mockResolvedValue({
    status: "found",
    opportunityId,
  });
  render(<ApplicationLookupPage />);

  await submitReceipt(user);

  expect(resolveApplicationMock).toHaveBeenCalledWith({
    applicationId,
    submissionAttemptId,
  });
  expect(
    await screen.findByRole("button", { name: "참여 확정" }),
  ).toBeVisible();
  expect(getAttendanceMock).toHaveBeenCalledWith({
    applicationId,
    opportunityId,
    submissionAttemptId,
  });
  expect(screen.getByRole("heading", { name: "지원 내역" })).toBeVisible();
});

it("shows one generic message when no application matches", async () => {
  const user = userEvent.setup();
  resolveApplicationMock.mockResolvedValue({ status: "not_found" });
  render(<ApplicationLookupPage />);

  await submitReceipt(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "일치하는 지원 내역이 없습니다. 접수 번호와 비공개 관리 코드를 다시 확인해 주세요.",
  );
  expect(getAttendanceMock).not.toHaveBeenCalled();
});

it("rejects malformed codes without calling the server", async () => {
  const user = userEvent.setup();
  render(<ApplicationLookupPage />);

  await submitReceipt(user, "not-a-receipt", "not-a-code");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "올바른 접수 번호와 비공개 관리 코드를 입력해 주세요.",
  );
  expect(resolveApplicationMock).not.toHaveBeenCalled();
});

it("keeps the entered codes after a server error", async () => {
  const user = userEvent.setup();
  resolveApplicationMock.mockRejectedValue(new Error("Network unavailable"));
  render(<ApplicationLookupPage />);

  await submitReceipt(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "지원 내역을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  );
  expect(screen.getByLabelText("접수 번호")).toHaveValue(applicationId);
});
