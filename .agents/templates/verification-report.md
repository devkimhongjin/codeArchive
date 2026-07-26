# 검증 보고서

## 식별 정보

- 보고서 ID: `VER-YYYYMMDD-NNN`
- 작업 ID:
- 대상 커밋 SHA:
- 기준 브랜치/SHA:
- 검증자:
- 검증 일시:
- 환경: OS / Node / npm / Chrome
- 관련 브리프:
- 관련 구현 인계서:

## 최종 판정

- 판정: `PASS | FAIL | BLOCKED`
- 요약:
- 미검증 범위:

판정 원칙:

- `PASS`: 모든 Must 인수 조건과 필수 게이트가 실행되어 성공하고 증거가 있다.
- `FAIL`: 실행 결과가 요구사항과 다르거나 필수 게이트가 실패했다.
- `BLOCKED`: 환경·데이터·권한 등의 이유로 검증 자체를 완료하지 못했다.
- 테스트 0개, `--passWithNoTests`, 실행하지 않은 명령, 오래된 `dist`의 존재는 성공 근거가 아니다.

## 요구사항 추적

| REQ/AC ID | 검증 수준 | 테스트/절차 | 예상 결과 | 실제 결과 | 판정 | 증거 |
| --- | --- | --- | --- | --- | --- | --- |
|  | `unit | integration | e2e | manual` |  |  |  |  |  |

## 필수 게이트

| 게이트 | 명령 | 종료 코드 | 실행 테스트 수 | 결과 | 로그/아티팩트 |
| --- | --- | ---: | ---: | --- | --- |
| 의존성 설치 | `npm ci` |  | N/A |  |  |
| 린트 | `npm run lint` |  | N/A |  |  |
| 포맷 | `npm run format:check` |  | N/A |  |  |
| 타입 | `npm run typecheck` |  | N/A |  |  |
| 테스트 | `npm test` |  |  |  |  |
| 빌드 | `npm run build` |  | N/A |  |  |
| 아티팩트 | 프로젝트 정의 명령 |  | N/A |  |  |

## False-green 점검

- [ ] 테스트 수가 1개 이상이며 예상된 테스트가 실제 수집됨
- [ ] skip/todo/only 사용을 확인하고 정당한 예외를 기록함
- [ ] `--passWithNoTests` 또는 실패 무시 구문이 없음
- [ ] 명령 체인의 앞선 실패가 뒤 명령으로 가려지지 않음
- [ ] 새로 생성한 빌드 결과를 검증했으며 과거 `dist`를 재사용하지 않음
- [ ] manifest 참조 파일이 빌드 아티팩트에 모두 존재함
- [ ] package/manifest 버전이 일치함
- [ ] content script, background, popup, options의 실제 로드 여부를 확인함
- [ ] 수동 검증만 수행한 항목을 자동 검증으로 표시하지 않음

## 결함

| 결함 ID | 심각도 | 관련 REQ/AC | 재현 절차 | 예상/실제 | 담당 |
| --- | --- | --- | --- | --- | --- |
| `BUG-YYYY-NNN` | `critical | high | medium | low` |  |  |  |  |

## KPI 측정

| KPI ID | 측정 기간/표본 | 원시값 | 계산 결과 | 기준 | 판정 |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## 회귀·보안·배포 확인

- 회귀 결과:
- Chrome 권한 변경:
- 비밀정보/개인정보 노출:
- 데이터 마이그레이션:
- ZIP/설치 smoke test:
- 롤백 확인:

## 후속 조치

| 조치 | 소유 역할 | 우선순위 | 추적 링크 |
| --- | --- | --- | --- |
|  | `planning | implementation | verification | records` |  |  |

