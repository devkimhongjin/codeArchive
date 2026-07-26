# 플랫폼 어댑터 규격

## 목적과 지원 범위

플랫폼 어댑터는 플랫폼별 DOM 접근을 `src/platforms/**` 안에 격리하고, 공통 계층에는
검증된 캡처 DTO 또는 구조화된 실패만 반환한다. TASK-0002에서 구현한 SWEA 어댑터는 실제
SWEA DOM 전체를 지원하는 구현이 아니라 합성 fixture로 검증한 최소 계약이다.

지원 우선순위는 SWEA, 프로그래머스, 정올, LeetCode 순이다. 현재 registry에는 SWEA만
등록되어 있으며 다음 HTTPS 경로만 지원 대상으로 판별한다.

- `/main/code/problem/problemDetail.do`
- `/main/talk/solvingClub/problemView.do`

실제 SWEA selector 호환성과 로그인·편집기·제출 UI는 M2에서 별도 승인과 보안 검토 후
검증한다.

## 공통 계약

`PlatformAdapter`는 주입된 URL과 `Document`를 받으며 전역 `window.document`를 읽지 않는다.
각 단계는 독립적으로 실행되어 한 단계의 실패가 다른 단계에서 검증된 값을 빈 값이나 거짓
성공으로 바꾸지 않는다.

```ts
interface PlatformAdapter {
  readonly platform: Platform
  supports(url: URL): boolean
  captureProblem(context: AdapterContext): AdapterResult<CapturedProblem>
  captureSolution(context: AdapterContext): AdapterResult<CapturedSolution>
  observeSubmission(
    context: AdapterContext,
    onResult: (result: CapturedSubmission) => void,
  ): AdapterResult<SubmissionObserver>
}

interface AdapterContext {
  url: URL
  document: Document
}
```

- `captureProblem`: 문제 번호, 제목, HTTPS URL과 선택 메타데이터를 캡처한다.
- `captureSolution`: 코드와 명시적으로 매핑 가능한 언어를 캡처한다.
- `observeSubmission`: 제출 결과 요소를 관찰하고 캡처 결과를 콜백으로 전달한다.
- `SubmissionObserver.disconnect()`는 여러 번 호출해도 안전하다.

## 성공, 경고와 실패

성공은 `ok: true`와 검증된 `value`를 반환한다. 선택 필드가 없거나 제출 결과 표식을 알 수
없는 경우 성공 값과 함께 warning을 반환할 수 있다.

| Warning                     | 의미                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `optional-field-missing`    | 난이도나 태그 같은 선택 문제 메타데이터가 없음             |
| `unknown-submission-result` | 제출 결과를 알려진 값으로 매핑하지 못해 `unknown`으로 반환 |

예상 가능한 DOM·URL·접근 실패는 예외를 던지지 않고 `ok: false`와 구조화된 오류를
반환한다.

```ts
interface AdapterFailure {
  code: AdapterFailureCode
  stage: 'detect' | 'problem' | 'solution' | 'language' | 'submission'
  message: string
  recoverable: boolean
  fallback: 'retry' | 'manual-entry' | 'unsupported'
  missingFields?: AdapterMissingField[]
}
```

| 실패 코드                         | 대표 단계               | 처리                                              |
| --------------------------------- | ----------------------- | ------------------------------------------------- |
| `unsupported-url`                 | `detect`                | 자동 수집을 시작하지 않고 수동 등록으로 전환      |
| `missing-required-element`        | `problem`, `submission` | 필수 필드가 없으므로 자동 저장 중단               |
| `code-unavailable`                | `solution`              | 빈 코드를 만들지 않고 수동 등록으로 전환          |
| `language-unresolved`             | `language`              | 임의 기본 언어를 추정하지 않고 수동 등록으로 전환 |
| `submission-observer-unavailable` | `submission`            | 자동 관찰을 중단하고 수동 등록으로 전환           |
| `dom-contract-changed`            | 단계별                  | DOM 계약 변경으로 간주하고 수동 등록으로 전환     |
| `invalid-captured-data`           | 단계별                  | 핵심 데이터 계약에 맞지 않아 자동 저장 중단       |

