# 개발 단계와 완료 기준

## 1. 로컬 MVP

- MV3 확장 프로그램 빌드와 IndexedDB Capture 저장
- SWEA / Programmers Adapter 및 제출 결과 상태 테스트
- React 대시보드의 목록, 검색, 상세 코드, 연결 가이드
- GitHub OAuth 전용 서버 세션 인증, 사용자별 풀이 조회와 멱등 Bulk 저장
- 서버가 확인한 항목에만 ACK하는 연결 흐름

이 단계에서도 실제 플랫폼의 PASS 결과와 편집기 DOM은 별도 실브라우저 검증이 필요하다.

## 2. 실제 플랫폼 및 운영 준비

- SWEA와 Programmers 실제 제출로 현재 DOM selector 검증
- Chrome 확장 프로그램 로드 후 서비스 워커 재시작, 다중 탭, 부분 실패 테스트
- 운영 origin, HTTPS, 세션 쿠키 보안 설정
- PostgreSQL Flyway V1~V3와 별도 PostgreSQL 17 통합 테스트 구현 완료. 실제 운영 DB 도입은 백업과 baseline 확인 후 진행.
- GitHub OAuth App 설정과 실제 로그인 검증, 인증 시도 제한, 운영 관측 및 백업 정책

## 3. GitHub App

- 설치와 immutable 계정 ID 연결
- 사용자가 접근 가능한 설치 저장소와 브랜치 조회
- 대상 경로 검증과 미리보기, 공개 저장소 명시적 동의
- 수동 create-only 커밋
- API 결과 불확실 시 UNKNOWN 상태 및 수동 확인 흐름

## 4. 자동화

- 별도 동의를 받은 시각 이후의 신규 Capture만 처리
- PostgreSQL 기반 지속 Queue와 Attempt 상태 전이
- 단일 실행 보장, 프로세스 종료와 복구 검증
- 저장소, visibility, HEAD, 권한 변경 시 일시정지
- Dashboard 수명과 독립적인 Secure Capture Relay 설계·구현

## 5. 확장

- 추가 플랫폼 Adapter
- 실제 데이터 기반 통계와 풀이 메모
- 사용자 요청에 따른 내보내기 및 통합 기능
