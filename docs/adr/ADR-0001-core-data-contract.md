# ADR-0001: 핵심 데이터 계약

- 상태: Accepted
- 결정일: 2026-07-25
- 작업: [TASK-0001 / GitHub Issue #1](https://github.com/devkimhongjin/codeArchive/issues/1)
- 범위: M0 핵심 데이터 규격

## 맥락

CodeArchive는 동일한 문제에 여러 풀이 세션, 제출, 언어와 AI 활용 기록을 보존해야 한다.
수동 등록은 제목 또는 문제 번호만 있어도 가능하고, 자동 수집과 JSON 가져오기는 서로 다른
시점과 장치에서 만들어진 데이터를 합칠 수 있다. 제안서는 플랫폼 식별자, 문제 번호, URL,
제목, GitHub 경로와 코드 해시를 중복 판단 근거로 제시하지만 이를 영구 ID로 사용하도록
정하지는 않았다.

M0에는 런타임 스키마 라이브러리가 설치되어 있지 않다. TASK-0001은 UI, IndexedDB 접근
계층, 실제 가져오기와 병합을 구현하지 않고 이후 작업이 사용할 타입과 경계 검증 계약을
정한다.

이 ADR은 사용자가 TASK-0001에서 ID, 시간, 검증 방식과 관계를 결정하도록 명시한 지시에
따라 Accepted로 기록한다. 저장소 구현이나 검증 완료를 뜻하지 않는다.

## 결정

### 1. 내부 ID와 스키마 버전

- 모든 엔터티 ID는 `<namespace>:<uuid-v4>` 형식의 namespaced UUID다.
- namespace는 `problem`, `solution-session`, `submission`, `ai-usage` 중 하나이며 UUID
  부분은 `crypto.randomUUID()`로 생성한다.
- 예: `problem:550e8400-e29b-41d4-a716-446655440000`
- ID는 타입 구분 외의 의미가 없는 불투명 값이며 플랫폼, 문제 번호나 시간을 인코딩하지
  않는다.
- 가져온 namespaced UUID가 이미 존재하면 같은 엔터티임이 입증되지 않는 한 UUID 부분을
  새로 발급하고 관계를 함께 다시 연결한다.
- 각 엔터티는 `schemaVersion: 1`을 가진다. 지원하지 않는 버전은 자동 추측하지 않고
  `unsupported_schema_version` 오류로 거부한다.
- 플랫폼과 문제 번호로 만든 자연키는 내부 ID가 아니다. 중복 후보 탐지에만 사용한다.

Namespaced UUID는 잘못된 엔터티 참조를 경계에서 빠르게 검출하고, 수동 등록·자동 수집과
백업 가져오기에서 중앙 ID 발급기 없이 충돌 가능성을 낮추며, 문제 메타데이터가 수정되어도
참조가 바뀌지 않게 한다.

### 2. 시간과 날짜

- 이벤트 시각은 `UtcTimestamp`로 표현한다.
- 형식은 UTC RFC 3339 밀리초 정밀도 `YYYY-MM-DDTHH:mm:ss.sssZ`다.
- 생성은 `new Date().toISOString()`을 사용한다.
- 오프셋 표기, 로컬 시각, 초 또는 밀리초가 생략된 값은 엔터티 경계에서 거부한다.
- 사용자 달력 날짜인 `reviewDate`는 시간대 변환 대상이 아닌 `CalendarDate`
  (`YYYY-MM-DD`)로 별도 표현한다.
- `createdAt`, `updatedAt`, `solvedAt`, `submittedAt`, `recordedAt`은 `UtcTimestamp`다.
- `updatedAt >= createdAt`, `recordedAt >= createdAt`이어야 한다. 제출 시각과 풀이 완료
  시각의 순서는 플랫폼 지연이나 수동 입력 때문에 강제하지 않는다.

```ts
type UtcTimestamp = string
type CalendarDate = string
```

브랜드 타입 도입 여부와 관계없이 런타임 파서가 위 형식을 검증해야 한다.

### 3. 런타임 스키마 검증

새 패키지를 추가하지 않고 순수 TypeScript 파서를 작성한다.

```ts
interface ValidationIssue {
  path: string
  code:
    | 'invalid_type'
    | 'missing_required'
    | 'unknown_field'
    | 'invalid_enum'
    | 'invalid_format'
    | 'invalid_relation'
    | 'unsupported_schema_version'
  message: string
}

type ParseResult<T> =
  { ok: true; value: T } | { ok: false; issues: ValidationIssue[] }
```

- 외부 입력과 영구 저장 경계에서는 `unknown`을 받아 파싱한 뒤에만 도메인 타입으로 다룬다.
- `as`, `any` 또는 단순 truthy 검사로 검증을 우회하지 않는다.
- 알 수 없는 필드는 거부한다. 최신 버전 백업을 구버전 앱이 일부만 읽어 데이터가 유실되는
  것을 방지한다.
- 문자열은 앞뒤 공백을 제거한 뒤 필수 필드의 빈 문자열을 거부한다. 코드 내용은 원문을
  보존하며 trim하지 않는다.
- enum은 아래 계약의 정확한 소문자 값을 사용한다.
- 파서는 입력 객체를 변경하지 않고 모든 발견 오류를 경로와 함께 반환한다.
- JSON 백업은 엔터티 파싱 전에 버전별 명시적 마이그레이션을 거친다. v1에는 마이그레이션이
  없고, 향후 마이그레이션은 별도 ADR과 테스트가 필요하다.

런타임 라이브러리 도입은 검증 중복과 유지비를 측정한 뒤 별도 변경 요청으로 다룬다.

### 4. 공통 enum

```ts
type Platform = 'swea' | 'programmers' | 'jungol' | 'leetcode'

type ProgrammingLanguage =
  | 'java'
  | 'python'
  | 'c'
  | 'cpp'
  | 'javascript'
  | 'typescript'
  | 'kotlin'
  | 'csharp'
  | 'go'
  | 'swift'
  | 'rust'

type RecordSource =
  | 'auto-captured'
  | 'manual'
  | 'source-file'
  | 'markdown-import'
  | 'json-import'
  | 'github-import'
  | 'notion-import'
  | 'platform-history'

type SubmissionResult =
  | 'accepted'
  | 'wrong-answer'
  | 'compile-error'
  | 'runtime-error'
  | 'time-limit-exceeded'
  | 'memory-limit-exceeded'
  | 'presentation-error'
  | 'other'
  | 'unknown'
```

`github-import`, `notion-import`, `platform-history`는 MVP 입력 경로가 아니지만 제안서의 출처
계약을 보존하기 위해 enum에 포함한다. 이 값이 해당 기능 구현을 승인하지는 않는다.

### 5. 엔터티 계약과 관계

관계는 다음과 같다.

```text
Problem 1 ── * SolutionSession 1 ── * Submission
                         │
                         └── 1 AIUsageRecord
```

#### Problem

```ts
interface Problem {
  schemaVersion: 1
  id: string
  platform: Platform
  platformProblemId?: string
  problemNumber?: string
  title?: string
  url?: string
  difficulty?: string
  tags: string[]
  source: RecordSource
  createdAt: UtcTimestamp
  updatedAt: UtcTimestamp
}
```

규칙:

- `platform`은 필수다.
- `platformProblemId`, `problemNumber`, `title` 중 하나 이상은 비어 있지 않아야 한다.
- 자동 수집은 `problemNumber`와 `title`을 모두 제공해야 한다.
- `url`이 있으면 절대 `https:` URL이어야 하며 fragment는 저장 전에 제거한다.
- `tags`는 trim 후 빈 값 제거, 대소문자를 보존한 값 기준 중복 제거, 최초 순서를 보존한다.
- 문제 원문, 공식 해설과 전체 테스트 케이스는 저장하지 않는다.

#### SolutionSession

```ts
interface SolutionSession {
  schemaVersion: 1
  id: string
  problemId: string
  language: ProgrammingLanguage
  result: SubmissionResult
  code?: string
  solvedAt?: UtcTimestamp
  summary?: string
  approach?: string
  timeComplexity?: string
  spaceComplexity?: string
  mistakes: string[]
  reviewRequired: boolean
  reviewDate?: CalendarDate
  source: RecordSource
  githubFilePath?: string
  codeHash?: string
  createdAt: UtcTimestamp
  updatedAt: UtcTimestamp
}
```

규칙:

- `problemId`는 존재하는 Problem을 참조한다.
- 코드 없는 문제 등록을 허용하므로 `code`는 선택이다. 값이 있으면 빈 문자열일 수 없다.
- `reviewDate`가 있으면 `reviewRequired`는 `true`여야 한다.
- `codeHash`가 있으면 UTF-8 코드 원문의 SHA-256 소문자 64자리 hex다.
- AI 리뷰 결과는 이 엔터티에 넣지 않는다. 풀이 중 AI 활용과 사후 AI 리뷰를 분리한다.

#### Submission

```ts
interface Submission {
  schemaVersion: 1
  id: string
  solutionSessionId: string
  platformSubmissionId?: string
  result: SubmissionResult
  language: ProgrammingLanguage
  code?: string
  executionTimeMs?: number
  memoryKiB?: number
  submittedAt: UtcTimestamp
  source: RecordSource
  createdAt: UtcTimestamp
}
```

규칙:

- `solutionSessionId`는 존재하는 SolutionSession을 참조한다.
- 실행 시간과 메모리는 파싱된 0 이상의 정수 단위로 저장한다. `"120ms"`, `"25MB"` 같은
  표시 문자열은 경계에서 숫자로 변환하고 원본 단위 문자열은 핵심 엔터티에 저장하지 않는다.
- 코드 접근이 제한될 수 있어 `code`는 선택이다. 값이 있으면 빈 문자열일 수 없다.
- 제출 언어는 세션 언어와 같아야 한다. 다르면 별도 SolutionSession을 만든다.

#### AIUsageRecord

```ts
type AIUsageLevel =
  | 'none'
  | 'concept-only'
  | 'partial-hint'
  | 'solution-direction'
  | 'partial-code'
  | 'full-solution'
  | 'ai-led-study'
  | 'unrecorded'

type AIContributionRate =
  '0' | '1-25' | '26-50' | '51-75' | '76-99' | '100' | 'unknown'

type UnderstandingLevel =
  'none' | 'partial' | 'full-flow' | 'can-explain' | 'can-apply'

type SolvableWithoutAI =
  | 'now'
  | 'with-hint'
  | 'after-review'
  | 'retry-required'
  | 'not-yet'
  | 'unchecked'

type ExplanationAbility =
  'line-by-line' | 'core-logic' | 'concept-only' | 'difficult'

interface AIUsageRecord {
  schemaVersion: 1
  id: string
  solutionSessionId: string
  level: AIUsageLevel
  purposes: AIUsagePurpose[]
  provider?: string
  model?: string
  promptSummary?: string
  referencedContent?: string
  contributionRate?: AIContributionRate
  copiedDirectly?: boolean
  modifiedAfterUse?: boolean
  understandingLevel?: UnderstandingLevel
  solvableWithoutAI?: SolvableWithoutAI
  explanationAbility?: ExplanationAbility
  reviewRequired: boolean
  recordedAt: UtcTimestamp
  createdAt: UtcTimestamp
  updatedAt: UtcTimestamp
}
```

`AIUsagePurpose`는 제안서 8.4의 항목을 다음 slug로 제한한다.

```ts
type AIUsagePurpose =
  | 'syntax'
  | 'library-usage'
  | 'algorithm-concept'
  | 'algorithm-recommendation'
  | 'approach-check'
  | 'counterexample'
  | 'error-analysis'
  | 'compile-error'
  | 'runtime-error'
  | 'time-optimization'
  | 'memory-optimization'
  | 'readability'
  | 'refactoring'
  | 'time-complexity'
  | 'space-complexity'
  | 'test-generation'
  | 'full-solution-generation'
  | 'solution-explanation'
  | 'review-explanation'
```

규칙:

- 모든 SolutionSession에는 정확히 하나의 AIUsageRecord가 있다.
- 사용자가 선택하지 않으면 `level: "unrecorded"`인 레코드를 생성한다.
- `"none"`과 `"unrecorded"`는 절대로 상호 변환하지 않는다.
- `level`이 `"none"` 또는 `"unrecorded"`이면 `purposes`는 빈 배열이다.
- `level: "none"`일 때 `contributionRate`가 있으면 `"0"`이어야 한다.
- 목적, 기여율과 수준의 의미가 어긋나는 경우 저장을 막지 않는다. 제안서에 따라 UI 경고만
  제공하며 핵심 파서는 enum과 구조만 검증한다.
- 한 세션의 AIUsageRecord를 복습 결과로 덮어쓰지 않는다. 복습은 새 SolutionSession과
  새 AIUsageRecord로 저장한다.

### 6. 중복 후보 키

내부 UUID에는 unique 제약을 둔다. 다음 키는 정규화한 뒤 후보 탐지에 사용한다.

우선순위와 강도:

1. `platform + platformProblemId`: strong
2. `platform + problemNumber`: strong
3. `platform + normalizedUrl`: strong
4. `platform + normalizedTitle`: weak
5. `normalized githubFilePath`: weak, SolutionSession 후보
6. `codeHash`: weak, SolutionSession 후보

정규화:

- 플랫폼 ID/번호: trim만 하고 대소문자를 보존한다.
- URL: HTTPS 절대 URL, host 소문자, 기본 포트와 fragment 제거, trailing slash 제거,
  query parameter는 정렬한다.
- 제목: Unicode NFKC, trim, 연속 공백을 한 칸으로, locale 비의존 소문자화한다.
- GitHub 경로: `\`를 `/`로 바꾸고 선행 `/`와 `./`를 제거한다. 대소문자는 보존한다.

규칙:

- strong 키가 같으면 동일 Problem 후보로 표시하지만 자동 병합하지 않는다.
- weak 키만 같으면 사용자 확인 없이는 병합하지 않는다.
- 서로 다른 strong 키가 충돌하면 저장을 중단하고 `duplicate_conflict`를 반환한다.
- 동일 Problem이라도 풀이 날짜, 언어 또는 AI 활용이 다르면 별도 SolutionSession이다.
- 동일 세션 여부를 자동 추론하지 않는다. GitHub 경로와 코드 해시는 병합 제안 근거일 뿐이다.

중복 감지율 KPI는 구현 후 별도 fixture 표본으로 측정하며 이 ADR로 달성을 주장하지 않는다.

## 비목표

- IndexedDB 라이브러리, object store와 index의 구체 배치
- 실제 DB 마이그레이션과 롤백 구현
- UI 폼과 오류 메시지 문구
- SWEA 또는 프로그래머스 DOM 수집
- 자동 병합 정책
- Markdown 템플릿과 완전한 백업 envelope
- 서버 동기화, GitHub/Notion 가져오기
- AI 코드 리뷰 결과 모델
- API Key, OAuth 토큰 또는 외부 전송 데이터 모델

## 고려한 대안

### 자연키를 Problem ID로 사용

`swea-1206`처럼 읽기 쉽지만 번호가 없는 수동 등록, 플랫폼 ID 정정, 가져오기 충돌과 URL
기반 문제를 안정적으로 다루기 어렵다. 중복 키와 참조 ID를 분리하기로 했다.

### namespace 없는 UUID

충돌 회피에는 충분하지만 Problem ID를 Session 참조 자리에 넣는 오류를 값만 보고 구분할 수
없다. 저장과 가져오기 경계에서 관계 오류를 조기에 찾기 위해 고정 namespace를 붙인다.

### 시간 기반 ID

정렬은 쉽지만 생성 시각 노출과 충돌 처리 규칙이 추가된다. 정렬은 `createdAt`으로 해결한다.

### 스키마 검증 라이브러리 즉시 추가

중복 코드를 줄일 수 있으나 현재 의존성에 없고 M0에서 패키지 선택 근거가 없다. 우선 작은
순수 함수 계약으로 구현하고 필요성이 입증되면 ADR로 교체한다.

### AI 활용을 SolutionSession에 내장

조회는 단순하지만 독립 저장, 관계 제약과 향후 통계 마이그레이션이 불명확해진다. 세션당
정확히 하나인 별도 엔터티로 정했다.

## 결과

장점:

- 내부 참조가 플랫폼 메타데이터 변경과 중복 탐지 규칙에서 독립된다.
- AI 미사용과 미기록을 구조적으로 구분한다.
- 숫자 단위와 UTC 형식이 저장 경계에서 일관된다.
- 새 의존성 없이 TASK-0001 구현을 시작할 수 있다.

비용과 위험:

- 수동 파서와 정규화 함수의 테스트 및 유지 비용이 발생한다.
- 외래키와 세션당 AI 레코드 하나 제약은 IndexedDB가 자동 보장하지 않으므로 repository
  계층에서 트랜잭션으로 보장해야 한다.
- UUID 충돌은 극히 드물지만 가져오기 충돌 매핑이 필요하다.
- 엄격한 unknown-field 거부는 최신 백업을 구버전에서 읽지 못하게 한다. 명시적 실패로
  데이터 유실을 막고 향후 마이그레이션으로 해결한다.

## 구현 및 검증 의무

- 공통 타입, enum, 파서, 정규화 함수를 구현한다.
- 엔터티별 정상, 누락, enum, 시간, 관계와 unknown-field 테스트를 작성한다.
- 동일 문제/다른 언어/여러 제출/복습 세션 fixture를 작성한다.
- 실제 IndexedDB 제약과 마이그레이션은 TASK-0003에서 이 계약에 맞춰 설계한다.
- 기록 역할은 구현 후 `docs/data-model.md`를 실제 타입과 일치시킨다.
