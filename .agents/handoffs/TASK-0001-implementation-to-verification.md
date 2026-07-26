# TASK-0001 구현 → 검증 인계

- GitHub Issue: https://github.com/devkimhongjin/codeArchive/issues/1
- 기준 ADR: `docs/adr/ADR-0001-core-data-contract.md`
- 기획 인계: `.agents/handoffs/TASK-0001-planning-to-implementation.md`
- 작성일: 2026-07-25

## 구현 요약

- Problem, SolutionSession, Submission, AIUsageRecord 타입과 enum을 정의했다.
- 엔터티별 namespaced UUID 생성과 UTC timestamp 생성 함수를 추가했다.
- 외부 `unknown` 입력을 검증하는 순수 TypeScript 파서를 추가했다.
- UTC/달력 날짜, 조건부 필수값, AI 활용 규칙, 엔터티 관계와 단위 검증을 구현했다.
- Problem 및 SolutionSession 중복 후보 비교와 자동 병합 금지 규칙을 구현했다.
- SWEA 다중 제출, Python 복습, 코드 없는 수동 등록 fixture를 추가했다.

## 변경 파일

- `src/common/types/index.ts`
- `src/common/validators/index.ts`
- `tests/fixtures/problems.json`
- `tests/fixtures/solutions.json`
- `tests/fixtures/submissions.json`
- `tests/unit/data-contract.test.ts`
- `.prettierignore`

## AC 대응

- AC-01~03: 타입, ID, UTC와 날짜 검사 및 단위 테스트
- AC-04: Problem 조건부 필수값과 HTTPS URL 정규화
- AC-05: aggregate 관계, 언어 일치, 실행 시간/메모리 단위 검사
- AC-06: `none`/`unrecorded` 구분과 목적/기여율 규칙
- AC-07: strong/weak/conflict 중복 후보와 `autoMerge: false`
- AC-08: unknown field, 복수 오류, 경로, frozen input, code 공백 보존
- AC-09: fixture aggregate JSON 왕복 테스트
- AC-10: focused 테스트와 정적 검증·빌드 실행

## 실행 결과

| 검증 | 결과 |
| --- | --- |
| ESLint 전체 | PASS |
| Prettier 전체 | PASS |
| vue-tsc typecheck | PASS |
| Vitest | 1 file, 10 tests PASS |
| Production build | PASS |

실행 환경에는 npm 실행 파일이 없어 동일 도구의 직접 실행 파일로 검증했다. 설치 의존성은
커밋 대상이 아닌 `node_modules`에만 존재하며 package/lockfile은 변경하지 않았다.

## 검증 요청

- ADR 필드와 런타임 파서의 누락 여부
- 잘못된 optional enum과 nested path 오류
- strong 키 충돌 판정의 기대 동작
- fixture가 문제 원문, 개인정보, 토큰을 포함하지 않는지
- build 결과가 최신 소스에서 생성됐는지

## 잔여 위험

- UUID 100개 표본 중복 테스트는 아직 포함하지 않았다.
- fixture는 합성 데이터이며 실제 플랫폼 DOM 수집 정확도를 검증하지 않는다.
- 런타임 파서는 새 필드 추가 시 타입과 허용 필드 목록을 함께 갱신해야 한다.

