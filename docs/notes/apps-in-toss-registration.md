# Apps in Toss Registration Draft

## Status

This is a draft for review, not an approved app registration or release.
The Model Pass miniapp and service pre-review have not yet been created or completed, as confirmed by the operator on 2026-09-23.
Do not submit the app or activate Toss Login from this draft alone.
The interface defaults to Korean and supports an English switch across application screens; recruiter-written opportunity content stays in its original language.

## Console Fields

| Field            | Draft value                                                          | Status                                                                                                                         |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Korean app name  | 모델패스                                                             | Working title; confirm before registration                                                                                     |
| English app name | Model Pass                                                           | Preserved in `src/i18n/brand.ts`                                                                                               |
| Subtitle         | 헤어·메이크업 모델 지원                                              | 13 characters, within the operator's 20-character limit                                                                        |
| appName          | `model-pass`                                                         | Proposed only; immutable after registration, so confirm availability and spelling before creation                              |
| App type         | Non-game                                                             | Proposed                                                                                                                       |
| Category         | 생활 > 비즈니스 > 구인구직 (`categoryId: 3832`, `subCategoryId: 22`) | Proposed from the Apps in Toss console MCP `miniapp_category_list` response on 2026-09-23; subject to service/legal pre-review |

## Detailed Description

헤어 디자이너 승급 시험과 메이크업 국가자격 실기시험에 필요한 모델을 모집할 때, 조건을 분명하게 확인하고 지원할 수 있는 서비스입니다.
모집자가 공유한 공고 링크를 열면 일정, 장소, 예상 소요 시간, 시술 또는 현금 보상 내용을 볼 수 있습니다.
지원자는 필수 조건을 먼저 확인한 뒤 해당 공고에 필요한 정보만 입력해 지원합니다.
모집자는 공고별 조건을 정리하고 지원 내용을 한곳에서 확인할 수 있습니다.
현재 공개 공고 목록이나 자동 매칭은 제공하지 않습니다.

## Assets

- Logo: pending comparison with icons from miniapps in the proposed category; do not submit the current draft.
- Intro screenshot: `assets/apps-in-toss/screenshot-01-intro.png` (636 × 1048 PNG).
- Opportunity screenshot: `assets/apps-in-toss/screenshot-02-opportunity.png` (636 × 1048 PNG).
- Application screenshot: `assets/apps-in-toss/screenshot-03-application.png` (636 × 1048 PNG).

The screenshots are browser captures of the current app with a local sample opportunity returned by `scripts/capture-store-screenshots.mjs`.
They are not evidence that a live opportunity or Apps in Toss build exists.
Regenerate them after any relevant UI change and inspect all three images before submission.
To regenerate, start Vite with non-production placeholder values in one terminal, then run the capture script in another:

```sh
VITE_SUPABASE_URL=https://model-pass.example.invalid VITE_SUPABASE_ANON_KEY=screenshot-only pnpm dev --host 127.0.0.1 --port 5173
node scripts/capture-store-screenshots.mjs
```

## Gates Before Registration or Review

- Confirm the Korean and English names and the immutable `appName` with the operator.
- Review the final 600 × 600 logo against comparable miniapps before submission.
- Complete the product-spec service classification and platform pre-review for this recruitment use case.
- Create the Model Pass miniapp in the verified personal workspace, then configure its exact console appName, terms, privacy links, and Toss Login settings.
- Implement the Toss WebView SDK and a server-side mTLS code exchange, then connect Toss identity to the existing Supabase authorization and disconnection lifecycle.
- Replace sample captures with final, tested production-flow screenshots before review submission.

## Sources

- Apps in Toss miniapp registration guide, accessed 2026-09-23: <https://developers-apps-in-toss.toss.im/guide/operation/console-workspace.md>
- Apps in Toss non-game checklist, accessed 2026-09-23: <https://developers-apps-in-toss.toss.im/checklist/app-nongame.md>
- Apps in Toss Toss Login documentation, accessed 2026-09-23: <https://developers-apps-in-toss.toss.im/documentation/common/authentication/toss-login.md>
