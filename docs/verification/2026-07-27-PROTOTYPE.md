# CodeArchive 프로토타입 통합 검증 보고서

## 판정

**프로토타입 범위 PASS**

TASK-0003의 native IndexedDB 저장소와 TASK-0004의 수동 풀이 등록 흐름은 기획된
프로토타입 핵심 경로를 충족한다. clean install과 전체 자동 검증이 통과했고, 별도
브라우저 프로필에서 동일 빌드 코드를 사용한 기능 smoke test도 통과했다.

다만 Chrome 확장 관리 화면에서 `dist`를 실제 압축 해제 확장 프로그램으로 로드하는
수동 smoke test는 수행하지 못했다. 따라서 이 보고서의 PASS는 **프로토타입 기능 범위에
한정**하며, 정식 Chrome Extension 완료 판정과 TASK-0003·TASK-0004의 최종 `Done`
전환 근거로는 사용하지 않는다.

## 대상과 환경

- 기준 저장소: `C:\workspace\personalPJT\codeArchive`
- 기준 브랜치: `codex/task-0001-core-data-contract`
- 기준 커밋: `7941edd9b934c56102256173a819a57d466e8b9d`
- 검증 대상: 위 커밋 이후 TASK-0003·TASK-0004 working tree 변경
- 검증일: 2026-07-27
- 자동 검증: clean dependency install 후 저장소 표준 `npm run validate`
- 브라우저 검증: 별도 임시 Chrome 프로필과 Vite에서 동일 빌드 코드 사용

## 자동 검증 결과

| 단계             | 명령/항목                         | 결과                          |
| ---------------- | --------------------------------- | ----------------------------- |
| clean install    | `npm ci`                          | PASS — 241 packages, 취약점 0 |
| lint             | `npm run validate`의 lint         | PASS                          |
| format           | `npm run validate`의 format check | PASS                          |
| typecheck        | `npm run validate`의 typecheck    | PASS                          |
| unit test        | Vitest                            | PASS — 기존 2 files, 24 tests |
| production build | `npm run validate`의 build        | PASS — 30 modules             |

현재 24개 자동 테스트는 기존 데이터 계약과 플랫폼 어댑터를 검증한다. 이번에 추가된
`src/storage/**`의 CRUD·중복·transaction rollback·upgrade와 Dashboard UI 흐름을 직접
자동화한 테스트는 아직 없다. 그러므로 자동 검증 PASS만으로 신규 기능의 세부 동작을
입증하지 않고 아래 수동 증거와 함께 판정했다.

## 브라우저 기능 smoke test

| 시나리오                         | 결과        | 증거                                                  |
| -------------------------------- | ----------- | ----------------------------------------------------- |
| 신규 Problem + Session + AI 등록 | PASS        | 저장 후 목록과 상세에 표시                            |
| 상세 조회 후 수정                | PASS        | 수정 값이 상세에 반영                                 |
| reload 후 영속성                 | PASS        | reload 뒤에도 저장·수정 값 유지                       |
| 중복 후보 감지                   | PASS        | 후보를 표시하고 사용자의 선택 전 저장 차단            |
| 기존 Problem에 풀이 추가         | PASS        | 두 번째 Session + AI 레코드 추가                      |
| 다중 Session 목록 유지           | PASS        | 같은 Problem의 풀이 2개가 목록에 유지                 |
| 실제 unpacked extension 로드     | **Not Run** | 정식 Chrome이 자동 `--load-extension` 플래그를 무시함 |

브라우저 smoke는 Dashboard 기능을 검증했지만 popup, service worker, manifest 경로를
포함한 실제 unpacked extension 설치 검증을 대체하지 않는다.

## 독립 코드 감사

### 저장 원자성과 오류 처리

- `createCoreRecordBundle`은 Problem, SolutionSession, AIUsageRecord 세 store를 하나의
  `readwrite` transaction으로 연다.
- `createSolutionBundle`은 기존 Problem의 존재를 먼저 확인하고 새 Session과 AI 레코드만
  같은 transaction에 추가한다. 기존 Problem은 덮어쓰지 않는다.
- `updateCoreRecordBundle`은 세 레코드의 존재를 모두 확인한 뒤 같은 transaction에서
  갱신한다.
- `runTransaction`은 operation 실패 시 transaction을 abort하고, 성공 값은
  `transaction.oncomplete` 뒤에만 반환한다. 따라서 요청 중 하나가 실패한 경우 성공으로
  보고하거나 부분 저장을 확정하는 경로가 없다.
- IndexedDB `ConstraintError`, 미존재 ID, 검증 오류와 일반 저장 오류는 구조화된
  `CodeArchiveStorageError`로 구분된다.

