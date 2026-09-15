# 자동 연결·수집 및 배포 검토 (2026-09-15)

## 기능과 검증 경계

- #228: 이전 beta 공개 manifest key로 고정 ID oohlcmihldmfninmdcmanddfmhoonmdl 복원. GitHub 로그인 후 자동 연결, 제한된 재시도와 데이터 없는 heartbeat. 사용자 연결 해제와 로그아웃을 존중합니다. 풀이 전송은 지금 동기화로 시작합니다.
- 기존 개발 ID ifchmkigiaigmdkgmmgdimpobgcahhom은 알려진 이전 설치로만 허용합니다. 고정 ID가 없으면 fallback 연결하며, 설정의 이전 개발 기록 확인으로 별도 연결할 수 있습니다. 새 ID는 별도 로컬 저장소이므로 이전 확장은 기록을 모두 옮기기 전에 삭제하지 마세요. 코드가 기존 IndexedDB를 삭제하거나 자동 이전하지 않습니다.
- #229: SWEA MAIN-world cEditor 직접 전역 바인딩과 window 속성 양쪽을 지원합니다. 실제 lexical binding을 사용하는 번들 테스트로 검증합니다. 실제 7206 문제에서 성공 팝업의 전체 문구(축하합니다. Pass입니다.제출이 완료되었습니다.)를 관찰했고 정확한 성공 문구로 추가했습니다. 수정 빌드로 17:47:01(KST) Java 재제출의 PASS → 로컬 저장 → 대시보드 서버 저장과 코드 표시를 확인했습니다. 이전 대기 기록(17:42:27)과 합쳐 2건이며, 재동기화 시 빈 대기열과 연결 유지, 전체 2건 유지를 확인했습니다.
- #230: Shiki 4.4.3, 제한된 언어와 github-light 테마, React token 출력 및 plain text fallback. 문법/엔진은 비동기 청크입니다. C++ 문법과 WASM 청크가 크므로 저사양 성능은 후속 관찰 대상입니다.
- #231: 복사/다운로드 각각 문제 메타데이터 주석 포함 설정. 기본 off, 원본 주석 유지. 알 수 없는 언어에는 임의 주석을 추가하지 않습니다.
- #232: 다운로드 파일명 템플릿 및 미리보기. 지원 변수는 {platform}, {number}, {title}, {language}. 파일명 확장자는 자동이며 경로·제어 문자와 예약 이름을 정리합니다.

## 배포 상태 (#233)

- Render의 dashboard, API, analysis 최신 배포 상태는 live, 커밋 7ce3a1f(9월13일). 모두 autoDeploy off. 신규 코드로 바꾸려면 apps/web/pnpm, Dockerfile, 삭제된 analysis 참조부터 정리해야 합니다. live는 배포 상태이며 현재 응답 성능을 보장하지 않습니다.
- Neon codearchive-beta / production / neondb에는 기존 테이블 19개와 Flyway V12가 있습니다. 신규 V1–V3를 기존 DB에 바로 적용하지 않습니다. 이 검토는 스키마 메타데이터 SELECT만 수행했습니다.
- Netlify codearchive-dashboard-beta 배포 6aa8c39dc9c8d3899435d7fd는 ready, 9월15일 CLI 배포이며 commit_ref는 비어 있습니다. redirect/functions 없음. /api/auth/providers는 HTTP 404로 확인했습니다. 현재 배포는 신규 API 로그인·동기화를 완성하지 못합니다.
- 현재 bridge는 정확히 http://localhost:5173만 허용합니다. 배포 origin과 OAuth callback/proxy/cookie를 함께 설계해야 합니다. 임의 preview 도메인을 와일드카드로 허용하지 않습니다.
- Netlify 신규 배포는 수행하지 않았습니다. UI는 기존 localhost Vite 미리보기로 확인하며, 호스팅 검증은 변경을 모아 최소 횟수로 진행합니다.

실제 HTTP 확인: Render API /actuator/health와 analysis /health는 재확인 시 200 및 UP. API 첫 요청은 25초 timeout이었으므로 최초 기동 지연을 별도 고려합니다. Netlify /api/auth/providers는 404입니다.
