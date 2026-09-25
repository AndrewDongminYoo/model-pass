import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { LanguageSwitch } from "../../../i18n/LanguageSwitch";
import { I18nProvider } from "../../../i18n/I18nProvider";
import type { OpportunityDraft } from "../domain/opportunity";
import { OpportunityForm } from "./OpportunityForm";
import { OpportunityPreview } from "./OpportunityPreview";

async function completeRequiredFields(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.type(
    screen.getByLabelText("시술 또는 시험 내용"),
    "Bridal makeup practical exam",
  );
  await user.type(screen.getByLabelText("시작 일시"), "2099-06-01T10:00");
  await user.type(screen.getByLabelText("지원 마감 일시"), "2099-05-31T18:00");
  await user.clear(screen.getByLabelText("예상 소요 시간(분)"));
  await user.type(screen.getByLabelText("예상 소요 시간(분)"), "120");
}

it("rejects a paid makeup opportunity when cash amount validation is removed", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.selectOptions(
    screen.getByLabelText("모집 분야"),
    "makeup_certification",
  );
  await user.selectOptions(screen.getByLabelText("제공 혜택"), "cash");
  await user.click(screen.getByRole("button", { name: "공고 미리보기" }));

  expect(screen.getByText("지급 금액을 입력해 주세요.")).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("renders opportunity form and preview UI in English when English is selected", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  const draft: OpportunityDraft = {
    category: "hair_promotion",
    title: "Layered cut promotion exam",
    startsAt: "2099-06-01T10:00",
    closesAt: "2099-05-31T18:00",
    venueDistrict: "Gangnam-gu, Seoul",
    expectedMinutes: 90,
    benefit: { type: "procedure", description: "Free layered cut" },
    rulesetId: "hair-promotion",
    rulesetVersion: 1,
    rules: [],
  };

  window.localStorage.setItem("model-pass-locale", "en");
  try {
    render(
      <I18nProvider>
        <OpportunityForm onSubmit={onSubmit} />
        <OpportunityPreview draft={draft} />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Session details" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Opportunity preview" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Preview opportunity" }),
    );

    expect(screen.getByText("Enter the procedure.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  } finally {
    window.localStorage.removeItem("model-pass-locale");
  }
});

it("updates visible validation feedback when the locale changes", async () => {
  const user = userEvent.setup();

  window.localStorage.removeItem("model-pass-locale");
  try {
    render(
      <I18nProvider>
        <LanguageSwitch />
        <OpportunityForm onSubmit={vi.fn()} />
      </I18nProvider>,
    );

    await user.type(
      screen.getByLabelText("시술 또는 시험 내용"),
      "Layered cut promotion exam",
    );
    await user.click(screen.getByRole("button", { name: "공고 미리보기" }));

    expect(screen.getByText("시작 일시를 입력해 주세요.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByText("Enter the start date.")).toBeVisible();
    expect(screen.getByLabelText("Procedure")).toHaveValue(
      "Layered cut promotion exam",
    );
  } finally {
    window.localStorage.removeItem("model-pass-locale");
  }
});

it("updates a visible publication error when the locale changes", async () => {
  const user = userEvent.setup();
  const onPublish = vi.fn().mockRejectedValue(new Error("Unavailable"));
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
    rules: [
      {
        id: "adult-only",
        field: "isAdult",
        operator: "equals",
        expected: true,
        effect: "hard_fail",
        reason: "This pilot is available to adults only.",
      },
    ],
  };

  window.localStorage.removeItem("model-pass-locale");
  try {
    render(
      <I18nProvider>
        <LanguageSwitch />
        <OpportunityPreview draft={draft} onPublish={onPublish} />
      </I18nProvider>,
    );

    await user.click(
      screen.getByLabelText(
        "필수 조건 확인: 만 19세 이상만 지원할 수 있습니다.",
      ),
    );
    await user.click(screen.getByRole("button", { name: "공고 게시" }));

    expect(
      await screen.findByText(
        "공고를 게시하지 못했습니다. 다시 시도해 주세요.",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(
      screen.getByText("Could not publish the opportunity. Try again."),
    ).toBeVisible();
  } finally {
    window.localStorage.removeItem("model-pass-locale");
  }
});

it("allows a hair procedure benefit without a cash amount", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.selectOptions(screen.getByLabelText("제공 혜택"), "procedure");
  await user.clear(screen.getByLabelText("혜택 설명"));
  await user.type(
    screen.getByLabelText("혜택 설명"),
    "Free or nearly free cut and color",
  );
  await user.click(screen.getByRole("button", { name: "공고 미리보기" }));

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

it("adds a concrete preferred hair condition to the published preview draft", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.type(screen.getByLabelText("혜택 설명"), "무료 커트");
  await user.click(screen.getByRole("button", { name: "머리 길이 조건 추가" }));
  await user.type(
    screen.getByLabelText("질문 · 머리 길이"),
    "현재 머리가 어깨 아래까지 오나요?",
  );
  await user.selectOptions(
    screen.getByLabelText("기대 답변 · 머리 길이"),
    "yes",
  );
  await user.selectOptions(
    screen.getByLabelText("조건 유형 · 머리 길이"),
    "preferred",
  );
  await user.click(screen.getByRole("button", { name: "공고 미리보기" }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      rulesetVersion: 2,
      rules: expect.arrayContaining([
        expect.objectContaining({
          id: "current-length",
          field: "meetsCurrentLengthRequirement",
          question: {
            en: "현재 머리가 어깨 아래까지 오나요?",
            ko: "현재 머리가 어깨 아래까지 오나요?",
          },
          expected: true,
          effect: "needs_review",
        }),
      ]),
    }),
  );
});

it("blocks preview while an added condition has no question", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.type(screen.getByLabelText("혜택 설명"), "무료 커트");
  await user.click(screen.getByRole("button", { name: "머리 길이 조건 추가" }));
  await user.selectOptions(
    screen.getByLabelText("기대 답변 · 머리 길이"),
    "yes",
  );
  await user.click(screen.getByRole("button", { name: "공고 미리보기" }));

  expect(
    screen.getByText("지원자에게 보여줄 질문을 입력해 주세요."),
  ).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("keeps an authored question unchanged across language switches", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(
    <I18nProvider>
      <LanguageSwitch />
      <OpportunityForm onSubmit={onSubmit} />
    </I18nProvider>,
  );
  await completeRequiredFields(user);
  await user.type(screen.getByLabelText("혜택 설명"), "무료 커트");
  await user.click(screen.getByRole("button", { name: "머리 길이 조건 추가" }));
  await user.type(
    screen.getByLabelText("질문 · 머리 길이"),
    "현재 머리카락이 어깨 아래까지 내려오나요?",
  );
  await user.selectOptions(
    screen.getByLabelText("기대 답변 · 머리 길이"),
    "yes",
  );
  await user.click(screen.getByRole("button", { name: "English" }));

  expect(screen.getByLabelText("Question · Hair length")).toHaveValue(
    "현재 머리카락이 어깨 아래까지 내려오나요?",
  );
  await user.click(screen.getByRole("button", { name: "Preview opportunity" }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      rules: expect.arrayContaining([
        expect.objectContaining({
          question: {
            en: "현재 머리카락이 어깨 아래까지 내려오나요?",
            ko: "현재 머리카락이 어깨 아래까지 내려오나요?",
          },
        }),
      ]),
    }),
  );
});

it("requires a specified makeup model sex and previews deduction items as review", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.clear(screen.getByLabelText("시작 일시"));
  await user.type(screen.getByLabelText("시작 일시"), "2026-12-01T10:00");
  await user.clear(screen.getByLabelText("지원 마감 일시"));
  await user.type(screen.getByLabelText("지원 마감 일시"), "2026-11-30T18:00");
  await user.type(screen.getByLabelText("혜택 설명"), "시험 종료 후 현금 지급");
  await user.selectOptions(
    screen.getByLabelText("모집 분야"),
    "makeup_certification",
  );

  expect(screen.getByText("현재 속눈썹 연장을 하고 있나요?")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "2026년 큐넷 시험 공고" }),
  ).toHaveAttribute("href", expect.stringContaining("q-net.or.kr"));
  expect(screen.queryByText(/타투|헤나/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "공고 미리보기" }));
  expect(screen.getByText("필요한 모델 성별을 선택해 주세요.")).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();

  await user.selectOptions(screen.getByLabelText("필요한 모델 성별"), "female");
  await user.click(screen.getByRole("button", { name: "공고 미리보기" }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      category: "makeup_certification",
      requiredModelSex: "female",
      rulesetVersion: 2,
      rules: expect.arrayContaining([
        expect.objectContaining({
          field: "matchesRequiredSex",
          effect: "hard_fail",
          question: expect.objectContaining({
            ko: expect.stringContaining("여성"),
          }),
        }),
        expect.objectContaining({
          field: "hasEyelashExtensions",
          effect: "needs_review",
        }),
      ]),
    }),
  );
});

