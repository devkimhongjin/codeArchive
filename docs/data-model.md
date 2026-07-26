# 데이터 모델

> 현재 계약 버전: 1  
> 근거: `docs/adr/ADR-0001-core-data-contract.md`  
> 구현: `src/common/types/index.ts`, `src/common/validators/index.ts`

CodeArchive의 핵심 데이터 계약은 문제, 풀이 세션, 제출과 풀이 중 AI 활용 기록을 분리한다.
현재 구현은 타입, 런타임 파서, aggregate 관계 검증과 중복 후보 비교를 제공한다.
IndexedDB object store, migration과 rollback은 TASK-0003 범위이며 아직 구현된 것으로 보지
않는다.

## 관계

```text
Problem 1 ── * SolutionSession 1 ── * Submission
                         │
                         └── 1 AIUsageRecord
```

- 하나의 문제는 여러 풀이 세션을 가진다.
- 하나의 풀이 세션은 여러 제출을 가질 수 있다.
- 모든 풀이 세션은 정확히 하나의 AI 활용 기록을 가진다.
- 복습과 다른 언어 풀이는 기존 세션을 덮어쓰지 않고 새 SolutionSession으로 저장한다.
- Submission의 언어는 연결된 SolutionSession의 언어와 같아야 한다.
- aggregate 파서는 존재하지 않는 Problem/Session 참조와 AI 기록 0개 또는 2개 이상을
  `invalid_relation`으로 거부한다.

## 공통 규칙

### ID

ID는 `<namespace>:<uuid-v4>` 형식의 namespaced UUID다.

| 엔터티          | namespace          | 예시                                                    |
| --------------- | ------------------ | ------------------------------------------------------- |
| Problem         | `problem`          | `problem:550e8400-e29b-41d4-a716-446655440000`          |
| SolutionSession | `solution-session` | `solution-session:550e8400-e29b-41d4-a716-446655440000` |
| Submission      | `submission`       | `submission:550e8400-e29b-41d4-a716-446655440000`       |
| AIUsageRecord   | `ai-usage`         | `ai-usage:550e8400-e29b-41d4-a716-446655440000`         |

UUID 부분은 `crypto.randomUUID()`로 생성한다. 플랫폼 ID나 문제 번호 같은 자연키는 참조
ID로 사용하지 않고 중복 후보 탐지에만 사용한다.

### 버전, 시간과 날짜

- 모든 엔터티는 현재 `schemaVersion: 1`만 허용한다.
- 지원하지 않는 버전은 `unsupported_schema_version`으로 거부한다.
- 시각은 UTC RFC 3339 밀리초 형식 `YYYY-MM-DDTHH:mm:ss.sssZ`만 허용한다.
- `updatedAt`과 AI의 `recordedAt`은 `createdAt`보다 빠를 수 없다.
- 사용자 달력 날짜인 `reviewDate`만 유효한 `YYYY-MM-DD` 형식을 사용한다.
- v1 migration은 없으며 이후 버전 migration은 별도 설계와 검증이 필요하다.

### 공통 enum

- `Platform`: `swea`, `programmers`, `jungol`, `leetcode`
- `ProgrammingLanguage`: `java`, `python`, `c`, `cpp`, `javascript`,
  `typescript`, `kotlin`, `csharp`, `go`, `swift`, `rust`
- `RecordSource`: `auto-captured`, `manual`, `source-file`, `markdown-import`,
  `json-import`, `github-import`, `notion-import`, `platform-history`
- `SubmissionResult`: `accepted`, `wrong-answer`, `compile-error`, `runtime-error`,
  `time-limit-exceeded`, `memory-limit-exceeded`, `presentation-error`, `other`, `unknown`

일부 RecordSource는 향후 계약을 보존하기 위한 값이며 해당 가져오기 기능의 구현 완료를
뜻하지 않는다.

## Problem

문제 자체의 플랫폼 메타데이터를 보존한다.

| 필드                | 타입           | 필수   | 규칙                                        |
| ------------------- | -------------- | ------ | ------------------------------------------- |
| `schemaVersion`     | `1`            | 예     | 현재 1만 허용                               |
| `id`                | `ProblemId`    | 예     | `problem:<uuid-v4>`                         |
| `platform`          | `Platform`     | 예     | 지원 enum                                   |
| `platformProblemId` | `string`       | 아니요 | 비어 있지 않은 문자열                       |
| `problemNumber`     | `string`       | 아니요 | 비어 있지 않은 문자열                       |
| `title`             | `string`       | 아니요 | 비어 있지 않은 문자열                       |
| `url`               | `string`       | 아니요 | HTTPS 절대 URL, 정규화 후 저장              |
| `difficulty`        | `string`       | 아니요 | 플랫폼 표시값                               |
| `tags`              | `string[]`     | 예     | trim, 빈 값 제거, 중복 제거, 최초 순서 보존 |
| `source`            | `RecordSource` | 예     | 데이터 출처                                 |
| `createdAt`         | `UtcTimestamp` | 예     | UTC RFC 3339 밀리초                         |
| `updatedAt`         | `UtcTimestamp` | 예     | `createdAt` 이상                            |