오류와 warning에는 허용된 필드명만 넣는다. selector, DOM 원문, 문제 본문, 코드 원문,
사용자명, 세션 값과 토큰을 포함하지 않는다.

## Resolver 흐름

`platformAdapters` registry는 현재 `sweaAdapter` 하나를 가진다.
`resolveRegisteredPlatformAdapter(url)`은 URL만으로 등록된 어댑터를 선택한다. 지원하는
어댑터가 없거나 URL 문자열이 유효한 절대 URL이 아니면 DOM에 접근하지 않고
`unsupported-url`, `recoverable: false`, `fallback: "manual-entry"`를 반환한다.

호출자는 다음 순서로 처리한다.

1. 현재 URL을 resolver에 전달한다.
2. 선택된 어댑터에 주입된 `Document`와 URL을 전달한다.
3. 문제, 풀이, 제출 단계를 각각 실행한다.
4. 각 성공 DTO를 ADR-0001 저장 경계에서 다시 검증한다.
5. 실패 또는 저장을 막아야 하는 warning이면 자동 저장하지 않고 수동 등록으로 전환한다.
6. 제출 관찰이 끝나면 observer를 해제한다.

이번 작업은 content script와 영구 저장을 연결하지 않는다.

## SWEA 합성 DOM 계약

현재 SWEA 어댑터는 테스트 가능한 최소 계약으로 다음 `data-codearchive-*` 속성만 읽는다.

- root: `data-codearchive-swea`
- 문제 필수값: `data-codearchive-problem-number`, `data-codearchive-problem-title`
- 문제 선택값: `data-codearchive-problem-difficulty`, `data-codearchive-problem-tags`
- 풀이: `data-codearchive-solution-code`, `data-codearchive-solution-language`
- 제출: `data-codearchive-submission-result`, `data-codearchive-submission-language`

문제 URL은 HTTPS 절대 URL이어야 하고 fragment를 제거한다. 문제 번호와 제목은 자동
캡처의 필수값이다. 선택 필드 누락은 warning으로 유지한다. 언어는 명시적 매핑표에 있는
값만 허용하며 제출 결과를 알 수 없으면 `accepted`로 추정하지 않는다.

## Fixture 정책

`tests/fixtures/platforms/swea/**`에는 실제 사이트 복사본이 아닌 최소 합성 HTML만 둔다.

- `normal.html`: 문제·Java 풀이·accepted 제출 캡처
- `optional-missing.html`: 선택 문제 필드 누락 warning과 Python 풀이
- `code-missing.html`: 문제 성공과 독립적인 `code-unavailable` 실패
- `dom-changed.html`: `dom-contract-changed` 실패
- `cases.json`: 합성 여부, 목적, 기대 결과와 갱신 정책

fixture에는 실제 문제 본문, 공식 해설, 전체 테스트 케이스, 사용자 코드, 사용자명,
이메일, 쿠키, 세션 ID, 제출 ID와 비밀 값을 넣지 않는다. `<script>`, 외부 리소스와
네트워크 요청도 금지한다. 계약이 의도적으로 바뀔 때만 최소 범위로 갱신한다.

## 검증 상태와 잔여 위험

- 합성 fixture 계약: 4종, focused test 11개 PASS
- 전체 회귀: 2 files, 24 tests PASS
- lint, format, typecheck, production build: PASS
- manifest, dependency, 저장 스키마와 외부 통신 변경: 없음
- Chrome unpacked extension smoke: `Not Run`
- 실제 SWEA 표본 기반 수집·언어·제출 감지 KPI: `Not measured`

합성 fixture 통과는 실제 사이트 성공률을 의미하지 않는다. 통합 전에는 새 build의
popup/options/dashboard를 Chrome에서 수동 확인해야 하며, 실제 SWEA 호환성은 M2의 별도
검증 대상으로 남는다.