it("blocks a makeup preview outside the verified 2026 exam year", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.type(screen.getByLabelText("혜택 설명"), "시험 종료 후 현금 지급");
  await user.selectOptions(
    screen.getByLabelText("모집 분야"),
    "makeup_certification",
  );
  await user.selectOptions(screen.getByLabelText("필요한 모델 성별"), "female");
  await user.click(screen.getByRole("button", { name: "공고 미리보기" }));

  expect(
    screen.getByText("2026년 시험 일시만 등록할 수 있습니다."),
  ).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("rejects an opportunity when past start dates are accepted", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<OpportunityForm onSubmit={onSubmit} />);
  await completeRequiredFields(user);
  await user.clear(screen.getByLabelText("시작 일시"));
  await user.type(screen.getByLabelText("시작 일시"), "2000-01-01T10:00");
  await user.click(screen.getByRole("button", { name: "공고 미리보기" }));

  expect(screen.getByText("시작 일시는 현재 이후여야 합니다.")).toBeVisible();
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

  const copyButton = screen.getByRole("button", { name: "공고 내용 복사" });
  expect(copyButton).toBeDisabled();
  expect(screen.getByText("적용 시험 연도: 2021년")).toBeVisible();

  await user.click(
    screen.getByLabelText("공고 내용이 모집 조건과 일치하는지 확인했습니다."),
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
    screen.getByLabelText("공고 내용이 모집 조건과 일치하는지 확인했습니다."),
  );
  expect(screen.getByRole("button", { name: "공고 내용 복사" })).toBeEnabled();

  rerender(
    <OpportunityPreview draft={{ ...draft, title: "Color promotion exam" }} />,
  );

  expect(screen.getByRole("button", { name: "공고 내용 복사" })).toBeDisabled();
});

