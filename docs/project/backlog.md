# CodeArchive 초기 백로그

> 상태: 초안(Draft)  
> 현재 마일스톤: M0 — 기반 정렬  
> 일정과 담당자: 미확정

이 백로그는 제안서의 MVP, 12단계 개발 순서와 성공 기준을 구현 가능한 초기 작업으로 나눈 것이다. 아래 작업은 모두 아직 완료 근거가 없으므로 `Proposed` 상태다.

## 운영 규칙

- 우선순위는 사용자 가치, 선행 의존성, 보안과 검증 위험 순으로 검토한다.
- 작업이 `Ready`가 되려면 수용 기준, 검증 방법, 의존성과 담당 역할이 확인되어야 한다.
- 하나의 작업이 한 스프린트에 검증하기 어렵다면 착수 전에 더 작게 나눈다.
- 구현 중 범위 변경은 `project.md`의 변경 관리 절차를 따른다.

## 초기 작업 요약

| ID        | GitHub                                                      | 작업                                 | 마일스톤 | 주 역할   | 상태     | 선행                 |
| --------- | ----------------------------------------------------------- | ------------------------------------ | -------- | --------- | -------- | -------------------- |
| TASK-0001 | [#1](https://github.com/devkimhongjin/codeArchive/issues/1) | 핵심 데이터 규격과 식별자 정의       | M0       | 기획·구현 | Done     | DEC-0002, ADR-0001   |
| TASK-0002 | [#2](https://github.com/devkimhongjin/codeArchive/issues/2) | 플랫폼 어댑터 계약과 fixture 전략    | M0       | 구현·검증 | Done     | DEC-0003, ADR-0002   |
| TASK-0003 | [#3](https://github.com/devkimhongjin/codeArchive/issues/3) | IndexedDB 저장소와 마이그레이션 기반 | M0       | 구현      | Proposed | TASK-0001, DEC-0002  |
| TASK-0004 | [#4](https://github.com/devkimhongjin/codeArchive/issues/4) | 기존 풀이 수동 등록 최소 흐름        | M1       | 구현      | Proposed | TASK-0001, TASK-0003 |
| TASK-0005 | [#5](https://github.com/devkimhongjin/codeArchive/issues/5) | 실효성 있는 자동 검증 관문           | M0       | 검증      | Proposed | TASK-0001            |
| TASK-0006 | [#6](https://github.com/devkimhongjin/codeArchive/issues/6) | KPI·ADR·트러블슈팅 기록 기반         | M0       | 기록·기획 | Proposed | 없음                 |

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
- 상태: `Proposed`
- 목표: 핵심 데이터를 로컬 우선으로 안전하게 저장하고 스키마 변경을 추적할 기반을 만든다.
- 범위:
  - DB 열기, 버전 관리, 트랜잭션과 repository 경계
  - 핵심 엔터티 생성·조회·수정·삭제
  - 중복 키와 실패 시 롤백
  - 테스트용 DB 초기화와 마이그레이션 fixture
- 제외: 서버 동기화, 클라우드 백업
- 수용 기준:
  - 브라우저 재실행에 해당하는 DB 재오픈 후 데이터가 유지된다.
  - 실패한 트랜잭션이 부분 데이터를 남기지 않는다.
  - 스키마 버전 변경의 업그레이드 테스트가 있다.
  - 민감 정보 저장 범위와 삭제 동작이 문서화된다.
- 검증:
  - CRUD, 중복, 트랜잭션 롤백, 업그레이드 테스트
- 미결정: 직접 IndexedDB 사용 또는 래퍼 도입

## TASK-0004. 기존 풀이 수동 등록 최소 흐름

- GitHub Issue: [#4](https://github.com/devkimhongjin/codeArchive/issues/4)
- 상태: `Proposed`
- 목표: 자동 수집 전에 사용자가 기존 풀이 하나를 직접 등록하고 다시 확인할 수 있게 한다.
- 범위:
  - 플랫폼, 문제 번호, 제목, 언어, 코드, 풀이 날짜 입력
  - AI 활용 수준과 미기록 상태 입력
  - 중복 후보 안내
  - 저장 후 상세 조회와 수정
- 제외: 파일/ZIP 일괄 가져오기, URL 자동 분석, 완성형 대시보드
- 수용 기준:
  - 필수 필드 오류를 입력 위치에서 설명한다.
  - 저장 후 재실행 시 기록을 조회하고 수정할 수 있다.
  - 중복 후보가 있을 때 자동 덮어쓰지 않는다.
  - 수동 등록 1분 이내 KPI를 측정할 시나리오가 정의된다.
- 검증:
  - 정상 등록, 필수값 누락, 중복, 저장 실패 시나리오
- 미결정: 최초 UI 진입점과 필수 입력의 최소 범위

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
