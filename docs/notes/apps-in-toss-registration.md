# Apps in Toss Registration Draft

## Status

This is draft registration copy, not evidence of an approved app or release.
The miniapp creation and service pre-review status must be confirmed in the console before review submission.
Do not activate Toss Login from this draft alone.
The interface defaults to Korean and supports an English switch across application screens; recruiter-written opportunity content stays in its original language.

## Console Fields

| Field            | Draft value                                                          | Status                                                                                                                         |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Korean app name  | 모델패스                                                             | Working title; confirm before registration                                                                                     |
| English app name | Model Pass                                                           | Preserved in `src/i18n/brand.ts`                                                                                               |
| Subtitle         | 시험 모델 지원, 조건부터 확인                                        | 17 characters, within the operator's 20-character limit                                                                        |
| appName          | `model-pass`                                                         | Proposed only; immutable after registration, so confirm availability and spelling before creation                              |
| App type         | Non-game                                                             | Proposed                                                                                                                       |
| Category         | 생활 > 비즈니스 > 구인구직 (`categoryId: 3832`, `subCategoryId: 22`) | Proposed from the Apps in Toss console MCP `miniapp_category_list` response on 2026-09-23; subject to service/legal pre-review |

## Search Keywords

헤어모델, 메이크업모델, 시험모델, 헤어시험모델, 메이크업시험모델, 미용실모델, 디자이너시험, 메이크업실기시험, 모델지원, 모델모집

## Detailed Description

헤어 디자이너 승급 시험이나 메이크업 실기시험에 모델로 참여하고 싶다면, 모집자가 공유한 공고 링크에서 일정, 장소, 예상 소요 시간과 시술 또는 현금 보상 내용을 확인할 수 있습니다.
공고에 필요한 질문에 답하고 '지원 조건 확인'을 누르면 지원 가능 여부와 방문 전 안내를 볼 수 있습니다.
지원할 수 있다면 '지원서 작성하기'를 눌러 이름 또는 별명, 전화번호, 생년월일을 입력하고 필수 동의 후 '지원서 제출'을 누릅니다.
제출 후 발급되는 접수 번호와 비공개 관리 코드로 지원 내역을 다시 확인할 수 있습니다.
모집자는 시험 일정과 필요한 조건을 적어 공고를 게시하고, 지원 내용을 한곳에서 확인한 뒤 참여자를 직접 선택합니다.

## Assets

- Logo: `public/brand/model-pass-logo.png` (600 × 600 PNG); the operator selected the person-shaped design for readability at small sizes on 2026-09-23.
- Intro screenshot: `assets/apps-in-toss/screenshot-01-intro.png` (636 × 1048 PNG).
- Opportunity screenshot: `assets/apps-in-toss/screenshot-02-opportunity.png` (636 × 1048 PNG).
- Application screenshot: `assets/apps-in-toss/screenshot-03-application.png` (636 × 1048 PNG).

The screenshots are browser captures of the current app with a local opportunity clearly labeled as an example and returned by `scripts/capture-store-screenshots.mjs`.
They are not evidence that a live opportunity or Apps in Toss build exists.
Regenerate them after any relevant UI change and inspect all three images before submission.
To regenerate, start Vite with non-production placeholder values in one terminal, then run the capture script in another:

```sh
VITE_SUPABASE_URL=https://model-pass.example.invalid VITE_SUPABASE_ANON_KEY=screenshot-only pnpm dev --host 127.0.0.1 --port 5173
node scripts/capture-store-screenshots.mjs
```

## Gates Before Registration or Review

- Confirm the Korean and English names and the immutable `appName` with the operator.
- Verify the selected logo in the Apps in Toss console preview before submission.
- Complete the product-spec service classification and platform pre-review for this recruitment use case.
- Create the Model Pass miniapp in the verified personal workspace, then configure its exact console appName, terms, privacy links, and Toss Login settings.
- Implement the Toss WebView SDK and a server-side mTLS code exchange, then connect Toss identity to the existing Supabase authorization and disconnection lifecycle.
- Replace sample captures with final, tested production-flow screenshots before review submission.

## Sources

- Apps in Toss miniapp registration guide, accessed 2026-09-23: <https://developers-apps-in-toss.toss.im/guide/operation/console-workspace.md>
- Apps in Toss non-game checklist, accessed 2026-09-23: <https://developers-apps-in-toss.toss.im/checklist/app-nongame.md>
- Apps in Toss Toss Login documentation, accessed 2026-09-23: <https://developers-apps-in-toss.toss.im/documentation/common/authentication/toss-login.md>
