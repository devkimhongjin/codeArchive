# 프로토타입 기록 → 기획 핸드오프

## 반영 문서

- `README.md`: Popup → Dashboard → 목록·추가·중복 선택·상세·수정 흐름, IndexedDB
  local-first 저장, 빌드·unpacked 로드 절차와 현재 제한을 기록했다.
- `docs/project/tech-stack.md`: native IndexedDB, repository 경계와 atomic bundle, Vue
  단일 페이지 상태 전환의 선택 절차·대안·프로토타입 trade-off를 기록했다.
- `docs/project/troubleshooting.md`: `erasableSyntaxOnly`의 TS1294 해결과 Codex 환경의
  `npx`·Husky 수동 대체를 기록했다.

## 남은 제한

- 삭제, Submission, import, 중복 병합과 실사이트 자동 수집은 구현되지 않았다.
- IndexedDB migration·rollback·transaction 실패 및 Dashboard 주요 흐름의 독립 검증은
  프로토타입 통합 검증으로 유예됐다.
- Chrome unpacked extension smoke test와 KPI “수동 등록 1분 이내” 측정도 아직 수행하지
  않았다.

TASK-0003과 TASK-0004를 `Done`으로 판정하지 말고 구현 완료·검증 대기로 유지한다.
