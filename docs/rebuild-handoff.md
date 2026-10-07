# 신규 구축 전환 기록

사용자 승인에 따라 기존 develop의 구현을 현재 신규 프로젝트 전체로 교체합니다. 이전 코드는 Git 이력에 남으며 master는 변경하지 않습니다.

## 현재 구현

- apps/dashboard: React/Vite 대시보드, GitHub 전용 로그인, 명시적 풀이 동기화
- apps/extension: Chrome MV3 수집기와 한국어 팝업, 대기 수·오류·재시도·연결 ID 복사
- apps/api: Spring Boot/Maven, 사용자별 풀이 저장, OAuth 세션, Flyway
- GitHub Actions: 두 클라이언트 테스트/빌드와 PostgreSQL 포함 API 검증

기존 pnpm/Gradle/analysis 배포 구성을 그대로 실행할 수 없습니다. 기존 Render Blueprint는 자동 배포가 꺼진 구성이었습니다. 이번 전환은 소스 병합이며 호스팅 설정 변경이나 배포를 수행하지 않습니다.

## 데이터 및 비밀값

로컬 OAuth 설정, H2 데이터, 환경 파일, 의존성, 빌드 결과는 커밋하지 않습니다. 새 Flyway V1–V3는 새 프로젝트 스키마용입니다. 이전 배포 DB의 마이그레이션 이력에 그대로 적용하거나 이력을 초기화하면 안 됩니다. 운영 이전은 백업·스키마 비교·데이터 변환 계획을 별도로 검증해야 합니다.

## 다음 검증

1. 확장 프로그램을 다시 로드하고 SWEA 문제 페이지를 새로 열어 실제 제출 → PASS → 로컬 대기 증가를 확인합니다.
2. 로그인 → 브리지 연결 → 지금 동기화 후 연결 유지, 서버 저장, 중복 방지와 계정 격리를 확인합니다.
3. 실브라우저 수집 검증 완료 후 배포 주소, 정확한 bridge origin, OAuth callback과 기존 DB 이전을 설계합니다.

SWEA의 실제 제출 버튼 `#btnf_proposal`과 언어 메뉴 `#sel_lang`은 관찰한 DOM을 반영했습니다. 테스트 픽스처 통과와 실제 제출 수집 성공은 구분합니다. Programmers 실사이트 수집도 별도 검증이 필요합니다.