`platformProblemId`, `problemNumber`, `title` 중 하나 이상이 필요하다. `source`가
`auto-captured`이면 `problemNumber`와 `title`이 모두 필요하다. 문제 원문, 공식 해설과 전체
테스트 케이스는 이 엔터티에 저장하지 않는다.

## SolutionSession

한 번의 풀이 또는 복습과 그 최종 상태를 보존한다.

| 필드              | 타입                  | 필수   | 규칙                                            |
| ----------------- | --------------------- | ------ | ----------------------------------------------- |
| `schemaVersion`   | `1`                   | 예     | 현재 1만 허용                                   |
| `id`              | `SolutionSessionId`   | 예     | `solution-session:<uuid-v4>`                    |
| `problemId`       | `ProblemId`           | 예     | 존재하는 Problem 참조                           |
| `language`        | `ProgrammingLanguage` | 예     | 지원 enum                                       |
| `result`          | `SubmissionResult`    | 예     | 지원 enum                                       |
| `code`            | `string`              | 아니요 | 코드 없는 등록 허용, 값이 있으면 빈 문자열 금지 |
| `solvedAt`        | `UtcTimestamp`        | 아니요 | UTC RFC 3339 밀리초                             |
| `summary`         | `string`              | 아니요 | 풀이 요약                                       |
| `approach`        | `string`              | 아니요 | 풀이 접근                                       |
| `timeComplexity`  | `string`              | 아니요 | 표시 문자열                                     |
| `spaceComplexity` | `string`              | 아니요 | 표시 문자열                                     |
| `mistakes`        | `string[]`            | 예     | 오답 원인 목록                                  |
| `reviewRequired`  | `boolean`             | 예     | 복습 필요 여부                                  |
| `reviewDate`      | `CalendarDate`        | 아니요 | 있으면 `reviewRequired: true`                   |
| `source`          | `RecordSource`        | 예     | 데이터 출처                                     |
| `githubFilePath`  | `string`              | 아니요 | 정규화한 상대 경로                              |
| `codeHash`        | `string`              | 아니요 | UTF-8 코드의 SHA-256 소문자 64자리 hex          |
| `createdAt`       | `UtcTimestamp`        | 예     | UTC RFC 3339 밀리초                             |
| `updatedAt`       | `UtcTimestamp`        | 예     | `createdAt` 이상                                |

풀이 후 AI 코드 리뷰는 SolutionSession이나 AIUsageRecord에 포함하지 않는다. 풀이 중 AI
활용과 사후 리뷰는 별도 개념이다.

## Submission

풀이 세션에서 발생한 개별 제출 스냅샷을 보존한다.

| 필드                   | 타입                  | 필수   | 규칙                                    |
| ---------------------- | --------------------- | ------ | --------------------------------------- |
| `schemaVersion`        | `1`                   | 예     | 현재 1만 허용                           |
| `id`                   | `SubmissionId`        | 예     | `submission:<uuid-v4>`                  |
| `solutionSessionId`    | `SolutionSessionId`   | 예     | 존재하는 Session 참조                   |
| `platformSubmissionId` | `string`              | 아니요 | 플랫폼 제공 ID                          |
| `result`               | `SubmissionResult`    | 예     | 지원 enum                               |
| `language`             | `ProgrammingLanguage` | 예     | 연결 Session 언어와 동일                |
| `code`                 | `string`              | 아니요 | 접근 제한을 고려해 선택, 빈 문자열 금지 |
| `executionTimeMs`      | `number`              | 아니요 | 0 이상의 정수, 단위 ms                  |
| `memoryKiB`            | `number`              | 아니요 | 0 이상의 정수, 단위 KiB                 |
| `submittedAt`          | `UtcTimestamp`        | 예     | UTC RFC 3339 밀리초                     |
| `source`               | `RecordSource`        | 예     | 데이터 출처                             |
| `createdAt`            | `UtcTimestamp`        | 예     | UTC RFC 3339 밀리초                     |

`"120ms"`나 `"25MB"` 같은 플랫폼 표시 문자열은 경계에서 표준 숫자 단위로 변환한 뒤
저장한다.

## AIUsageRecord

풀이 세션 중 AI 활용을 독립적으로 보존한다.

