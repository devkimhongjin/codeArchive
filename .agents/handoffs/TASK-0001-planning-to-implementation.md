# TASK-0001 기획 → 구현 핸드오프

- 작업: TASK-0001 — 핵심 데이터 규격과 식별자 정의
- GitHub Issue: [#1](https://github.com/devkimhongjin/codeArchive/issues/1)
- 현재 단계: 기획 완료, 구현 착수 가능
- 마일스톤: M0 — 기반 정렬
- 일정: 미확정
- 결정 근거: `docs/adr/ADR-0001-core-data-contract.md`

## 사용자 가치와 추적 근거

사용자는 같은 문제의 여러 제출, 언어, 복습과 AI 활용 변화를 잃지 않고 저장하고 가져올 수
있어야 한다. 이 계약은 자동 수집, 기존 풀이 등록, 중복 확인과 AI 활용 통계의 선행 조건이다.

- proposal 8.2~8.10: AI 수준, 목적, 미사용/미기록 구분, 세션별 변화 보존
- proposal 10.1~10.7: 최소 수동 입력, 코드 없는 등록, 중복 판단과 병합
- proposal 13~14: 로컬 우선 저장과 핵심 데이터 예시
- proposal 25~26: MVP 데이터 필드와 개발 1단계
- proposal 28: AI 기록 독립성, 중복 감지와 가져오기 성공 기준
- `project.md`: M0, 변경관리, 완료 정의
- `docs/project/backlog.md`: TASK-0001 범위와 수용 기준

## 구현 범위

ADR-0001의 계약을 코드로 옮긴다.

- 공통 primitive: UUID, UTC timestamp, calendar date
- Platform, ProgrammingLanguage, RecordSource, SubmissionResult enum
- Problem, SolutionSession, Submission, AIUsageRecord 타입
- AI 활용 수준, 목적, 기여율, 이해도, 재풀이와 설명 가능성 enum
- 엔터티별 `unknown` 입력 파서와 `ParseResult<T>`
- UUID, UTC, 날짜, URL, SHA-256 hex 형식 검사
- 문제 제목, URL, GitHub 경로 정규화
- 중복 후보 키 생성과 strong/weak 충돌 판정
- 정상 및 실패 fixture와 단위 테스트

## 비범위

- IndexedDB repository와 migration 구현
- UI, 수동 등록 화면, 가져오기 화면
- 플랫폼 DOM 어댑터
- 실제 병합 또는 자동 덮어쓰기
- Markdown 템플릿과 백업 envelope
- AI 코드 리뷰 결과
- 서버, GitHub, Notion 연동
- 새 Chrome 권한 또는 외부 통신
- 새 런타임 스키마 패키지

비범위가 필요해지면 현재 작업에 포함하지 말고 기획에 변경 요청을 반환한다.

## 결정된 계약

### ID

- 모든 엔터티 `id`는 `<namespace>:<uuid-v4>` 형식의 namespaced UUID다.
- namespace는 `problem`, `solution-session`, `submission`, `ai-usage`다.
- UUID 부분은 `crypto.randomUUID()`로 생성한다.
- Problem 자연키는 중복 후보 탐지용이며 참조 ID로 사용하지 않는다.
- 각 엔터티는 `schemaVersion: 1`이다.

### 시간

- 이벤트 시각은 `new Date().toISOString()` 형식의 UTC RFC 3339 밀리초 문자열이다.
- 정확한 예: `2026-07-25T12:34:56.789Z`
- `reviewDate`만 `YYYY-MM-DD` 달력 날짜다.

### 검증

- 외부/저장 경계에서 `unknown`을 순수 TypeScript 파서로 검증한다.
- 결과는 `{ ok: true, value }` 또는 `{ ok: false, issues[] }`다.
- unknown field, 잘못된 enum/형식/관계와 지원하지 않는 버전을 거부한다.
- 오류는 최소 `path`, `code`, `message`를 포함한다.
- 새 검증 라이브러리를 추가하지 않는다.

### 관계

- Problem 1:N SolutionSession
- SolutionSession 1:N Submission
- SolutionSession 1:1 AIUsageRecord
- 새 세션에는 AI 레코드를 만들며 선택이 없으면 `"unrecorded"`를 저장한다.
- 복습은 기존 세션을 덮어쓰지 않고 새 세션으로 저장한다.

### 중복

- strong: 플랫폼+플랫폼 ID, 플랫폼+문제 번호, 플랫폼+정규 URL
- weak: 플랫폼+정규 제목, GitHub 경로, 코드 SHA-256
- 후보는 자동 병합하지 않는다.
- 서로 다른 strong 키가 상충하면 `duplicate_conflict`다.

정확한 필드, enum, 정규화와 조건부 규칙은 ADR-0001을 그대로 따른다.

## 예상 파일 소유권

구현 역할 단독 소유 후보:

- `src/common/types/**`
- `src/common/validators/**`
- `src/common/utils/**` 중 ID, 시간, 정규화 유틸리티

검증 역할 단독 소유 후보:

- `tests/unit/common/**`
- `tests/fixtures/**` 중 TASK-0001 fixture

공유 파일 변경이 필요하면 작업을 멈추고 단일 소유자를 기획에 확인한다. 이 핸드오프는
`package.json`, lockfile, 빌드 설정 변경을 승인하지 않는다.

## 인수 조건

### AC-01: 타입 완전성

ADR-0001의 네 엔터티, 공통 enum과 모든 필드가 TypeScript 타입으로 표현되고 타입 검사에
성공한다.

증거:

- 엔터티별 정상 fixture의 컴파일
- `npm run typecheck`

### AC-02: ID와 버전

생성 함수는 엔터티에 맞는 namespace와 유효한 UUID v4, `schemaVersion: 1`을 반환한다.
파서는 namespace/UUID가 잘못되거나 버전이 1이 아닌 입력을 경로가 있는 오류로 거부한다.

자동 테스트:

- 엔터티별 생성 ID 100개가 namespaced UUID 형식에 맞고 표본 안에서 중복되지 않음
- 잘못된 namespace, UUID와 UUID 버전 거부
- 다른 엔터티 namespace를 가진 참조 ID 거부
- 누락/0/2/문자열 schemaVersion 거부

100개 표본은 UUID 전역 무충돌 KPI가 아니라 함수 동작 회귀 시험이다.

### AC-03: UTC와 날짜

UTC 이벤트 시각은 정확한 밀리초와 `Z`를 요구하고 `reviewDate`는 유효한 달력 날짜만 받는다.

자동 테스트:

- `2026-07-25T12:34:56.789Z` 허용
- 오프셋, 로컬 시각, 밀리초 누락, 잘못된 날짜 거부
- 윤년 `2028-02-29` 허용, `2027-02-29` 거부
- `updatedAt < createdAt`, `recordedAt < createdAt` 거부

### AC-04: Problem 조건부 필수값

platform은 필수이고 `platformProblemId`, `problemNumber`, `title` 중 하나 이상이 필요하다.
자동 수집 source는 problemNumber와 title을 모두 요구한다.

자동 테스트:

- 제목만 있는 manual Problem 허용
- 번호만 있는 manual Problem 허용
- 세 필드가 모두 없는 Problem 거부
- 번호 또는 제목이 없는 auto-captured Problem 거부
- HTTP/상대/fragment 포함 URL 처리 규칙 검증
- 빈/중복 tag 정규화 검증

### AC-05: 관계와 단위

관계 검사 함수는 존재하지 않는 parent, 언어 불일치와 세션당 AI 레코드 수 불일치를
거부한다. 제출 실행 시간은 ms, 메모리는 KiB의 0 이상 정수만 저장한다.

자동 테스트:

- 한 Problem 아래 같은 언어 여러 Submission 허용
- 같은 Problem 아래 다른 언어 SolutionSession 허용
- orphan session/submission/AI record 거부
- Submission과 Session 언어 불일치 거부
- 음수, 소수, 문자열 실행 시간/메모리 거부
- AI record 0개/2개인 완성 aggregate 거부

### AC-06: AI 미사용과 미기록

`"none"`과 `"unrecorded"`를 별도 값으로 직렬화/역직렬화하며 둘 다 purposes가 비어 있다.
복습 fixture는 이전 AI 레코드를 수정하지 않고 새 SolutionSession/AIUsageRecord를 가진다.

자동 테스트:

- none/unrecorded round trip 후 값 보존
- none/unrecorded + purpose 거부
- none + 0 이외 contribution 거부
- 최초 풀이와 두 복습 세션의 독립 AI 수준 보존

### AC-07: 중복 후보

정규화 규칙과 우선순위에 따라 strong/weak 후보를 반환하며 자동 병합하지 않는다.

자동 테스트:

- 동일 플랫폼+번호는 strong
- 같은 번호라도 플랫폼이 다르면 일치하지 않음
- URL host 대소문자, fragment, query 순서 정규화
- 제목 Unicode NFKC, 공백과 case 정규화
- 제목만 같으면 weak
- codeHash만 같으면 SolutionSession weak
- 서로 상충하는 strong 키는 duplicate_conflict
- 같은 문제의 다른 언어/날짜/AI 수준은 별도 session

### AC-08: 경계 파서

파서는 입력을 변경하지 않고 한 번에 발견한 모든 오류를 `path`, `code`, `message`와 함께
반환한다. unknown field와 빈 필수 문자열을 거부하고 code 원문 공백은 보존한다.

자동 테스트:

- 중첩 경로 오류 예: `aiUsage.purposes[1]`
- 한 입력의 복수 오류 반환
- Object.freeze 입력 파싱
- unknown field 거부
- code 앞뒤 공백과 줄바꿈 round trip 보존

### AC-09: 직렬화 왕복

정상 aggregate를 JSON으로 직렬화하고 다시 파싱했을 때 의미상 동일해야 한다.

필수 fixture:

1. SWEA 1206, Java, 여러 제출, AI 부분 힌트
2. 같은 문제 Python 복습, AI 미사용
3. 프로그래머스 코드 없는 수동 등록, AI 미기록
4. 잘못된 enum, 날짜, 관계, unknown field를 포함한 실패 입력

### AC-10: 품질 게이트와 문서 핸드오프

- focused 테스트와 `npm run validate`가 통과한다.
- 테스트 수와 명령 결과를 구현→검증 핸드오프에 기록한다.
- `--passWithNoTests`만 통과한 결과는 인정하지 않는다.
- 실제 구현 필드가 ADR과 다르면 임의 수정하지 않고 변경 요청을 남긴다.
- 기록 역할에 `docs/data-model.md` 갱신 요청을 전달한다.

## 수동 검증

이 작업은 UI와 Chrome 권한을 변경하지 않으므로 unpacked extension의 새 사용자 동작은 없다.
다만 최종 전체 검증에서 기존 extension build가 유지되는지는 확인한다.

## 보안, 권한과 외부 전송

- 새 Chrome 권한: 없음
- 외부 통신: 없음
- 비밀/API Key 저장: 없음
- fixture 금지 데이터: 개인정보, 토큰, 문제 원문 전체, 비공개 테스트 케이스
- 코드 fixture는 최소 합성 코드만 사용한다.

## 의존성과 후속 작업

- 이 작업은 IndexedDB 라이브러리 결정을 요구하지 않는다.
- DEC-0002 중 논리 데이터 계약은 ADR-0001로 해소한다.
- DEC-0002의 실제 object store/index, transaction, migration/rollback 결정은 TASK-0003에 남는다.
- TASK-0002는 Platform과 Problem 계약을 사용한다.
- TASK-0003은 이 엔터티와 관계를 영구 저장한다.
- TASK-0004는 조건부 필수 필드와 중복 후보 결과를 UI에 사용한다.
- TASK-0005는 이 작업의 실제 테스트를 검증 관문에 포함한다.

## 위험과 반환 조건

- 수동 런타임 파서가 타입 선언과 달라질 위험: 정상/실패 fixture를 같은 PR에 요구한다.
- 엄격한 unknown-field 정책의 호환성 위험: 지원하지 않는 버전은 명시적으로 실패하고
  데이터를 부분 저장하지 않는다.
- IndexedDB가 외래키를 보장하지 않는 위험: TASK-0003에서 aggregate transaction으로
  보장한다.
- 플랫폼별 언어나 제출 결과가 enum 밖인 경우: `"other"` 또는 `"unknown"` 사용 가능성을
  먼저 검토하되 원본 문자열 보존 요구가 생기면 변경 요청한다.

다음 상황에서는 구현을 중단하고 기획에 반환한다.

- 새 dependency, Chrome 권한 또는 외부 통신이 필요함
- ADR의 필드/enum/관계로 proposal MVP 데이터를 표현할 수 없음
- 자동 병합이 요구됨
- API Key나 AI 리뷰 결과를 핵심 계약에 추가해야 함
- shared-file의 수정 소유자가 충돌함

## 완료가 아닌 것

이 핸드오프와 ADR 작성은 TASK-0001 완료가 아니다. 구현, 독립 검증, 데이터 모델 문서 반영과
기획의 증거 확인이 끝난 뒤에만 작업 상태를 Done으로 변경할 수 있다.
