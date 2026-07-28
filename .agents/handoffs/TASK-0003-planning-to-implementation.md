# TASK-0003 기획 → 구현 핸드오프

## 기본 정보

- 작업 ID: `TASK-0003`
- 제목: IndexedDB 저장소와 마이그레이션 기반
- GitHub Issue: [#3](https://github.com/devkimhongjin/codeArchive/issues/3)
- 상태: `In Progress`
- 우선순위: `P0`
- 기획일: 2026-07-27
- 선행: TASK-0001, ADR-0001
- 목적: TASK-0004의 기존 풀이 수동 등록 흐름이 사용할 최소 로컬 저장 계층 제공

## 문제와 사용자 가치

현재 핵심 데이터 계약은 있지만 브라우저 재실행 뒤에도 기록을 유지할 영속 저장소가 없다.
사용자는 수동으로 등록한 문제와 풀이, AI 활용 기록을 다시 조회하고 수정할 수 있어야 한다.
이번 작업은 완전한 저장소 프레임워크가 아니라 그 프로토타입 경로만 연다.

## 포함 범위

- 외부 dependency 없는 native IndexedDB
- DB 이름과 버전 1 상수
- DB open/close
- `onupgradeneeded` schema upgrade hook
- Problem, SolutionSession, AIUsageRecord object store
- 각 엔터티의 생성, ID 조회, 전체 목록 조회, 수정
- 동일 ID 생성 시 기존 데이터 보존과 구조화된 중복 오류
- Problem + SolutionSession + AIUsageRecord의 단일 readwrite transaction 저장

## 제외 및 후속

- Submission 저장
- 삭제와 cascade
- 조건 검색과 인덱스 최적화
- v1→v2 등 실제 migration과 rollback 구현
- 복잡한 migration/transaction 테스트 매트릭스
- 서버 동기화, 백업, 외부 네트워크
- IndexedDB wrapper dependency

제외 항목은 프로토타입 이후 백로그에서 별도 작업으로 다룬다.

## 요구사항

| ID | 요구사항 | 우선순위 | 근거 |
| --- | --- | --- | --- |
| REQ-0003-01 | native IndexedDB v1 DB를 열고 명시적으로 닫을 수 있다. | Must | TASK-0004 재조회 |
| REQ-0003-02 | upgrade hook에서 세 object store를 생성한다. | Must | 후속 schema 확장 |
| REQ-0003-03 | Problem, SolutionSession, AIUsageRecord를 생성·ID 조회·전체 목록 조회·수정한다. | Must | 수동 등록/대시보드 재조회/수정 |
| REQ-0003-04 | create의 중복 ID는 기존 값을 덮어쓰지 않고 식별 가능한 오류로 반환한다. | Must | 데이터 손실 방지 |
| REQ-0003-05 | 세 엔터티 묶음 저장은 단일 transaction으로 원자적으로 처리한다. | Must | 관계 데이터 일관성 |
| REQ-0003-06 | 새 dependency, 권한, host permission, 네트워크를 추가하지 않는다. | Must | 프로토타입 보안/속도 |

## 인수 조건

| ID | Given | When | Then |
| --- | --- | --- | --- |
| AC-0003-01 | 닫힌 DB | v1으로 open 후 close | 세 store가 생성되고 연결이 닫힌다. |
| AC-0003-02 | 유효한 각 엔터티 | create 후 ID 조회 | 입력과 같은 엔터티를 반환한다. |
| AC-0003-08 | 여러 엔터티가 저장된 DB | 각 repository의 getAll/list 호출 | 해당 엔터티 전체 목록을 반환한다. |
| AC-0003-03 | 이미 존재하는 ID | create 재호출 | 중복 오류를 반환하고 기존 값은 유지된다. |
| AC-0003-04 | 저장된 엔터티 | 변경된 값으로 update | 동일 ID에서 최신 값을 반환한다. |
| AC-0003-05 | 유효한 세 엔터티 | 묶음 저장 | 하나의 readwrite transaction에서 모두 저장된다. |
| AC-0003-06 | 묶음 저장 중 한 요청 실패 | transaction 종료 | 이번 묶음의 부분 저장이 남지 않는다. |
| AC-0003-07 | DB를 닫은 상태 | 다시 open 후 ID 조회 | 앞서 저장한 데이터가 유지된다. |

## 구현 제약과 소유권

- `src/storage/**`는 구현 역할 소유다.
- 공통 타입은 `src/common/types/index.ts`를 재사용하고 계약을 임의 변경하지 않는다.
- repository는 브라우저의 IndexedDB 비동기 이벤트를 Promise 기반 결과로 감싼다.
- create와 update의 의미를 분리한다. create는 중복을 거부하고 update는 존재하는 ID만 갱신한다.
- upgrade hook을 별도 함수 경계로 두되 이번에는 version 1 store 생성만 구현한다.
- DB transaction 완료 전에 성공을 반환하지 않는다.
- 민감정보, 토큰, 문제 원문을 새로 저장하지 않는다.
- `package.json`, manifest와 권한은 수정하지 않는다.

## 검증·기록 유예

사용자의 프로토타입 우선 지시에 따라 이번 단계에서는 기획과 구현 후 lint, typecheck,
production build만 최소 확인한다. 독립 검증, CRUD/중복/rollback/upgrade 자동 테스트,
전체 `npm run validate`와 완료 판정은 프로토타입 통합 검증 시점으로 유예한다.
따라서 최소 구현이 끝나도 TASK-0003 상태는 `In Progress`로 유지한다.

기록 역할은 구현 뒤 최소한 다음을 남긴다.

- README의 로컬 저장 동작과 현재 제한
- `docs/project/tech-stack.md`의 native IndexedDB 선택 이유와 검토 대안
- 실제 문제가 발생한 경우 troubleshooting

## 위험과 롤백

- IndexedDB는 브라우저 전용이므로 Node 기반 테스트에는 별도 환경이 필요할 수 있다.
- 복잡한 migration 검증을 유예했으므로 v1 schema 이외의 호환성을 주장하지 않는다.
- rollback은 새 저장 계층의 호출 연결을 제거하고 DB version을 올리지 않는 방식으로 한다.
- DB 삭제 API는 이번 범위에 포함하지 않는다.

## 변경 이력

| 일시 | 변경 내용 | 사유 | 승인 |
| --- | --- | --- | --- |
| 2026-07-27 | 최소 프로토타입 범위로 최초 승인 | TASK-0004 착수 경로를 빠르게 확보 | 사용자 지시 |
