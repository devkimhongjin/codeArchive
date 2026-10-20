# Chrome 웹스토어 배포

[CodeArchive Chrome 웹스토어 항목](https://chromewebstore.google.com/detail/codearchive/mlhibjadcbklfdllkonhjjajhmhnoalj)의 Item ID는 `mlhibjadcbklfdllkonhjjajhmhnoalj`입니다. 현재 스토어에 공개된 버전과 이 저장소의 다음 후보 버전은 구분합니다. 소스의 `1.0.0`은 `master` 검증 뒤에만 심사 제출하며, 제출 성공은 공개 완료를 뜻하지 않습니다.

새 확장 대시보드·팝업·캡처·Relay 요청은 고정 Cloud Run API `https://codearchive-api-stg-e3q54l32da-as.a.run.app`를 직접 사용합니다. `codearchive-dashboard-beta.netlify.app`은 기존 설치본의 bridge와 로그인 반환을 위한 호환 경로로만 남아 있습니다.

## 패키지 생성

```powershell
npm --prefix apps/dashboard ci
npm --prefix apps/extension ci
node --test scripts/extension-store-package.test.mjs
$env:CODEARCHIVE_SKIP_INSTALLED_EXTENSION = 'true'
npm --prefix apps/extension run build
node scripts/extension-store-package.mjs prepare
```

기본 출력은 `output/chrome-webstore`입니다. 이미 생성한 파일을 덮어쓰지 않습니다. 패키지에는 다음 파일이 생성됩니다.

| 파일 | 내용 |
| --- | --- |
| `codearchive-chrome-webstore.zip` | 루트 manifest와 컴파일된 확장·대시보드·수집 화면 |
| `codearchive-chrome-webstore.zip.sha256` | ZIP SHA256 |
| `package-report.json` | 포함 파일, 권한, 로컬 개발 ID와 검사 결과 |

스토어 ZIP은 개발용 manifest `key`를 제외합니다. 원본 manifest의 로컬 개발 ID `oohlcmihldmfninmdcmanddfmhoonmdl`과 키는 개발 빌드 호환성만 위해 보존합니다. 스토어 Item ID와 같거나 로컬 IndexedDB가 자동 이전된다고 가정하지 않습니다.

## 권한과 데이터 경계

| 권한/대상 | 사용 이유 |
| --- | --- |
| `storage` | 확장 설정, 재시도·수집 진행과 IndexedDB 풀이 기록을 보관합니다. |
| `alarms` | 관리 화면이 닫혀 있을 때 동기화 재시도를 예약합니다. |
| `scripting` | 사용자가 시작한 과거 풀이 수집에서 패키지 수집 스크립트를 적용합니다. |
| `downloads` | 사용자가 선택한 풀이를 파일로 내보냅니다. |
| SWEA·프로그래머스·정올 | 본인 제출 결과·코드·문제 정보를 확인합니다. |
| Cloud Run API | 인증된 계정 확인, 설정, 동기화, 문의와 GitHub 관리를 처리합니다. |
| legacy dashboard origin | 이전 설치본의 제한된 bridge 호환에만 사용합니다. |

Chrome이 HttpOnly 인증 쿠키를 관리하며 확장은 쿠키 값을 읽지 않습니다. GitHub OAuth/App token, 개인 키, 소스 코드와 자격 증명은 패키지나 release metadata에 넣지 않습니다. 자세한 항목은 [데이터 처리 안내](extension-privacy.md)에 있습니다.

## 수동 심사 제출 파이프라인

자동 제출과 게시 예약은 취소했습니다. `.github/workflows/chrome-webstore-release.yml`은 `master`에서 사용자가 수동 실행할 때만 처리하며, 릴리스 태그 생성으로 실행되지 않습니다. 기본값은 업로드 없는 dry run입니다. 동일 Cloud Web Store item은 하나의 고정 concurrency 그룹으로 직렬화합니다.

1. release source, 태그와 버전, dashboard/extension 테스트·빌드, ZIP 계약을 검증합니다.
2. 같은 master SHA의 성공한 `Verify` workflow를 확인합니다.
3. `CWS_WIF_PROVIDER`, `CWS_SERVICE_ACCOUNT`, `CWS_PUBLISHER_ID` repository variable이 있는지 확인합니다.
4. Google workload identity로 짧은 수명의 Chrome Web Store API token을 얻어 key-free ZIP을 업로드합니다.
5. API v2 상태가 후보 버전을 확인하면 `STAGED_PUBLISH`로 심사를 제출합니다. 심사를 통과해도 자동 공개되지 않고 `STAGED` 상태로 대기합니다.

### 단계적 게시와 백엔드 배포 순서

심사 기간에는 사용자 설치본이 이전 스토어 버전이므로, 백엔드(API·worker·shared 계약) 변경은 공개된 스토어 버전과의 호환성을 먼저 확인합니다.

1. 백엔드 변경이 이전 스토어 버전과 호환되면(필드 추가만, 기존 응답 유지) 게시 전에 배포해도 됩니다. 기존 필드 제거 같은 정리는 새 확장 공개 뒤 다음 배포로 미룹니다.
2. 호환되지 않으면 `status_only` 실행 또는 Developer Dashboard에서 후보 버전이 `STAGED`인지 확인한 뒤, Dashboard에서 게시하고 곧바로 `Deploy GCP Staging`을 실행합니다.
3. 심사 완료 후 30일 안에 게시하지 않으면 초안으로 돌아가 다시 심사를 받아야 합니다. Dashboard 계정 설정에서 게시·staged 알림 메일을 켜 두면 상태를 반복 확인하지 않아도 됩니다.

API v2 문서는 `STAGED` 항목을 API로 공개하는 호출을 명시하지 않으므로, 공개 단계는 Dashboard에서 수행합니다.

이 워크플로는 장기 키를 사용하지 않고, token이나 API 응답 본문을 로그에 출력하지 않습니다. 업로드, 심사 대기, 공개 상태를 구분하며 다른 대기 심사본을 바꾸지 않습니다. 수동 실행의 dry run은 패키지와 구성만 검증합니다. Publisher service account의 Dashboard 등록과 repository variables는 구성되어 있지만, 실제 CI token/API 호출 결과가 기록되기 전까지 연결 성공이나 게시 완료를 주장하지 않습니다.

## 출시 전 확인

- master SHA, `release.json`, manifest, dashboard와 extension package 버전이 일치한다.
- 스토어 origin의 CORS, CSRF, 계정 assertion, 로그인 및 GitHub 설치 반환을 실제 Chrome에서 확인한다.
- 새 정답 자동 동기화, 저장소 선택 뒤 자동 저장, 자동 커밋 ON/OFF, 문의 보관·복원을 확인한다.
- 최종 ZIP에 개발 key, 원격 실행 코드, 예상 밖 권한이 없는지 검사한다.
- 개인정보 URL, 데이터 사용 고지, 스크린샷과 심사 입력값을 확인한다.

## 공식 참고 자료

- [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/api/reference/rest/v2)
- [최초 게시와 ZIP 업로드](https://developer.chrome.com/docs/webstore/publish)
- [개인정보·단일 목적·권한 설명](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [웹스토어 공개 키와 개발용 확장 ID](https://developer.chrome.com/docs/extensions/reference/manifest/key)
