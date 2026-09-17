# 검증 범위

자동 테스트와 실제 서비스 검증을 구분한다. 테스트 fixture에서 통과한 결과는 실제 SWEA/Programmers의 현재 DOM에서 검증한 결과가 아니다.

| 시나리오 | 검증 방법 |
| --- | --- |
| 명확한 Accepted만 수집 | Adapter와 제출 시도 상태 테스트 |
| 기존 성공 Dialog 무시 | 제출 전 성공 상태 fixture |
| 제출 후 편집기 변경 | 제출 시점 코드 스냅샷 확인 |
| 대시보드가 닫힌 상태 Capture | 확장 프로그램을 실제 브라우저에 로드한 수동 E2E 필요 |
| API 실패 및 부분 성공 | 실패한 Capture는 ACK되지 않는지 확인 |
| 같은 Capture 재전송 | API 중복 요청 테스트 |
| 다른 계정에서 동일 ID 사용 | 사용자별 데이터 격리 테스트 |
| 세션 없이 데이터 조회 | 인증 실패 테스트 |
| GitHub 전용 로그인 | OAuth principal 통합 테스트, 비밀번호 경로 폐기 및 설정 누락 검사 |
| GitHub 실제 로그인 | OAuth App 서버 설정 후 실제 승인·콜백 E2E 필요 |
| 동기화 중 로그아웃 | React 컴포넌트 회귀 테스트로 계정 화면 초기화 확인 |
| 로그아웃 / 계정 변경 | Dashboard Capability 폐기 및 데이터 초기화 |
| 여러 Dashboard 탭 | 문맥별 Capability와 멱등 서버 저장 |
| 확장 프로그램 재시작 | IndexedDB 보존, Capability 재연결 |
| API 재시작 | PostgreSQL 또는 dev 파일 DB 보존 |
| PostgreSQL 신규·기존 스키마 | 별도 PostgreSQL 17의 Flyway 마이그레이션과 Hibernate 매핑 검증 |
| 마이그레이션 재실행 | 버전 이력으로 이미 적용된 SQL이 다시 실행되지 않는지 검사 |
| 기존 DB 도입 | 미등록 스키마 자동 채택 거부, 명시적 baseline 후 데이터 보존 검사 |
| GitHub 저장소·HEAD 변경 / Timeout | GitHub 통합 구현 이후 검증 필요 |
| Worker 재시작 / UNKNOWN 복구 | Durable Worker 구현 이후 검증 필요 |

실제 플랫폼 제출, GitHub 쓰기, 배포는 이번 로컬 검증으로 수행하지 않는다. 구현·테스트 결과의 최종 집계는 프로젝트 README와 개발 보고서를 참고한다.
