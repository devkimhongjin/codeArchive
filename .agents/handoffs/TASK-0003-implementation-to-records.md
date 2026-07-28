# TASK-0003 구현 → 기록 핸드오프

## 구현 범위

- `src/storage/schema.ts`: `codearchive` DB, schema version 1, `problems`,
  `solutionSessions`, `aiUsageRecords` object store와 upgrade 함수
- `src/storage/indexed-db.ts`: DB open, request/transaction Promise helper,
  transaction 실패의 `storage_error` 변환
- `src/storage/errors.ts`: `duplicate_id`, `not_found`, `validation_error`,
  `storage_error` 구조화 오류
- `src/storage/repository.ts`: 세 엔터티의 create/get/list/update, 전체 묶음 생성·수정,
  기존 Problem에 풀이 묶음을 추가하는 `createSolutionBundle`
- `src/storage/index.ts`: 저장소 공개 API barrel

## 기술 선택과 구현 근거

- 별도 dependency 없이 브라우저 native IndexedDB를 사용했다.
- 저장 전 단일 엔터티는 기존 parser, 관계가 있는 묶음은
  `parseCoreDataAggregate`로 검증한다.
- 묶음 쓰기는 한 readwrite transaction에서 실행해 부분 저장을 방지한다.
- create는 `add`, update는 존재 확인 후 `put`을 사용해 중복과 미존재를 구분한다.
- 입력과 반환값은 `structuredClone`으로 복제해 호출자 변경이 저장 데이터에 영향을 주지
  않도록 했다.

## 부모 작업에서 보완된 사항

- TypeScript `erasableSyntaxOnly`에 맞게 constructor parameter property를 일반 필드와
  할당으로 변경했다.
- TASK-0004 연결을 위해 기존 Problem을 유지하며 SolutionSession과 AIUsageRecord를
  원자적으로 추가하는 `createSolutionBundle`을 보완했다.
- 세 엔터티를 함께 수정하는 `updateCoreRecordBundle`을 보완했다.

## 최소 게이트

- `npm run lint`: PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS

## 제한과 후속 기록

- Submission, delete/cascade, 검색·인덱스 최적화, 실제 v2 migration, network 동기화는
  범위 밖이다.
- CRUD, duplicate, rollback, upgrade의 자동 테스트와 전체 `npm run validate`, Chrome
  unpacked smoke test는 프로토타입 통합 검증 시점으로 유예됐다.
- TASK-0003은 독립 검증 전이므로 `Done`으로 판정하지 않는다.
- 기록 역할은 README에 로컬 저장 동작과 현재 제한을, 기술 스택 문서에 native
  IndexedDB 선택 이유와 대안을 최소한으로 반영한다.
