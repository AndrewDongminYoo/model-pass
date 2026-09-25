import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";

const { authMock } = vi.hoisted(() => ({
  authMock: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
  },
}));

vi.mock("../lib/supabase/client", () => ({
  getSupabaseClient: () => ({ auth: authMock }),
}));

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  authMock.getSession.mockReset();
  authMock.onAuthStateChange.mockReset();
  authMock.signInWithPassword.mockReset();
  authMock.getSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
  authMock.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
});

afterEach(() => vi.unstubAllEnvs());

it("renders the working product name", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "모델패스" })).toBeVisible();
  expect(screen.getByText(/헤어·메이크업 시험 모델/)).toBeVisible();
  expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
});

it("switches the home screen to English and keeps the choice after remount", async () => {
  const user = userEvent.setup();
  const view = render(<App />);

  await user.click(screen.getByRole("button", { name: "English" }));

  expect(screen.getByRole("heading", { name: "Model Pass" })).toBeVisible();
  expect(screen.getByText(/Hair and makeup exam models/)).toBeVisible();
  expect(document.documentElement).toHaveAttribute("lang", "en");
  expect(document.title).toBe("Model Pass");

  view.unmount();
  render(<App />);
  expect(screen.getByRole("heading", { name: "Model Pass" })).toBeVisible();
});

it("denies anonymous recruiters access to opportunity publication", async () => {
  window.history.replaceState({}, "", "/opportunities/new");
  render(<App />);

  expect(
    await screen.findByRole("heading", { name: "모집자 로그인" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "모집 공고 만들기" }),
  ).not.toBeInTheDocument();
});

it.each([
  "/opportunities/new",
  "/recruiter/opportunities/00000000-0000-4000-8000-000000000123/applications",
])("does not expose recruiter sign-in in the miniapp at %s", async (path) => {
  vi.stubEnv("VITE_APP_SURFACE", "ait");
  window.history.replaceState({}, "", path);

  render(<App />);

  expect(screen.getByRole("heading", { name: "모델패스" })).toBeVisible();
  expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
  expect(authMock.getSession).not.toHaveBeenCalled();
});

it("switches recruiter sign-in copy without discarding typed credentials", async () => {
  window.history.replaceState({}, "", "/opportunities/new");
  const user = userEvent.setup();
  render(<App />);

  const email = await screen.findByLabelText("이메일");
  await user.type(email, "recruiter@example.com");
  await user.click(screen.getByRole("button", { name: "English" }));

  expect(
    screen.getByRole("heading", { name: "Recruiter sign in" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Email")).toHaveValue("recruiter@example.com");
});

it("allows an authenticated recruiter to reach opportunity drafting", async () => {
  window.history.replaceState({}, "", "/opportunities/new");
  const user = userEvent.setup();
  authMock.signInWithPassword.mockResolvedValue({
    data: {
      user: { id: "00000000-0000-0000-0000-000000000111" },
      session: { access_token: "recruiter-token" },
    },
    error: null,
  });

  render(<App />);
  await user.type(
    await screen.findByLabelText("이메일"),
    "recruiter@example.com",
  );
  await user.type(
    screen.getByLabelText("비밀번호"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "로그인" }));

  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "모집 공고 만들기" }),
    ).toBeVisible(),
  );
  expect(authMock.signInWithPassword).toHaveBeenCalledWith({
    email: "recruiter@example.com",
    password: "correct horse battery staple",
  });
});
