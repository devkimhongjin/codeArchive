# TASK-0002 기획 → 구현 핸드오프

- 작업: TASK-0002 — 플랫폼 어댑터 계약과 fixture 전략
- GitHub Issue: [#2](https://github.com/devkimhongjin/codeArchive/issues/2)
- 상태: 기획 완료, 구현 착수 승인(`In Progress`)
- 우선순위: P0
- 마일스톤: M0 — 기반 정렬
- 목표 일정: 1개 M0 작업 단위, 달력 날짜와 완료일은 미확정
- 기획 담당: 기획 역할
- 구현 담당: 구현 역할
- 검증 담당: 검증 역할(구현자와 독립)
- 기록 담당: 기록 역할
- 관련 결정: DEC-0003(2026-07-26 해소), ADR-0001
- 후속 ADR: ADR-0002 — 플랫폼 어댑터와 비식별 fixture 계약(기록 단계 필수)

## 1. 문제와 사용자 가치

현재 `src/platforms/common/PlatformAdapter.ts`는 비어 있고 content script는 로드 로그만
남긴다. 플랫폼별 DOM 접근 경계, 실패 의미와 재현 가능한 입력이 없으므로 SWEA 수집 코드를
안전하게 시작하거나 DOM 변경 회귀를 검증할 수 없다.

사용자는 자동 수집이 가능한 페이지에서는 문제 메타데이터와 자신의 코드·언어·제출 결과를
일관되게 얻고, 일부 정보를 읽을 수 없거나 DOM이 바뀐 경우 데이터가 조용히 잘못 저장되지
않은 채 수동 등록으로 전환할 수 있어야 한다.

추적 근거:

- GitHub Issue #2의 목표, 범위, 수용 기준과 결정 필요 항목
- `project.md`: M0 기반 정렬, 플랫폼 DOM 격리, 보안·변경관리·완료 정의
- `docs/project/backlog.md`: TASK-0002
- `docs/project/roadmap.md`: M0 어댑터 계약, M2 SWEA 자동 기록, M4 플랫폼 확장
- proposal의 플랫폼 어댑터, SWEA 우선순위, 문제·코드·언어·제출 결과 수집, 수동 대체 경로
- `docs/architecture.md`, `docs/platform-adapter.md`, `docs/security-policy.md`
- ADR-0001의 `Problem`, `ProgrammingLanguage`, `SubmissionResult` 및 자동 수집 필수값 계약

## 2. 승인 범위

### 포함

- 플랫폼 공통 어댑터 계약과 등록/선택 경계
- URL 지원 여부, 문제 정보, 사용자 코드, 언어, 제출 결과 관찰의 분리된 계약
- 성공, 부분 성공 경고와 구조화된 실패 결과
- 실패 코드, 실패 단계, 복구 가능 여부와 수동 fallback 지시
- SWEA를 첫 대상으로 한 최소 어댑터 구현
- 정상, 부분 누락, DOM 변경, 비지원 URL의 최소 합성·비식별 fixture
- fixture 기반 계약 테스트와 오류/경계 테스트
- 공통 계층이 플랫폼 DOM을 직접 접근하지 않는 구조 검증

### 비범위

- 실제 SWEA 페이지의 모든 selector와 모든 편집기/제출 상태 지원
- 실제 사이트 HTML 캡처, 네트워크 크롤링, 계정 로그인 또는 사용자 세션 자동화
- 프로그래머스·정올·LeetCode 어댑터 구현
- IndexedDB 저장, 자동 병합, 수동 등록 UI 자체
- content script에서 영구 저장까지 연결하는 완전한 수집 흐름
- manifest 권한 또는 host permission 추가
- 외부 전송, 분석 이벤트, 원격 로그, GitHub/Notion/API 연동
- 문제 본문, 공식 해설, 전체 테스트 케이스 저장

비범위가 필요하면 구현에 몰래 포함하지 말고 기획으로 변경 요청을 반환한다.

## 3. 결정된 계약

### 3.1 어댑터 경계

- 모든 플랫폼 DOM 쿼리는 `src/platforms/**` 안에서만 수행한다.
- 공통 계층은 URL과 어댑터 결과만 다루며 selector, DOM 클래스명, 플랫폼 전역 객체를
  참조하지 않는다.
- 어댑터 선택은 등록된 어댑터의 URL 지원 판단으로 수행한다.
- 지원 어댑터가 없으면 throw나 빈 데이터가 아니라 `unsupported-url` 실패를 반환한다.
- 어댑터 메서드는 문제 정보, 코드/언어, 제출 관찰을 분리한다. 한 단계 실패가 이미 검증된
  다른 단계의 데이터를 거짓 성공 또는 빈 문자열로 바꾸지 않는다.

권장 최소 형태(정확한 이름은 구현자가 조정할 수 있으나 의미와 판별 가능성은 보존):

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
```

테스트 가능성을 위해 `AdapterContext`는 최소 `url`과 주입된 `Document`를 가진다. 전역
`window.document`에 직접 결합하지 않는다.

### 3.2 성공과 실패

성공 결과는 `ok: true`, 검증된 `value`, 선택적 `warnings`를 가진다. 실패 결과는
`ok: false`와 다음 정보를 구조화한다.

- `code`: 기계 판별 가능한 고정 코드
- `stage`: `detect | problem | solution | language | submission`
- `message`: 비민감한 사용자/개발자 설명
- `recoverable`: 같은 페이지에서 재시도나 대체 입력으로 계속할 수 있는지
- `fallback`: `retry | manual-entry | unsupported`
- 선택적 `missingFields`: 허용된 필드명만 포함하며 DOM 원문이나 selector 전체를 노출하지 않음

최소 실패 코드:

- `unsupported-url`
- `missing-required-element`
- `code-unavailable`
- `language-unresolved`
- `submission-observer-unavailable`
- `dom-contract-changed`
- `invalid-captured-data`

예외는 프로그래밍 오류에 한정하고, 예상 가능한 DOM/접근 실패는 결과 객체로 반환한다.
오류 메시지와 로그에는 코드 원문, 문제 원문, 사용자명, 세션 값, 토큰과 DOM 전체를 넣지
않는다.

### 3.3 필드와 부분 누락

- 자동 수집 Problem은 ADR-0001에 따라 `problemNumber`와 `title`을 모두 제공해야 한다.
- URL은 HTTPS 절대 URL이며 fragment를 제거한 저장 계약으로 변환할 수 있어야 한다.
- 난이도와 태그 같은 선택 필드 누락은 성공과 구조화된 warning으로 표현할 수 있다.
- 문제 번호 또는 제목 누락은 자동 수집 성공으로 처리하지 않고
  `missing-required-element` 또는 `dom-contract-changed`로 반환한다.
- 코드 접근 불가와 언어 미판별은 빈 문자열이나 임의 기본 언어를 만들지 않는다.
- 제출 결과를 알 수 없다고 `accepted`로 추정하지 않는다.

### 3.4 수동 fallback

다음 조건에서는 자동 저장을 진행하지 않고 수동 등록 진입 요청을 반환한다.

- 지원 URL이지만 문제 번호 또는 제목이 없음
- 코드 접근 불가 또는 언어 판별 실패
- selector 계약 불일치로 DOM 변경이 의심됨
- 제출 관찰기를 설치할 수 없음
- 캡처 값이 ADR-0001 파서를 통과하지 못함

비지원 URL은 해당 어댑터 자동 수집의 복구 불가(`recoverable: false`)지만 사용자는 별도
수동 등록을 선택할 수 있으므로 `fallback: "manual-entry"`를 허용한다. 이번 작업은 UI를
구현하지 않고 호출자가 판별할 신호만 제공한다.

## 4. Fixture 전략(DEC-0003)

저장소에는 실제 SWEA DOM 원본을 넣지 않는다. 필요한 구조만 손으로 작성한 최소 합성 HTML과
URL case JSON을 사용한다.

필수 fixture:

1. 정상: 합성 문제 번호·제목·난이도, 최소 사용자 코드, 언어, 제출 결과 표식
2. 부분 누락: 문제 정보는 유효하지만 코드 편집기/코드 값이 없어 `code-unavailable`
3. DOM 변경: 지원 URL이나 필수 문제 요소의 계약이 달라 `dom-contract-changed`
4. 비지원 URL: SWEA 도메인 밖 또는 지원하지 않는 SWEA 경로

fixture 규칙:

- 실제 사용자명, 이메일, 쿠키, 세션 ID, 제출 ID와 계정 식별자 금지
- 실제 문제 원문, 공식 해설, 전체 테스트 케이스와 비공개 데이터 금지
- 제목·번호·코드는 명백한 합성 값이며 테스트에 필요한 최소 길이만 사용
- `<script>`, 외부 리소스, 네트워크 요청과 실행 가능한 추적 코드는 제거
- 각 fixture 옆 메타데이터에 목적, 기대 결과, 합성 여부와 갱신 이유를 기록
- selector 계약이 의도적으로 바뀔 때만 갱신하고 실제 사이트와 닮게 만들기 위한 대량
  복사는 금지
- 실제 DOM이 필요한 회귀 조사는 별도 사용자 승인, 플랫폼 정책·저작권·개인정보 검토와
  비식별 절차가 승인되기 전까지 차단

## 5. 요구사항

| ID | 요구사항 | 우선순위 | 근거 | 검증 |
| --- | --- | --- | --- | --- |
| REQ-0002-01 | 공통 어댑터와 결과/오류 계약을 타입으로 제공한다. | Must | Issue #2, M0 | typecheck, unit |
| REQ-0002-02 | 플랫폼 DOM 접근을 `src/platforms/**`로 격리한다. | Must | AGENTS, architecture | 정적 검색, unit |
| REQ-0002-03 | SWEA 최소 어댑터가 주입된 DOM에서 문제·코드·언어·제출 결과 단계를 처리한다. | Must | SWEA 우선순위 | fixture contract |
| REQ-0002-04 | 예상 가능한 실패는 코드·단계·복구·fallback을 포함해 반환한다. | Must | Issue #2 | unit |
| REQ-0002-05 | 네 종류의 합성·비식별 fixture를 제공한다. | Must | DEC-0003 | fixture review |
| REQ-0002-06 | 실패 시 자동 저장을 중단하고 수동 fallback 판별 신호를 제공한다. | Must | M2 종료 조건 | unit, manual |
| REQ-0002-07 | 실제 DOM, 문제 원문과 개인정보를 fixture·로그에 보존하지 않는다. | Must | 보안 정책 | 수동 보안 검토 |

## 6. 인수 조건

### AC-0002-01 공통 계약과 DOM 격리

Given 두 개 이상의 가짜 어댑터 또는 SWEA 어댑터와 미지원 URL이 있을 때, when 공통
resolver가 URL을 판별하면, then 지원 어댑터 또는 구조화된 `unsupported-url` 결과를
반환하고 `src/content/**`, `src/common/**`에는 플랫폼 selector/DOM 쿼리가 없다.

자동 검증:

- 지원/비지원/잘못된 URL resolver 테스트
- `rg` 또는 동등한 정적 검사로 공통 계층의 SWEA selector와 `querySelector` 누출 확인

### AC-0002-02 정상 fixture

Given 정상 합성 SWEA fixture, when 문제와 풀이를 캡처하면, then 합성 문제 번호·제목,
HTTPS URL, 코드와 명시된 지원 언어가 반환되고 ADR-0001 경계 규칙을 위반하지 않는다.

자동 검증:

- fixture 기반 문제/풀이 계약 테스트
- 입력 DOM을 변경하지 않는지 확인

### AC-0002-03 선택 필드 부분 누락

Given 난이도나 태그 같은 선택 필드가 없는 fixture, when 문제를 캡처하면, then 필수
문제 번호와 제목은 성공하고 선택 필드는 누락 또는 warning으로 표현된다.

자동 검증:

- optional field 누락은 성공
- 빈 문자열을 수집 성공 값으로 반환하지 않음

### AC-0002-04 코드 접근 불가

Given 문제 정보는 정상이지만 코드 편집기 값이 없는 fixture, when 풀이를 캡처하면, then
`code-unavailable`, `stage: "solution"`, `recoverable: true`,
`fallback: "manual-entry"`가 반환되고 임의 코드/언어를 만들지 않는다.

### AC-0002-05 DOM 변경

Given 지원 URL이지만 필수 요소 계약이 변경된 fixture, when 문제를 캡처하면, then
`dom-contract-changed` 또는 명시된 필수 요소 오류와 `manual-entry` fallback을 반환하며
빈 Problem을 성공 처리하지 않는다.

### AC-0002-06 비지원 URL

Given 지원하지 않는 도메인/경로, when resolver를 호출하면, then
`unsupported-url`, `recoverable: false`와 수동 등록 가능 신호를 반환하고 DOM을 읽지 않는다.

### AC-0002-07 언어와 제출 결과

Given 지원 언어/결과 표식, when 캡처 또는 관찰 콜백을 실행하면, then ADR-0001의
`ProgrammingLanguage`와 `SubmissionResult`로 매핑된다. 알 수 없는 언어는 기본값을
추정하지 않고 `language-unresolved`, 알 수 없는 결과는 명시적 `unknown` 정책 또는
구조화된 warning으로 처리한다.

자동 검증:

- 지원 언어 최소 Java와 Python 매핑
- 알 수 없는 언어
- accepted, wrong-answer와 알 수 없는 결과
- observer 해제 함수가 중복 호출에도 안전함

### AC-0002-08 실패 독립성과 복구

Given 문제 캡처는 성공하고 코드 캡처는 실패하는 fixture, when 각 메서드를 호출하면, then
문제 결과는 유지되고 코드 실패가 빈 코드의 성공으로 합쳐지지 않는다. 실패 결과만으로
호출자가 자동 저장 중단과 수동 등록 전환을 판별할 수 있다.

### AC-0002-09 Fixture 보안·저작권

Given 커밋 대상 fixture와 테스트 로그, when 검증 역할이 점검하면, then 개인정보·토큰·쿠키·
실제 문제 원문·공식 해설·전체 테스트 케이스·실제 사용자 코드가 0건이고 fixture가 합성임을
메타데이터로 확인할 수 있다.

수동 검증:

- fixture 전수 육안 검토
- 비밀/개인 식별 문자열과 외부 URL 리소스 정적 검색

### AC-0002-10 전체 품질 게이트와 Chrome smoke

- `npm ci`
- `npm run validate`
- 테스트 파일과 실행 테스트 수가 1개 이상임을 검증 보고서에 기록
- unpacked extension이 로드되고 기존 popup/options/dashboard가 열리는 수동 smoke
- 이번 작업이 새 manifest 권한이나 host permission을 추가하지 않았음을 diff로 확인

## 7. 테스트 소유와 파일 소유권

구현 역할 단독 소유:

- `src/platforms/common/**`
- `src/platforms/swea/**`
- 어댑터 선택을 위한 `src/platforms/index.ts` 후보
- 필요할 경우 `src/content/**`의 최소 호출 경계(완전 저장 흐름은 금지)

검증 역할 단독 소유:

- `tests/unit/platforms/**`
- `tests/fixtures/platforms/swea/**`
- TASK-0002 검증 보고서

기록 역할 단독 소유:

- `docs/platform-adapter.md`
- `docs/architecture.md`의 어댑터 데이터 흐름
- `docs/security-policy.md`의 fixture·로그 원칙
- `docs/adr/ADR-0002-platform-adapter-fixtures.md`
- ADR index와 decision log

기획 역할 단독 소유:

- `project.md`
- `docs/project/backlog.md`
- 이 핸드오프와 종료 상태

공유 파일 단일 소유자:

- `src/platforms/common/PlatformAdapter.ts`와 공통 어댑터 타입: 구현 역할 한 명
- `src/common/types/index.ts`: 원칙적으로 수정하지 않는다. 반드시 필요하면 구현 역할 한
  명만 수정하고 ADR-0001 호환성을 검증한다.
- `package.json`, lockfile, Vite/TypeScript/ESLint/Prettier 설정, `public/manifest.json`:
  변경 승인 없음. 필요 시 작업을 중단하고 기획에 변경 요청한다.

검증 역할은 구현 파일을 수정하지 않고 결함을 handoff로 반환한다. 구현 역할은 fixture와
검증 보고서를 덮어쓰지 않는다.

## 8. 데이터·권한·보안 영향

- 데이터 스키마: 핵심 저장 스키마 변경 없음. 이번 출력은 저장 전 캡처 DTO다.
- 마이그레이션: 없음.
- Chrome 권한/host permission: 변경 없음. 실제 SWEA 페이지 주입 권한은 후속 M2 작업에서
  별도 인수 조건·보안 검토·승인 후 결정한다.
- 외부 전송: 없음. 테스트와 구현은 네트워크를 호출하지 않는다.
- 비밀정보/API Key: 저장·처리하지 않는다.
- 개인정보: fixture, 오류, 로그에 포함하지 않는다.
- 문제 원문/저작권: 제목·번호 외 본문은 캡처 DTO와 fixture 범위에서 제외한다.
- 자동 업로드/저장: 없음. 오류 시 자동 저장을 중단한다.

## 9. KPI 영향

SWEA 문제·코드 수집 성공률 90%, 제출 결과 감지 90%, 언어 감지 95%는 이번 계약과 fixture가
측정 기반을 만들지만 이번 작업에서 달성을 주장하지 않는다.

- 현재 측정: `Not measured`
- 이번 증거: fixture case별 pass/fail 및 실패 코드
- 실제 KPI 표본·계산식: 후속 SWEA 실제 구현/M2에서 정의
- 성공 기준: 이번 작업은 필수 fixture 4종의 계약 테스트 100% 통과
- fixture 4종 통과를 실제 사이트 성공률로 환산하지 않는다.

## 10. 일정, 의존성, 위험과 rollback

의존성:

- TASK-0001/ADR-0001의 플랫폼, 언어, 제출 결과와 Problem 자동 수집 규칙
- DEC-0003은 최소 합성·비식별 fixture 전략으로 해소
- TASK-0003 저장소, TASK-0004 수동 입력 UI와 독립적으로 구현 가능

일정:

- 기획 → 구현 → 독립 검증 → 기록 → 기획 종료의 한 작업 단위
- 달력 완료일과 처리량은 미확정이며 추정 진척률을 기록하지 않는다.

주요 위험:

- 합성 selector가 실제 SWEA DOM과 다름: 이번 작업은 계약 안정성만 검증하며 실제 selector
  검증은 M2의 승인된 수동 smoke와 별도 fixture 조사로 남긴다.
- 실패 코드가 과도하게 세분화됨: 인수 조건의 최소 코드만 공개 계약으로 고정한다.
- 부분 성공이 잘못 저장됨: 단계별 결과 분리와 필수 필드 실패로 차단한다.
- observer 정리 누락: idempotent cleanup 자동 테스트를 요구한다.
- 실제 DOM 복사로 개인정보/저작권 노출: 합성 fixture만 허용하고 검증 역할이 전수 검토한다.

rollback/비활성화:

- 어댑터 registry에서 SWEA 등록을 제거하면 공통 resolver가 `unsupported-url`로 되돌아간다.
- content 연결이 추가되더라도 feature flag 없이 대규모 연결하지 말고 최소 호출 경계를
  독립 변경으로 유지한다.
- fixture/계약 회귀 시 자동 수집을 비활성화하고 수동 입력 fallback 신호를 유지한다.
- 저장 스키마를 변경하지 않으므로 데이터 migration rollback은 없다.

## 11. 문서 영향과 기록 의무

검증 PASS 후 기록 역할은 실제 구현에 맞춰 다음을 갱신한다.

- `docs/platform-adapter.md`: 계약, 오류 코드, 부분 성공, fallback
- `docs/architecture.md`: content → resolver → adapter → DTO/실패 흐름
- `docs/security-policy.md`: 합성 fixture와 오류/로그 금지 데이터
- `docs/adr/ADR-0002-platform-adapter-fixtures.md`: DEC-0003의 배경, 대안, 결과
- `docs/adr/README.md`, `docs/project/decision-log.md`
- 필요할 경우 README의 개발/fixture 안내
- KPI는 실제 측정 없이 `Not measured` 유지

## 12. 구현 → 검증 핸드오프 필수 내용

- 변경 파일과 계약/동작 요약
- AC별 구현 위치
- fixture 4종과 각 기대 결과
- focused 테스트 명령, 테스트 수와 결과
- 선택한 실패 코드와 warning 정책
- 정적 DOM 경계 검사 결과
- 알려진 실제 SWEA 미검증 범위와 수동 확인 방법
- 데이터, 권한, 외부 통신과 로그 영향
- shared-file 변경 유무

## 13. 구현 중단 및 기획 반환 조건

- 새 dependency, Chrome 권한, host permission 또는 외부 통신이 필요함
- 실제 SWEA DOM/계정/네트워크 접근이 필요함
- 문제 원문, 실제 사용자 코드나 개인정보를 fixture에 넣어야 함
- ADR-0001의 핵심 저장 필드를 변경해야 함
- SWEA 실제 selector 완전 구현 또는 다른 플랫폼 지원이 필요함
- shared-file 소유 충돌이 발생함
- 수동 fallback 신호만으로 안전한 저장 중단을 보장할 수 없음

이 핸드오프 작성과 `In Progress` 변경은 TASK-0002 완료가 아니다. 구현, 독립 검증, 기록,
필요한 Chrome smoke와 기획 종료 증거가 모두 있어야 `Done`으로 변경한다.
