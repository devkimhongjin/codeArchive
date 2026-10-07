# 커뮤니티 기본 공개 및 내 기존 풀이 공개 — #364 / #365

- 신규 정답 풀이(라이브/과거 동기화)는 계정 기본값 공개/비공개를 따른다. 기본값은 공개.
- V21은 설정 열만 추가한다. 기존 문제 공개 상태/설정 버전/기존 프로필/동기화/GitHub 동의는 유지한다.
- 생략/null 공개 기본값은 기존 계정 설정을 보존한다. 중복 captureId/과거 제출 재동기화도 개별 비공개 상태를 보존한다.
- 대시보드 설정에서 기본값 저장 및 기존 정답 풀이 모두 공개를 각각 실행한다. 후자는 확인 안내 후 계정 assertion/CSRF/공개 요청/쓰기 quota를 거쳐 단일 계정만 갱신한다.
- publishedAt이 이미 있는 제출은 시각을 유지하며 비정답과 다른 계정은 제외한다. 결과는 문제·제출·새로 공개 수를 구분한다.
- 커뮤니티 같은 플랫폼/문제 공개 풀이 열람 자격 검사는 유지한다.

## 실제 실행 검증

- 대시보드 23파일/176테스트 통과. 공개/비공개 선택, 명시적 저장, 확인 전 쓰기 없음, 계정 전환 응답 무시, 인증 오류 검증.
- API 172개 중166개 실행 통과, PostgreSQL 환경 의존6개 skip. 신규/과거 공개 기본값, 비공개 선택·생략 보존, 재동기화 공개 취소 보존, bulk 계정/정답/CSRF/인증/명시적 공개/중복/시각/문제와 제출 개수 검증.
- V20→V21의 기존 비공개/프로필/버전 보존 PostgreSQL 테스트 추가. 로컬 Docker 엔진이 없어 미실행; CI 필수.
- API 및 대시보드 build 통과. 기존 Shiki 청크 크기 경고 유지.
- Chrome localhost 실제 App/실제 API client/합성 서버에서 비공개 저장→새로고침 보존→공개 저장→일괄 공개 문제3/제출3/새3→새로고침 후 반복 새0 확인. 실제 계정 변경과 구분한다.

## 실제 적용 경계

- 현재 실제 대시보드 로그인 표시 @devkimhongjin 확인. 공개 GitHub identity devkimhongjin/301944193 대조.
- 정상 CI 및 독립 검토/병합 후 기존 GCP staging 서비스에 additive migration 배포. 새로 동기화한 정답의 공개 기본값 변경을 포함한다.
- Netlify 배포 제한이 지속될 경우 기존 계정 공개는 검증된 staging DB의 owner 조건 작업으로 적용할 수 있다. 준비한 output/CommunityPublishOwner.java / community-publish-owner.ps1은 시행 전 binding preflight, 정확한 github_id+login 단일 계정, 현재 설정 공개=true, SERIALIZABLE transaction, ACCEPTED/private predicate 및 changed count를 확인한다. 다른 계정/코드/설정/기존 시각을 바꾸지 않는다. 접속값은 기존 immutable Secret Manager refs에서 프로세스 메모리로만 전달하고 제거하며 출력하지 않는다. 이 작업은 아직 미실행이다.
- Netlify 배포/최종 실제 공개 검증 전 #364/#365는 열어 둔다. #318의 과거 전체 사용자 backfill/토글 제거안은 이번 요구사항으로 대체한다.
