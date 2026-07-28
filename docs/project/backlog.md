# CodeArchive 초기 백로그

> 상태: 초안(Draft)  
> 현재 마일스톤: M0 — 기반 정렬 (수동 등록 프로토타입 사용 가능)  
> 일정과 담당자: 미확정

이 백로그는 제안서의 MVP, 12단계 개발 순서와 성공 기준을 구현 가능한 초기 작업으로 나눈 것이다. 아래 작업은 모두 아직 완료 근거가 없으므로 `Proposed` 상태다.

## 운영 규칙

- 우선순위는 사용자 가치, 선행 의존성, 보안과 검증 위험 순으로 검토한다.
- 작업이 `Ready`가 되려면 수용 기준, 검증 방법, 의존성과 담당 역할이 확인되어야 한다.
- 하나의 작업이 한 스프린트에 검증하기 어렵다면 착수 전에 더 작게 나눈다.
- 구현 중 범위 변경은 `project.md`의 변경 관리 절차를 따른다.

## 초기 작업 요약

| ID        | GitHub                                                      | 작업                                 | 마일스톤 | 주 역할   | 상태            | 선행                 |
| --------- | ----------------------------------------------------------- | ------------------------------------ | -------- | --------- | --------------- | -------------------- |
| TASK-0001 | [#1](https://github.com/devkimhongjin/codeArchive/issues/1) | 핵심 데이터 규격과 식별자 정의       | M0       | 기획·구현 | Done            | DEC-0002, ADR-0001   |
| TASK-0002 | [#2](https://github.com/devkimhongjin/codeArchive/issues/2) | 플랫폼 어댑터 계약과 fixture 전략    | M0       | 구현·검증 | Done            | DEC-0003, ADR-0002   |
| TASK-0003 | [#3](https://github.com/devkimhongjin/codeArchive/issues/3) | IndexedDB 저장소와 마이그레이션 기반 | M0       | 구현      | In Verification | TASK-0001, DEC-0002  |
| TASK-0004 | [#4](https://github.com/devkimhongjin/codeArchive/issues/4) | 기존 풀이 수동 등록 최소 흐름        | M1       | 구현      | In Verification | TASK-0001, TASK-0003 |
| TASK-0005 | [#5](https://github.com/devkimhongjin/codeArchive/issues/5) | 실효성 있는 자동 검증 관문           | M0       | 검증      | Proposed        | TASK-0001            |
| TASK-0006 | [#6](https://github.com/devkimhongjin/codeArchive/issues/6) | KPI·ADR·트러블슈팅 기록 기반         | M0       | 기록·기획 | Proposed        | 없음                 |

## TASK-0001. 핵심 데이터 규격과 식별자 정의

- GitHub Issue: [#1](https://github.com/devkimhongjin/codeArchive/issues/1)
- 상태: `Done`
- 완료 근거: [최종 검증 PASS](../verification/2026-07-25-TASK-0001-recheck-2.md),
  [데이터 모델](../data-model.md), [ADR-0001](../adr/ADR-0001-core-data-contract.md)
- 목표: Problem, SolutionSession, Submission, AIUsageRecord의 타입, 관계, 필수/선택 필드와 식별 규칙을 정의한다.
- 범위:
  - 플랫폼과 문제 번호를 이용한 문제 식별
  - 동일 문제의 여러 풀이 세션, 제출과 언어 처리
  - AI 미사용과 미기록 상태의 명시적 구분
  - 생성·수정 시각, 데이터 출처와 스키마 버전
  - JSON/Markdown 가져오기와 내보내기의 최소 호환 규격
- 제외: UI, 실제 플랫폼 DOM 수집, 서버 동기화
- 수용 기준:
  - 제안서의 MVP 기록 필드를 타입으로 표현한다.
  - 동일 문제·동일/다른 언어·여러 제출 예시를 fixture로 표현한다.
  - 누락, 잘못된 enum, 충돌 ID에 대한 검증 규칙이 있다.
  - 데이터 모델 문서와 관련 ADR이 갱신된다.
- 검증:
  - 정상 fixture 직렬화/역직렬화 테스트
  - 잘못된 입력 거부 테스트
  - 중복 판별 경계 사례 검토
- 결정: namespaced UUID v4, UTC RFC 3339 밀리초, 의존성 없는 TypeScript 런타임 파서

## TASK-0002. 플랫폼 어댑터 계약과 fixture 전략

- GitHub Issue: [#2](https://github.com/devkimhongjin/codeArchive/issues/2)
- 상태: `Done` (2026-07-26)
- 완료 근거: [최종 검증 PASS](../verification/2026-07-26-TASK-0002.md),
  [기록 → 기획 핸드오프](../../.agents/handoffs/TASK-0002-records-to-planning.md),
  [ADR-0002](../adr/ADR-0002-platform-adapter-fixtures.md)
- 목표: SWEA부터 시작해 다른 플랫폼으로 확장 가능한 어댑터 계약과 재현 가능한 테스트 입력을 만든다.
- 범위:
  - 문제 페이지 감지, 문제 정보·코드·언어 수집, 제출 관찰 계약
  - 수집 성공, 부분 누락, DOM 변경, 비지원 페이지 오류 모델
  - 개인정보와 문제 원문을 최소화한 fixture 보관 원칙
  - 수동 입력 대체 경로의 호출 조건
- 제외: SWEA 실제 선택자의 완전 구현
- 수용 기준:
  - 공통 계층이 플랫폼 DOM에 직접 접근하지 않는다.
  - 어댑터가 실패 원인과 복구 가능 여부를 구조화해 반환한다.
  - 최소 정상/DOM 변경/코드 접근 불가 fixture가 정의된다.
  - 플랫폼 어댑터 문서와 보안·저작권 검토가 갱신된다.
- 검증:
  - fixture 기반 계약 테스트
  - 비지원 URL과 누락 요소 테스트
- 결정: 실제 사이트 원본 대신 최소 합성·비식별 fixture를 저장한다. 정상, 부분 누락,
  DOM 변경, 비지원 URL을 독립 fixture로 관리하고 selector 계약이 바뀔 때만 갱신한다.
  실제 DOM 캡처와 원문 보관은 별도 사용자 승인과 보안·저작권 검토 전까지 금지한다.
- 종료 판정: AC-0002-01~09와 AC-0002-10의 자동 품질·권한 게이트가 PASS했다. Chrome
  unpacked extension smoke는 `Not Run`이며 실제 SWEA DOM·로그인·편집기·제출 UI와 제품
  KPI는 미검증이다. 이번 완료는 M0 계약·합성 fixture 범위에 한정하며 해당 수동·실사이트
  검증은 M2 착수 시 필수 게이트로 수행한다.

## TASK-0003. IndexedDB 저장소와 마이그레이션 기반

- GitHub Issue: [#3](https://github.com/devkimhongjin/codeArchive/issues/3)
- 상태: `In Verification` (2026-07-27, 구현 완료·프로토타입 범위 PASS)
- 기획 근거: [TASK-0003 기획 → 구현 핸드오프](../../.agents/handoffs/TASK-0003-planning-to-implementation.md)
- 목표: TASK-0004 수동 등록에 필요한 핵심 데이터를 native IndexedDB v1에 로컬 우선으로
  저장하고, 이후 스키마 변경을 수용할 최소 업그레이드 경계를 만든다.
- 범위:
  - native IndexedDB v1 열기와 명시적 닫기
  - `onupgradeneeded` 기반 schema upgrade hook
  - Problem, SolutionSession, AIUsageRecord object store와 repository 경계
  - 엔터티별 저장, ID 조회, 전체 목록 조회, 수정
  - Problem·SolutionSession·AIUsageRecord를 하나의 트랜잭션으로 저장
  - 동일 ID 생성 시 구조화된 중복 오류 반환
- 제외:
  - Submission 저장
  - 삭제 및 cascade
  - 서버 동기화, 클라우드 백업, 외부 네트워크
  - 외부 IndexedDB wrapper dependency
  - 복잡한 migration/rollback fixture와 전체 테스트 매트릭스
- 수용 기준:
  - DB를 닫고 다시 열어 저장한 Problem, SolutionSession, AIUsageRecord를 ID로 조회할 수 있다.
  - 대시보드 재조회용으로 각 엔터티의 전체 목록을 조회할 수 있다.
  - 각 엔터티를 수정하면 같은 ID의 최신 값이 조회된다.
  - 생성 API에 이미 존재하는 ID를 전달하면 기존 값을 덮어쓰지 않고 중복 ID 오류를 반환한다.
  - 세 엔터티의 묶음 저장은 단일 readwrite transaction으로 처리되고 실패 시 부분 저장을 남기지 않는다.
  - v1 object store 생성은 schema upgrade hook 안에서 수행되어 후속 버전 확장 지점이 보인다.
  - 새 dependency, Chrome/host permission, 외부 통신을 추가하지 않는다.
- 검증:
  - `npm ci`와 전체 `npm run validate` PASS
  - [등록·상세·수정·reload·중복·기존 문제 Session 추가 smoke PASS](../verification/2026-07-27-PROTOTYPE.md#브라우저-기능-smoke-test)
  - [프로토타입 검증 → 기획 핸드오프](../../.agents/handoffs/PROTOTYPE-verification-to-planning.md)
- 정식 `Done` 차단:
  - storage CRUD·중복·transaction rollback·upgrade와 Dashboard UI 흐름 자동 테스트
  - Chrome 확장 관리 화면에서 `dist` 실제 unpacked extension 로드
- 결정: 프로토타입에는 native IndexedDB를 사용한다. DB 버전은 1로 시작하며 store 생성은
  upgrade hook에서만 수행한다.
- 후속: Submission, 삭제/cascade, 실제 v1→v2 migration/rollback 시험은 프로토타입 이후
  별도 작업으로 분리한다. 조건 검색과 인덱스 최적화도 후속 범위다.

## TASK-0004. 기존 풀이 수동 등록 최소 흐름

- GitHub Issue: [#4](https://github.com/devkimhongjin/codeArchive/issues/4)
- 상태: `In Verification` (2026-07-27, 구현 완료·프로토타입 범위 PASS)
- 기획 근거: [TASK-0004 기획 → 구현 핸드오프](../../.agents/handoffs/TASK-0004-planning-to-implementation.md)
- 목표: 자동 수집 전에 사용자가 기존 풀이 하나를 직접 등록하고 다시 확인할 수 있게 한다.
- 범위:
  - 기존 Popup의 `대시보드 열기` 진입점 유지
  - Dashboard 단일 페이지의 목록, 추가, 상세, 수정 흐름
  - 플랫폼, 제목 또는 문제 번호, 언어 필수 입력
  - 코드와 풀이 날짜 선택 입력
  - AI 활용 수준 입력, 기본값 `unrecorded`
  - 수동 등록 세션의 `result: unknown`, `source: manual`
  - Problem + SolutionSession + AIUsageRecord 원자 저장
  - `platform + problemNumber` 또는 `platform + 정규화 title` 중복 후보 안내
  - 기존 Problem을 선택해 새 SolutionSession + AIUsageRecord 추가
  - 중복 후보와 별개 기록으로 저장하는 명시적 선택
  - 생성된 세 엔터티의 상세 조회와 수정
- 제외:
  - 파일/ZIP 일괄 가져오기
  - URL 분석과 자동 수집
  - Submission 생성
  - 완성형 디자인, 검색·필터·정렬·통계 대시보드
- 수용 기준:
  - Popup에서 기존 버튼으로 Dashboard를 열 수 있고, Dashboard 한 페이지에서 목록·추가·상세·수정을 전환한다.
  - 플랫폼, 언어와 제목·문제 번호 중 하나가 없으면 입력 위치에서 오류를 설명하고 저장하지 않는다.
  - 신규 저장은 `result: unknown`, `source: manual`, AI 수준 `unrecorded`를 사용한다.
  - 신규 문제 저장 시 Problem, SolutionSession, AIUsageRecord를 한 트랜잭션으로 저장하고 일부만 남기지 않는다.
  - 중복 후보가 있을 때 자동으로 덮어쓰거나 병합하지 않고 기존 Problem 선택 또는 별도 저장을 요구한다.
  - 기존 Problem 선택 시 새 SolutionSession과 AIUsageRecord만 추가한다.
  - 수정 후에도 생성된 Problem, SolutionSession, AIUsageRecord의 ID와 `createdAt`이 유지된다.
  - 저장 후 목록과 상세에서 다시 확인하고 Dashboard 재실행 뒤에도 조회·수정할 수 있다.
  - 수동 등록 1분 이내 KPI를 측정할 시나리오가 정의된다.
- 검증:
  - `npm ci`와 전체 `npm run validate` PASS
  - [신규 등록·상세·수정·reload·중복 후보·기존 Problem 세션 추가 smoke PASS](../verification/2026-07-27-PROTOTYPE.md#브라우저-기능-smoke-test)
  - [프로토타입 검증 → 기획 핸드오프](../../.agents/handoffs/PROTOTYPE-verification-to-planning.md)
  - [프로토타입 기록 → 기획 핸드오프](../../.agents/handoffs/PROTOTYPE-records-to-planning.md)
- 정식 `Done` 차단:
  - storage와 Dashboard UI 주요 흐름 자동 테스트
  - Chrome 확장 관리 화면에서 `dist` 실제 unpacked extension 로드
- 기록:
  - README에 Dashboard 수동 등록 사용 흐름과 현재 제한을 갱신한다.
  - `docs/project/tech-stack.md`에 Vue 단일 페이지와 native IndexedDB 직접 연결 선택 과정, 대안을 기록한다.
  - 실제 구현 중 발생한 문제만 troubleshooting에 기록한다.
- 결정:
  - 최초 진입점은 기존 Popup의 `대시보드 열기`를 유지한다.
  - Dashboard는 프로토타입 동안 목록·추가·상세·수정을 한 페이지에서 제공한다.
  - 중복은 후보 안내만 하며 사용자의 명시적 선택 없이 병합 또는 덮어쓰기하지 않는다.

## TASK-0005. 실효성 있는 자동 검증 관문

- GitHub Issue: [#5](https://github.com/devkimhongjin/codeArchive/issues/5)
- 상태: `Proposed`
- 목표: 테스트가 없어도 성공하는 상태를 제거하고 각 변경이 실제 코드와 빌드를 검증하게 한다.
- 범위:
  - lint, format check, typecheck, unit test, production build
  - 최소 테스트 존재 여부 또는 테스트 파일 탐지
  - 플랫폼 fixture 계약 테스트 실행
  - 실패 로그의 재현 명령 기록
- 제외: 외부 플랫폼에 대한 상시 E2E 실행
- 수용 기준:
  - 테스트 파일이 하나도 없으면 검증 관문이 실패한다.
  - 고의로 깨뜨린 lint, type, unit test와 build가 각각 실패함을 확인한다.
  - 성공한 검증이 실행한 테스트 수와 빌드 결과를 남긴다.
  - 로컬과 CI에서 같은 핵심 명령을 사용한다.
- 검증:
  - 정상 경로와 의도적 실패 경로 자체 시험
- 미결정: CI 공급자와 Chrome E2E 도구

## TASK-0006. KPI·ADR·트러블슈팅 기록 기반

- GitHub Issue: [#6](https://github.com/devkimhongjin/codeArchive/issues/6)
- 상태: `Proposed`
- 목표: 제안서 성공 기준을 측정 가능한 정의로 바꾸고 의사결정과 문제 해결 근거를 지속적으로 남길 구조를 만든다.
- 범위:
  - ADR 템플릿과 상태 규칙
  - 트러블슈팅 기록 템플릿
  - KPI별 분모, 표본, 환경, 성공/실패 판정과 측정일
  - README 및 기술 스택 갱신 책임
  - 스프린트 리뷰 근거 링크 규칙
- 제외: 아직 실행하지 않은 KPI 결과 작성
- 수용 기준:
  - 수집률, 언어 감지, 다운로드, 가져오기, 중복 감지, 응답 시간 KPI에 측정 정의가 있다.
  - API Key 노출 금지와 외부 업로드 확인을 검증 체크리스트로 표현한다.
  - ADR과 트러블슈팅 예시가 각 1건 이상 검토된다.
  - 측정하지 않은 값은 `Not measured`로 표시하도록 규칙화한다.
- 검증:
  - 기록 템플릿으로 하나의 가상 변경을 추적해 누락 필드를 점검한다.
- 미결정: KPI 표본 크기와 실제 지원 브라우저 범위

## 스프린트 1 후보

스프린트 날짜와 투입 가능 시간이 확인되지 않았으므로 아래는 확정 계획이 아니다.

- 우선 후보: TASK-0001, TASK-0005, TASK-0006
- 완료: TASK-0001 핵심 데이터 계약, TASK-0002 플랫폼 계약과 합성 fixture
- 착수 조건: DEC-0002의 저장 전략은 TASK-0003에서 해소하고, DEC-0003은 TASK-0002
  기획에서 최소 합성·비식별 fixture 전략으로 해소했다.

TASK-0003과 TASK-0004는 데이터 규격과 저장 전략이 준비된 뒤 배치한다. 스프린트 용량이 확인되기 전에는 세 후보를 모두 완료 대상으로 약속하지 않는다.

## 제안서 성공 기준 추적

| 영역                   | 목표               | 현재 측정    | 측정 선행 작업         |
| ---------------------- | ------------------ | ------------ | ---------------------- |
| SWEA 문제·코드 수집    | 성공률 90% 이상    | Not measured | TASK-0002 및 SWEA 구현 |
| 프로그래머스 문제 수집 | 성공률 90% 이상    | Not measured | M4 구현                |
| 제출 결과 감지         | 성공률 90% 이상    | Not measured | M2/M4 구현             |
| 언어 감지              | 성공률 95% 이상    | Not measured | 어댑터 및 export 구현  |
| 파일 다운로드          | 성공률 99% 이상    | Not measured | M3 구현                |
| JSON 가져오기          | 성공률 99% 이상    | Not measured | M1 import 구현         |
| 중복 감지              | 성공률 95% 이상    | Not measured | TASK-0001 및 M1 구현   |
| 제출부터 기록 완료     | 10초 이내          | Not measured | M2 구현                |
| 기존 풀이 수동 등록    | 1분 이내           | Not measured | TASK-0004              |
| API Key 비노출         | 로그·출력 파일 0건 | Not measured | M5 보안 구현           |

`Not measured`는 실패나 달성을 뜻하지 않는다. 측정 정의와 실행 근거가 생긴 뒤에만 결과를 변경한다.
