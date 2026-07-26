# TASK-0001 복구 검증 → 기록 핸드오프

- GitHub Issue: https://github.com/devkimhongjin/codeArchive/issues/1
- canonical 저장소: `C:\workspace\personalPJT\codeArchive`
- 브랜치: `codex/task-0001-core-data-contract`
- 검증 보고서: `docs/verification/2026-07-26-TASK-0001-recovery.md`
- 판정: **PASS**

## 검증 증거

- canonical top-level, 브랜치, origin 및 upstream 일치
- 부모 에이전트 실행 `npm ci`: PASS
- 부모 에이전트 실행 `npm run validate`: PASS
  - lint, format, typecheck, Vitest, production build 전체 PASS
  - Vitest: 1 file, 13 tests PASS
- 테스트 코드 읽기 전용 확인: TASK-0001의 ID, 시간, 조건부 필드, 관계, AI 사용 기록,
  중복 후보, 오류 경로, fixture 케이스 포함
- `AGENTS.md` 10절 저장소 경로 불변 규칙 확인
- `.gitattributes`의 LF 및 binary 규칙 확인

## 기록 역할 요청

- 복구 검증 보고서와 canonical 경로를 `project.md`, 백로그 또는 결정 로그의 TASK-0001
  종료 근거에 연결한다.
- 측정하지 않은 KPI는 달성으로 기록하지 않는다.
- 실제 플랫폼 DOM 수집은 TASK-0002, 저장소 migration은 TASK-0003 후속 범위로 유지한다.
- 줄바꿈 정규화와 canonical 경로 복구 과정은 필요하면 troubleshooting에 사실 중심으로
  기록한다.

## 열린 차단사항과 잔여 위험

- 기능 차단 결함: 없음
- 병합 절차 차단: canonical working tree의 변경과 신규 파일이 아직 커밋·푸시되지 않음
- 원격 CI 및 보호 브랜치 검증은 커밋·푸시 후 별도 확인 필요
- `.gitattributes` 최초 적용 시 의도하지 않은 대량 줄바꿈 diff가 없는지 커밋 전 확인 필요

