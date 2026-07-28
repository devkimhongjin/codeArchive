# TASK-0004 구현 → 기록 핸드오프

## 구현 요약

- Dashboard 단일 페이지에서 풀이 목록, 빈 상태, 추가, 상세, 수정 상태를 전환한다.
- Problem, SolutionSession, AIUsageRecord를 결합해 목록과 상세를 표시한다.
- 수동 등록 시 `CodeArchiveRepository`의 원자 저장 메서드만 사용한다.
- 저장 전에 문제 번호(강한 후보)와 정규화 제목(약한 후보)을 비교하고 사용자 선택 전에는 저장하지 않는다.
- 중복 후보에서는 기존 문제에 세션 추가, 별도 문제 저장, 입력 수정 중 하나를 선택한다.
- 수정 시 기존 ID와 `createdAt`을 유지하고 `updatedAt`만 갱신한다.
- 저장소 오류는 화면에 표시하며 입력값을 유지한다.

## 변경 파일

- `src/dashboard/DashboardApp.vue`
- `.agents/handoffs/TASK-0004-implementation-to-records.md`

## 기술 선택

- 별도 라우터·상태관리 의존성 없이 Vue Composition API의 로컬 상태로 단일 페이지 전환을 구성했다.
- Dashboard에서 IndexedDB를 직접 다루지 않고 `CodeArchiveRepository` facade만 사용한다.
- 생성 ID와 시간은 TASK-0001의 `createEntityId`, `createUtcTimestamp`를 재사용한다.

## 기록 역할 요청

- README에 Dashboard 수동 등록·중복 선택·상세·수정 흐름과 프로토타입 제한을 추가한다.
- `docs/project/tech-stack.md`에 Vue 단일 페이지 상태 전환 및 repository facade 선택 근거와 대안을 기록한다.
- 실제 구현 중 별도 트러블슈팅 항목은 발생하지 않았다.

## 유예 사항

- 정상·필수값 누락·중복 선택·원자 저장 실패·재실행·수정에 대한 자동 및 수동 상세 검증은 프로토타입 통합 검증 시 수행한다.
- 삭제, 병합, 검색·필터, Submission, 자동 수집은 후속 범위다.