### 입력과 관계 검증

- 단일 엔터티 CRUD는 기존 `parseProblem`, `parseSolutionSession`,
  `parseAIUsageRecord`를 통과한 값만 저장한다.
- 묶음 저장과 묶음 수정은 `parseCoreDataAggregate`를 사용해 Problem → Session →
  AIUsageRecord 관계까지 검증한다.
- UI는 플랫폼·언어와 제목/문제 번호 중 하나를 저장 전에 확인한다. 필수값이 없으면
  repository 저장 메서드를 호출하지 않는다.
- 현재 필수값 오류는 상단 `role="alert"` 메시지로 제공된다. 저장 차단 자체는
  동작하지만 기획 문구의 “입력 위치에서 설명”에 해당하는 필드별 inline 오류와
  `aria-invalid`는 구현되지 않았다. 프로토타입 사용성 잔여 위험으로 남긴다.

### 중복, 수정 불변성, 공유 Problem

- 신규 저장 전에 `compareProblems`로 동일 플랫폼의 문제 번호 또는 정규화 제목을
  비교한다.
- 후보가 있으면 자동 병합·덮어쓰기를 하지 않고 기존 Problem에 Session 추가, 별도
  Problem 저장, 입력 수정 중 하나를 명시적으로 선택하게 한다.
- 수정 payload는 기존 엔터티를 전개한 뒤 변경 가능 필드와 `updatedAt`만 바꾼다.
  Problem, SolutionSession, AIUsageRecord의 ID와 `createdAt`, 관계 ID는 보존된다.
- 여러 Session이 한 Problem을 공유할 때 Problem 필드 수정의 영향을 UI에서 안내한다.

### 권한, dependency, 외부 통신

- `package.json`, lockfile과 `public/manifest.json`은 이번 변경에서 수정되지 않았다.
- Chrome permission과 host permission 증가는 없다.
- 저장소 구현은 브라우저 native IndexedDB만 사용하며 새 dependency를 추가하지 않았다.
- 변경된 제품 코드에서 `fetch`, XHR, WebSocket 또는 외부 업로드 경로를 추가하지 않았다.
- 저장 데이터는 현재 브라우저 프로필의 `codearchive` IndexedDB에만 기록된다.

## 인수 조건 요약

| 범위                                  | 판정                   | 근거                                               |
| ------------------------------------- | ---------------------- | -------------------------------------------------- |
| TASK-0003 v1 schema와 세 object store | PASS                   | schema upgrade hook 정적 감사, build PASS          |
| 엔터티 CRUD/list와 재오픈 영속성      | PASS                   | repository 감사, reload smoke PASS                 |
| 중복 ID와 묶음 저장 원자성            | PASS(코드 감사)        | `add`/ConstraintError, 단일 transaction·abort 경로 |
| TASK-0004 목록·추가·상세·수정         | PASS                   | 브라우저 smoke PASS                                |
| 필수값 저장 차단                      | PASS(사용성 잔여 위험) | `validateForm`; inline 필드 오류는 미구현          |
| 중복 후보와 명시적 선택               | PASS                   | 브라우저 smoke 및 UI 분기 감사                     |
| 기존 Problem에 Session + AI 추가      | PASS                   | 브라우저 smoke PASS                                |
| ID·createdAt 보존 수정                | PASS(코드 감사)        | 기존 엔터티 spread 후 `updatedAt`만 갱신           |
| permission/dependency/network 무변경  | PASS                   | diff와 제품 코드 정적 감사                         |
| 실제 unpacked extension smoke         | Not Run                | 정식 Chrome에서 자동 로드 플래그 무시              |

## 잔여 위험과 후속 검증

1. storage와 Dashboard 신규 코드에 대한 자동 테스트가 없다. fake IndexedDB 기반
   CRUD·중복·rollback·upgrade 테스트와 UI component 또는 E2E 테스트를 추가해야 한다.
2. Chrome `chrome://extensions`에서 `dist`를 실제 unpacked extension으로 로드하고
   popup → Dashboard 진입, 새로고침, service worker/manifest 오류 유무를 수동 확인해야
   한다.
3. 필수 입력 오류는 현재 form 상단에만 표시된다. 각 관련 필드에 inline 설명과
   `aria-invalid`/`aria-describedby` 연결을 추가하는 것이 바람직하다.
4. 중복 후보는 현재 완전한 Record로 조합된 Problem을 기준으로 한다. repository를 통해
   Problem만 단독 생성한 비정상·관리용 데이터는 Dashboard 후보 목록에서 빠질 수 있다.

위 후속 항목 중 1과 2는 TASK-0003·TASK-0004의 정식 완료 및 병합 전 검증 게이트로
유지한다.
