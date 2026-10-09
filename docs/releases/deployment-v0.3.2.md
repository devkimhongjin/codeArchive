# v0.3.2 배포 준비 및 승인 체크리스트

관련 #417, 기능 #415/#416. 사용자 요청으로 출시 우선 master 승격과 자료 준비를 진행합니다. 실제 Chrome 수용은 미완료이며 실제 게시·배포 완료와 구분합니다. 정확한 master SHA, PR, CI, ZIP 해시는 생성 자료와 이슈 인계에 기록합니다.

## 준비된 계약

클라이언트 버전은 release.json, Extension manifest/package/lock, Dashboard package/lock의 0.3.2로 맞춥니다. API의 Maven/Java 기준, 캡처·브라우저 권한·인증 origin은 변경하지 않습니다. 같은 저장소 develop → master PR만 승격하며 Master Release Source / require-develop 검사를 필수로 둡니다.

ZIP은 정확한 master checkout의 release build에서 생성하고 SHA256·package-report 및 출처 기록을 함께 보관합니다. 원본/이전 ZIP과 기존 설치 폴더를 덮어쓰지 않습니다. 개발용 localhost·불필요한 api.github.com 권한·소스맵은 제출 ZIP에서 제거됩니다. JAR 준비는 컨테이너 이미지 배포 검증을 대체하지 않습니다.

## 환경 확인 — 배포 실행 금지 상태

현재 netlify.toml의 공개 origin은 `codearchive-dashboard-beta.netlify.app`, API proxy는 `codearchive-api-stg` Cloud Run을 가리킵니다. 현재 staging-db-policy는 API/worker와 데이터베이스를 **nonproduction**으로 등록하고, 별도 production DB를 보호합니다. Spring `prod` profile이나 서비스 이름만으로 production 자원이 증명되지 않습니다. 이전 README의 in-place production 설명은 이 현재 정책과 다르므로 승인 없이 전환 근거로 사용하지 않습니다.

기존 Deploy GCP Staging workflow와 OIDC는 develop 전용입니다. master를 그 workflow로 보내거나 guard/정책/서비스 역할을 우회하지 않습니다. 현재 정책 만료는 2026-10-13T00:14:55Z이며 적용 시점에 유효한 inventory를 재검증해야 합니다.

Production을 별도로 만들지 기존 자원을 명시적으로 전환할지는 비용·DB·권한 결정입니다. master 병합은 그 결정이나 production provisioning/deploy 승인이 아닙니다. 현재 Netlify 자동 빌드 중지는 유지하며 서버·웹·스토어 작업은 이 준비 단계에서 실행하지 않습니다.

## 승인 후 적용 순서

1. 대상 환경/서비스/DB/schema와 비용, backup/recovery 접근, 기존 serving revision/digest를 확정합니다. Production 배포는 정확한 master SHA와 대상에 대한 **새 승인**이 필요합니다. nonproduction은 검증된 develop SHA와 별도 beta 승인으로만 배포합니다.
2. 문의 자동 삭제 중단이 반영될 API/V29를 먼저 적용합니다. API와 worker가 같은 entity/model을 쓰므로 동일한 검증 이미지로 맞춥니다. V29는 기존 문의/메시지를 삭제하지 않는 CHECK 확장입니다. 기존 데이터와 Flyway V29/checksum, health/버전, 인증·CSRF·계정·admin 접근을 확인합니다. 문의 내용/코드/secret를 로그나 인계에 넣지 않습니다.
3. 웹 배포가 필요한 경우 해당 환경 승인 후 같은 소스의 Dashboard를 수동 배포합니다. API proxy와 callback origin은 기존 값 검토부터 시작하며 무단 변경하지 않습니다. 확장 UI도 번들에 포함됩니다.
4. ZIP 해시·최종 manifest를 확인하고 기존 확장 데이터를 보존해 테스트 로드합니다. 실제 로그인 후 원래 탭/창 복귀, 일반 사용자 접수·읽기만, 관리자 즉시 목록·3상태·단일 답변, 종료/삭제/자동 정리 없음과 메뉴 마지막을 확인합니다.
5. 실제 스토어 ID/공개 키와 API CORS·CSRF·extension origin 허용을 확정합니다. 다른 ID에서 로컬 기록이 자동 이전된다고 가정하지 않습니다. 신규/과거 캡처·계정 변경·중복 전송·worker/Chrome 재시작을 확인합니다.
6. 최종 개인정보 URL·데이터 사용 고지·권한 설명·이미지·심사 지침을 입력합니다. **웹스토어 upload 및 review/publish 승인**을 받은 뒤 제출하며, API 준비 전 새 문의 기능이 실제 적용됐다고 홍보하지 않습니다.

## 롤백

배포 전 API/worker의 검증된 revision/digest와 웹 deploy ID를 보관합니다. 실패 시 승인된 환경에서 이전 ready revision으로 트래픽을 되돌리고 health와 계정/데이터 경계를 확인합니다. ZIP/버전은 다른 빌드로 덮어쓰지 않고 후속 패치 버전으로 교정합니다.

V29 적용 후 IN_REVIEW 행이 생기면 구 API의 enum이 이를 읽지 못할 수 있습니다. 또한 이전 API는 문의 접근 시 90일 자동 삭제 경로가 있으므로 그대로 되돌리면 보존 정책을 위반할 수 있습니다. 스키마/문의 데이터를 임의 되돌리거나 삭제하지 말고, 문제가 있는 화면을 차단하고 삭제 제거·IN_REVIEW 호환을 갖춘 수정 이미지를 준비합니다. DB 복원은 별도 승인된 recovery 계획에서만 수행합니다.

## 현재 미완료 항목

- 실제 Chrome/실제 스토어 ID 수용, 최신 UI 실제 화면 캡처.
- 승인된 production 자원·DB·배포 경로·백업/롤백 확정.
- 실제 API/V29·웹 배포, 스토어 업로드·심사·게시.

CI·단위 테스트와 패키지 검사 성공은 위 항목의 완료 증거가 아닙니다.
