import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
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

it("renders the working product name", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "Model Pass" })).toBeVisible();
});

it("denies anonymous recruiters access to opportunity publication", async () => {
  render(<App />);

  expect(
    await screen.findByRole("heading", { name: "Recruiter sign in" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Create opportunity" }),
  ).not.toBeInTheDocument();
});

it("allows an authenticated recruiter to reach opportunity drafting", async () => {
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
    await screen.findByLabelText("Email"),
    "recruiter@example.com",
  );
  await user.type(
    screen.getByLabelText("Password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Create opportunity" }),
    ).toBeVisible(),
  );
  expect(authMock.signInWithPassword).toHaveBeenCalledWith({
    email: "recruiter@example.com",
    password: "correct horse battery staple",
  });
});