it("keeps confirmation and shows an accessible error when clipboard copying rejects", async () => {
  const user = userEvent.setup();
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
  });
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

  try {
    render(<OpportunityPreview draft={draft} />);
    const confirmation = screen.getByLabelText(
      "공고 내용이 모집 조건과 일치하는지 확인했습니다.",
    );
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: "공고 내용 복사" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "공고 내용을 복사하지 못했습니다. 다시 시도해 주세요.",
    );
    expect(confirmation).toBeChecked();
  } finally {
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  }
});

it("shows an accessible error when clipboard access is unavailable", async () => {
  const user = userEvent.setup();
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  Reflect.deleteProperty(navigator, "clipboard");
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

  try {
    render(<OpportunityPreview draft={draft} />);
    await user.click(
      screen.getByLabelText("공고 내용이 모집 조건과 일치하는지 확인했습니다."),
    );
    await user.click(screen.getByRole("button", { name: "공고 내용 복사" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "공고 내용을 복사하지 못했습니다. 다시 시도해 주세요.",
    );
  } finally {
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    }
  }
});

it("keeps publication disabled until every hard rule is confirmed", async () => {
  const user = userEvent.setup();
  const onPublish = vi.fn();
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
    rules: [
      {
        id: "adult-only",
        field: "isAdult",
        operator: "equals",
        expected: true,
        effect: "hard_fail",
        reason: "This pilot is available to adults only.",
      },
      {
        id: "schedule-available",
        field: "isAvailable",
        operator: "equals",
        expected: true,
        effect: "hard_fail",
        reason: "This schedule is unavailable.",
      },
    ],
  };

  render(<OpportunityPreview draft={draft} onPublish={onPublish} />);

  const publishButton = screen.getByRole("button", {
    name: "공고 게시",
  });
  expect(publishButton).toBeDisabled();

  await user.click(
    screen.getByLabelText("필수 조건 확인: 만 19세 이상만 지원할 수 있습니다."),
  );
  expect(publishButton).toBeDisabled();

  await user.click(
    screen.getByLabelText(
      "필수 조건 확인: 모집 일정에 참여할 수 있어야 합니다.",
    ),
  );
  expect(publishButton).toBeEnabled();
});

it("renders applicant and recruiter-review links after publication", async () => {
  const user = userEvent.setup();
  const onPublish = vi.fn().mockResolvedValue({
    opportunityId: "00000000-0000-0000-0000-000000000001",
    applicantPath: "/opportunities/00000000-0000-0000-0000-000000000001/apply",
    recruiterReviewPath:
      "/recruiter/opportunities/00000000-0000-0000-0000-000000000001/applications",
  });
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
    rules: [
      {
        id: "adult-only",
        field: "isAdult",
        operator: "equals",
        expected: true,
        effect: "hard_fail",
        reason: "This pilot is available to adults only.",
      },
    ],
  };

  render(<OpportunityPreview draft={draft} onPublish={onPublish} />);
  expect(
    screen.getByText(
      "게시한 공고는 지원 마감 전까지 앱 첫 화면에 공개됩니다. 링크가 없는 사람도 제목·일정·장소·혜택을 볼 수 있습니다.",
    ),
  ).toBeVisible();
  await user.click(
    screen.getByLabelText("필수 조건 확인: 만 19세 이상만 지원할 수 있습니다."),
  );
  await user.click(screen.getByRole("button", { name: "공고 게시" }));

  expect(
    await screen.findByRole("link", { name: "모델 지원 링크" }),
  ).toHaveAttribute(
    "href",
    "/opportunities/00000000-0000-0000-0000-000000000001/apply",
  );
  expect(
    screen.getByRole("link", { name: "지원 내역 확인 링크" }),
  ).toHaveAttribute(
    "href",
    "/recruiter/opportunities/00000000-0000-0000-0000-000000000001/applications",
  );
  const expectedUrl = `${window.location.origin}/opportunities/00000000-0000-0000-0000-000000000001/apply`;
  expect(screen.getByLabelText("공유할 지원 링크")).toHaveValue(expectedUrl);
  await user.click(screen.getByRole("button", { name: "지원 링크 복사" }));
  expect(await navigator.clipboard.readText()).toBe(expectedUrl);
  expect(onPublish).toHaveBeenCalledWith(draft, ["adult-only"]);
});
