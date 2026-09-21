import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the working product name", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "Model Pass" })).toBeVisible();
});
