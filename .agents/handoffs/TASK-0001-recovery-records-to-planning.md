# TASK-0001 복구 기록 → 기획 핸드오프

- GitHub Issue: https://github.com/devkimhongjin/codeArchive/issues/1
- canonical 저장소: `C:\workspace\personalPJT\codeArchive`
- 브랜치: `codex/task-0001-core-data-contract`
- 기록일: 2026-07-26

## 변경한 문서

- `docs/project/troubleshooting.md`
  - `TS-2026-001`: 별도 writable 경로를 기준 저장소로 사용해 Git 이력이 분리된 장애
  - `TS-2026-002`: Windows `core.autocrlf`와 Prettier LF 정책 불일치

## 근거

- 검증 보고서: `docs/verification/2026-07-26-TASK-0001-recovery.md`
- 검증 → 기록 핸드오프:
  `.agents/handoffs/TASK-0001-recovery-verification-to-records.md`
- canonical 저장소에서 확인한 top-level, branch 및 origin
- 복구 후 `npm ci`, `npm run validate` PASS와 Vitest 13개 테스트 PASS

## 문서화한 예방 규칙

- 모든 변경 전에 사용자가 지정한 canonical top-level을 확인한다.
- 권한 제약이 있으면 별도 저장소를 만들지 않고 승인 요청 후 중단한다.
- 두 저장소가 생긴 경우 각 HEAD, branch, remote, upstream 및 working tree를 먼저 비교한다.
- `.gitattributes`의 `* text=auto eol=lf`를 저장소 줄바꿈 기준으로 사용한다.
- 줄바꿈 정규화 후 의도하지 않은 대규모 diff와 Prettier 결과를 확인한다.

## KPI 및 보안

- 측정하지 않은 KPI 달성 주장은 추가하지 않았다.
- 비밀 값, 토큰, 개인정보 또는 실제 풀이 코드는 기록하지 않았다.

## 잔여 위험

- `.gitattributes` 최초 적용 후 새 checkout에서 불필요한 줄바꿈 diff가 없는지 확인해야 한다.
- 원격 CI와 보호 브랜치 검증은 커밋·푸시 후 별도로 확인해야 한다.
- 실제 플랫폼 DOM 수집은 TASK-0002, IndexedDB migration과 rollback은 TASK-0003 범위다.

## 기획 확인 요청

- 복구 기록과 예방 규칙을 TASK-0001 종료 근거에 연결한다.
- canonical 저장소의 변경이 사용자 커밋·푸시된 뒤 원격 CI 및 병합 게이트를 확인한다.
