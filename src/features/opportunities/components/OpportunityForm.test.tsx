import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { OpportunityDraft } from "../domain/opportunity";
import { OpportunityForm } from "./OpportunityForm";
import { OpportunityPreview } from "./OpportunityPreview";

async function completeRequiredFields(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.type(
    screen.getByLabelText("Procedure"),
    "Bridal makeup practical exam",
  );
  await user.type(screen.getByLabelText("Starts at"), "2099-06-01T10:00");
  await user.type(screen.getByLabelText("Closes at"), "2099-05-31T18:00");
  await user.clear(screen.getByLabelText("Expected duration (minutes)"));
  await user.type(screen.getByLabelText("Expected duration (minutes)"), "120");
}

it("rejects a paid makeup opportunity when cash amount validation is removed", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.selectOptions(
    screen.getByLabelText("Category"),
    "makeup_certification",
  );
  await user.selectOptions(screen.getByLabelText("Benefit type"), "cash");
  await user.click(screen.getByRole("button", { name: "Preview opportunity" }));

  expect(screen.getByText("Enter the cash amount.")).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("allows a hair procedure benefit without a cash amount", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.selectOptions(screen.getByLabelText("Benefit type"), "procedure");
  await user.clear(screen.getByLabelText("Benefit description"));
  await user.type(
    screen.getByLabelText("Benefit description"),
    "Free or nearly free cut and color",
  );
  await user.click(screen.getByRole("button", { name: "Preview opportunity" }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      category: "hair_promotion",
      venueDistrict: "서울 강남구",
      benefit: {
        type: "procedure",
        description: "Free or nearly free cut and color",
      },
    }),
  );
});

it("rejects an opportunity when past start dates are accepted", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.clear(screen.getByLabelText("Starts at"));
  await user.type(screen.getByLabelText("Starts at"), "2000-01-01T10:00");
  await user.click(screen.getByRole("button", { name: "Preview opportunity" }));

  expect(screen.getByText("Start date must be in the future.")).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("keeps copying disabled until the recruiter confirms the preview", async () => {
  const user = userEvent.setup();
  const draft: OpportunityDraft = {
    category: "makeup_certification",
    title: "Bridal makeup practical exam",
    startsAt: "2099-06-01T10:00",
    closesAt: "2099-05-31T18:00",
    venueDistrict: "서울 강남구",
    expectedMinutes: 120,
    benefit: {
      type: "cash",
      amount: 100000,
      description: "Cash after the exam",
    },
    rulesetId: "makeup-certification",
    rulesetVersion: 1,
    rules: [],
  };

  render(<OpportunityPreview draft={draft} applicableExamYear={2021} />);

  const copyButton = screen.getByRole("button", { name: "Copy opportunity" });
  expect(copyButton).toBeDisabled();
  expect(screen.getByText("Applicable exam year: 2021")).toBeVisible();

  await user.click(
    screen.getByLabelText(
      "I confirm this preview matches the intended opportunity.",
    ),
  );

  expect(copyButton).toBeEnabled();
});

it("requires reconfirmation when a confirmed preview is replaced", async () => {
  const user = userEvent.setup();
  const draft: OpportunityDraft = {
    category: "hair_promotion",
    title: "Layered cut promotion exam",
    startsAt: "2099-06-01T10:00",
    closesAt: "2099-05-31T18:00",
    venueDistrict: "서울 강남구",
    expectedMinutes: 90,
    benefit: { type: "procedure", description: "Free layered cut" },
    rulesetId: "hair-promotion",
    rulesetVersion: 1,
    rules: [],
  };
  const { rerender } = render(<OpportunityPreview draft={draft} />);

  await user.click(
    screen.getByLabelText(
      "I confirm this preview matches the intended opportunity.",
    ),
  );
  expect(
    screen.getByRole("button", { name: "Copy opportunity" }),
  ).toBeEnabled();

  rerender(
    <OpportunityPreview draft={{ ...draft, title: "Color promotion exam" }} />,
  );

  expect(
    screen.getByRole("button", { name: "Copy opportunity" }),
  ).toBeDisabled();
});
