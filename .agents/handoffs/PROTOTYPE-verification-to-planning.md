# 프로토타입 검증 → 기획 핸드오프

## 판정

- 프로토타입 범위: **PASS**
- 정식 TASK-0003·TASK-0004 완료 판정: **보류**
- 상세 보고서:
  `docs/verification/2026-07-27-PROTOTYPE.md`

## 검증 증거

- `npm ci`: PASS — 241 packages, 취약점 0
- `npm run validate`: PASS
  - lint PASS
  - format PASS
  - typecheck PASS
  - Vitest 기존 2 files / 24 tests PASS
  - production build 30 modules PASS
- 별도 임시 Chrome 프로필과 동일 빌드 코드 smoke:
  - 신규 등록 → 상세 → 수정 → reload 영속성 PASS
  - 중복 후보 표시와 저장 전 명시적 선택 PASS
  - 기존 Problem에 두 번째 Session + AI 추가 PASS
  - 같은 Problem의 풀이 2개 목록 유지 PASS

## 코드 감사 결과

- 세 엔터티의 생성·수정은 단일 IndexedDB `readwrite` transaction이며 완료 이벤트 후에만
  성공을 반환한다.
- 저장 전에 엔터티 parser와 aggregate 관계 parser를 적용한다.
- UI 필수값 누락은 저장 호출 전에 차단한다.
- 중복 후보는 자동 병합·덮어쓰기하지 않는다.
- 수정 시 세 엔터티의 ID와 `createdAt`, 관계 ID를 유지하고 `updatedAt`만 갱신한다.
- package/lockfile/manifest 변경, 새 권한, 새 dependency, 외부 네트워크 경로가 없다.

## 기획 종료 전 필수 후속

1. storage CRUD·중복·transaction rollback·upgrade와 Dashboard 흐름을 직접 검증하는
   자동 테스트를 추가한다.
2. Chrome 확장 관리 화면에서 `dist`를 실제 unpacked extension으로 로드해 popup,
   Dashboard, reload, service worker와 manifest 오류를 수동 확인한다.

정식 Chrome은 자동 `--load-extension` 플래그를 무시했으므로 실제 unpacked extension
로드는 **Not Run**이다. 브라우저 smoke가 이 검증을 대체하지 않는다.

## 비차단 잔여 위험

- 필수값 오류는 저장을 차단하지만 각 입력 위치가 아니라 상단 `role="alert"`로만
  표시된다.
- 신규 storage/UI 자동 테스트 부재로 세부 회귀 탐지력은 아직 낮다.
- 완전한 Session + AI 조합이 없는 고립 Problem은 Dashboard 중복 후보에서 제외될 수
  있다.

기획은 프로토타입 시연 상태를 인정할 수 있지만, 위 필수 후속이 끝나기 전 TASK-0003과
TASK-0004를 `Done` 또는 정식 병합 준비 완료로 변경하지 않는다.