| 필드                 | 타입                 | 필수   | 규칙                 |
| -------------------- | -------------------- | ------ | -------------------- |
| `schemaVersion`      | `1`                  | 예     | 현재 1만 허용        |
| `id`                 | `AIUsageRecordId`    | 예     | `ai-usage:<uuid-v4>` |
| `solutionSessionId`  | `SolutionSessionId`  | 예     | Session당 정확히 1개 |
| `level`              | `AIUsageLevel`       | 예     | 아래 enum            |
| `purposes`           | `AIUsagePurpose[]`   | 예     | 지원 목적만 허용     |
| `provider`           | `string`             | 아니요 | AI 서비스            |
| `model`              | `string`             | 아니요 | 사용 모델            |
| `promptSummary`      | `string`             | 아니요 | 질문 요약            |
| `referencedContent`  | `string`             | 아니요 | 참고 범위            |
| `contributionRate`   | `AIContributionRate` | 아니요 | 구간 enum            |
| `copiedDirectly`     | `boolean`            | 아니요 | 직접 사용 여부       |
| `modifiedAfterUse`   | `boolean`            | 아니요 | 사용 후 수정 여부    |
| `understandingLevel` | `UnderstandingLevel` | 아니요 | 이해도 enum          |
| `solvableWithoutAI`  | `SolvableWithoutAI`  | 아니요 | 재풀이 가능성 enum   |
| `explanationAbility` | `ExplanationAbility` | 아니요 | 설명 가능성 enum     |
| `reviewRequired`     | `boolean`            | 예     | 복습 필요 여부       |
| `recordedAt`         | `UtcTimestamp`       | 예     | `createdAt` 이상     |
| `createdAt`          | `UtcTimestamp`       | 예     | UTC RFC 3339 밀리초  |
| `updatedAt`          | `UtcTimestamp`       | 예     | `createdAt` 이상     |

AI 관련 enum:

- 수준: `none`, `concept-only`, `partial-hint`, `solution-direction`,
  `partial-code`, `full-solution`, `ai-led-study`, `unrecorded`
- 기여율: `0`, `1-25`, `26-50`, `51-75`, `76-99`, `100`, `unknown`
- 이해도: `none`, `partial`, `full-flow`, `can-explain`, `can-apply`
- AI 없이 풀기: `now`, `with-hint`, `after-review`, `retry-required`, `not-yet`,
  `unchecked`
- 설명 가능성: `line-by-line`, `core-logic`, `concept-only`, `difficult`

AI 목적 enum의 전체 slug는 `src/common/types/index.ts`를 기준으로 한다. `none`과
`unrecorded`는 서로 다른 상태이며 자동 변환하지 않는다. 두 수준은 빈 `purposes`를
요구하고, `none`의 기여율이 있으면 `0`만 허용한다. 수준과 기여율의 의미상 불일치는 핵심
파서가 자동 판단하지 않는다.

## 중복 후보와 병합

| 우선순위 | 키                           | 강도   | 대상            |
| -------- | ---------------------------- | ------ | --------------- |
| 1        | platform + platformProblemId | strong | Problem         |
| 2        | platform + problemNumber     | strong | Problem         |
| 3        | platform + normalized URL    | strong | Problem         |
| 4        | platform + normalized title  | weak   | Problem         |
| 5        | normalized GitHub file path  | weak   | SolutionSession |
| 6        | codeHash                     | weak   | SolutionSession |

정규화 규칙:

- 플랫폼 ID/번호: trim, 대소문자 보존
- URL: HTTPS, host 소문자, fragment와 trailing slash 제거, query 정렬
- 제목: Unicode NFKC, trim, 연속 공백 축소, locale 비의존 소문자화
- GitHub 경로: `\`를 `/`로 변경, 선행 `/`와 `./` 제거, 반복 `/` 축소

strong 일치는 강한 중복 후보지만 `autoMerge`는 항상 `false`다. weak 일치는 사용자 확인
없이 병합하지 않는다. strong 키가 일부 일치하면서 다른 strong 필드가 충돌하면
`duplicate_conflict`다. 플랫폼이 다르면 문제 중복으로 판정하지 않는다.

## 런타임 검증

- 영구 저장과 외부 입력 경계에서 `unknown`을 엔터티 파서로 검증한다.
- 검증은 추가 패키지 없이 순수 TypeScript로 구현되어 있다.
- 결과는 `{ ok: true, value }` 또는 `{ ok: false, issues }`다.
- 오류는 `path`, `code`, `message`를 포함하며 한 입력에서 발견한 여러 오류를 함께 반환한다.
- 지원하지 않는 enum, 잘못된 형식과 관계, 누락 필드, unknown field를 거부한다.
- 파서는 입력을 변경하지 않으며 코드 문자열의 앞뒤 공백과 줄바꿈은 보존한다.
- 정상 aggregate는 JSON 직렬화/역직렬화 후 의미상 동일해야 한다.

TASK-0001 최종 재검증에서 위 계약에 대한 13개 테스트와 전체
`npm run validate`가 통과했다. 이 결과는 coverage, 실제 IndexedDB 지속성, 플랫폼 수집 또는
제안서의 중복 감지율 KPI 달성을 의미하지 않는다.
