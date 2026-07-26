# 검증 기록 운영 가이드

검증 보고서는 특정 커밋이 승인된 요구사항을 충족했다는 재현 가능한 증거다.

## 저장 규칙

- 파일명: `YYYY-MM-DD-TASK-NNN.md`
- 템플릿: `.agents/templates/verification-report.md`
- 하나의 보고서는 하나의 대상 커밋 SHA를 검증한다.
- 로그 전체를 복사하기보다 명령, 종료 코드, 테스트 수, 핵심 오류와 아티팩트 경로를 남긴다.
- 비밀정보, OAuth 토큰, 사용자 풀이 코드와 개인정보는 기록하지 않는다.

## 필수 판정

- `PASS`: 모든 Must 인수 조건과 필수 게이트를 실제 실행해 성공
- `FAIL`: 요구사항 불일치 또는 필수 게이트 실패
- `BLOCKED`: 환경·권한·fixture 부족 등으로 완료 불가

`not-run`, 테스트 0개, 오래된 빌드 결과는 `PASS`가 아니다. 현재 프로젝트의 `--passWithNoTests`는 false-green 위험이므로, 옵션이 제거되기 전에는 실제 수집 테스트 수를 별도로 확인해야 한다.

## 표준 실행 순서

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

프로젝트에 artifact 및 E2E 명령이 추가되면 위 순서 뒤에 실행한다. 깨끗한 환경에서 같은 커밋을 대상으로 하며, 기존 `node_modules`나 `dist`의 존재를 성공 근거로 사용하지 않는다.

## 검증 계층

1. 정적: lint, format, typecheck
2. 단위: 데이터 모델, 메시지, 저장, 파일 생성
3. 통합: 플랫폼 fixture 기반 adapter와 저장 흐름
4. E2E: 빌드된 MV3 확장의 popup/background/content/options/dashboard
5. 아티팩트: manifest 유효성, 참조 파일, 버전, 권한, ZIP 구조
6. 수동: 자동화가 불가능한 Chrome 동작만 보완적으로 수행

## False-green 차단

- 테스트 수가 0이면 실패 또는 차단으로 보고한다.
- skip/todo/only와 필터로 누락된 테스트를 확인한다.
- 실패 무시 옵션과 shell 구문을 허용하지 않는다.
- package와 manifest 버전 일치를 확인한다.
- manifest의 popup/options/background/content 참조가 실제 새 빌드에 존재하는지 확인한다.
- 성공 로그와 보고서의 커밋 SHA가 일치해야 한다.

## 실패 전달

- 코드 결함: 구현 에이전트에 요구사항 ID, 최소 재현 절차, 예상/실제 결과 전달
- 요구사항 모호성: 기획 에이전트에 해석 선택지와 영향 전달
- 반복 장애·새 기술 지식: 기록 에이전트가 troubleshooting/tech-stack 갱신
- 구조적 결정 필요: ADR 제안

## KPI

각 보고서는 최소한 `KPI-QUAL-001`, `KPI-QUAL-003`을 갱신할 수 있는 원시값을 남긴다. coverage, flaky, build time, artifact size를 측정했다면 `docs/project/kpi.md`의 ID와 계산법을 그대로 사용한다.

## 색인

| 보고서 ID | 날짜 | 작업 | 커밋 | 판정 | 주요 결함 |
| --------- | ---- | ---- | ---- | ---- | --------- |
|           |      |      |      |      |           |
