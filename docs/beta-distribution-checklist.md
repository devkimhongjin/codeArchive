# 지인 베타 배포·전달 점검표

운영자용입니다. 문서/로컬 ZIP 준비, 서비스 배포, 실사용 검증, Release Note 확정, 실제 전달은 서로 다른 단계입니다. 체크되지 않은 항목을 자동 테스트 결과로 대체하지 않습니다. **이 문서 작성이나 후보 ZIP 생성은 배포·초대 승인이 아닙니다.**

버전 규칙, candidate와 지인 전달본 구분, Release Note 형식과 업데이트 중요도는 [`beta-release-update-policy.md`](beta-release-update-policy.md)를 기준으로 합니다.

## 현재 기준과 남은 작업

2026-08-31의 [#31 배포 기록](https://github.com/devkimhongjin/codeArchive/issues/31#issuecomment-5469720655)은 Dashboard/API/Analysis `60537e45d76212b82afbd0abd693ec8763845581` 수동 배포, 공개 smoke와 기존 브라우저 세션 일부 확인을 보고합니다. 이는 당시 기록이지 이 문서 작성 시 재검증한 실시간 상태가 아닙니다. provider는 `fake`, auto-deploy는 꺼진 상태로 기록되었습니다.

사용자 로컬 Extension 갱신, 두 계정의 실제 Chrome 수집·전송·격리, 승인된 재시작 후 데이터 보존은 아직 별도 증거가 필요합니다. #31/#37/#84를 문서 완료만으로 닫거나 #86 정리를 앞당기지 않습니다. master 승격·실제 AI 활성화도 포함하지 않습니다.

## 1. 검증 가능한 candidate 만들기

운영자 개발 환경: PowerShell 7, Node.js 22 또는 24, 저장소에 고정된 pnpm 10.15.0과 이미 준비된 의존성. 테스터에게는 이 도구가 필요 없습니다. 새 설치가 필요한 환경은 [개발자 README](https://github.com/devkimhongjin/codeArchive/blob/develop/README.md)의 준비 절차를 먼저 따르세요.

변경을 커밋한 깨끗한 작업 트리에서 저장소 루트를 기준으로 실행합니다.

```powershell
pwsh -NoProfile -File ./scripts/package-beta.ps1
```

스크립트는 도구 버전/깨끗한 작업 트리 확인 → Extension typecheck/test/생산 빌드 → manifest·포함 파일 검사 → ZIP/해시 생성·ZIP 재검증 순서로 실행합니다. 설치/배포/업로드/브라우저 조작은 하지 않습니다. 기존 산출물이 있으면 덮어쓰지 않고 중단합니다. 동일 커밋을 재빌드해야 하면 기존 산출물은 보관하고 스크립트가 허용하는 별도 `-BuildLabel`을 사용하세요.

결과는 Git에서 제외되는 `artifacts/beta/codearchive-beta-버전-커밋[-라벨]` 아래 폴더와 같은 이름의 ZIP·`.zip.sha256`입니다.

현재 자동 생성 candidate는 다음을 포함합니다.

- `extension/`: 빌드된 확장 프로그램만 포함, 이 폴더를 Chrome에 로드
- `docs/`: 설치·사용·문제 해결·운영자 점검표·AI 검증·초대 양식
- `README.md`: 인터넷 없이도 읽는 시작 안내
- `release-info.json`: 정확한 소스 커밋, 버전, Extension ID, URL, 도구 버전, 파일별 SHA-256, `distributionStatus: candidate`

### 지인 전달용 ZIP 전환 주의

지인에게 실제 전달하는 패키지는 `docs/`를 제외하고 `extension/`, `README.md`, `release-info.json` 중심으로 단순화하는 것을 목표로 합니다. 운영 문서의 source of truth는 GitHub `docs/`입니다.

단, **현재 `package-beta.ps1`은 아직 `docs/` 포함 candidate를 기준으로 검증합니다.** 생성 후 `docs/`를 수동 삭제하면 기존 ZIP SHA-256과 `release-info.json.sha256`의 per-file 목록이 더 이상 원본 candidate와 일치하지 않습니다.

- [ ] `docs/`를 제거한 지인 전달본이면 원래 candidate와 구분해 기록
- [ ] 수정된 ZIP의 SHA-256을 새로 계산해 전달
- [ ] `release-info.json`의 per-file manifest까지 일치한다고 주장하지 않음
- [ ] 패키징 자동화가 바뀌기 전에는 `distributionStatus: candidate`를 사람이 임의로 `approved-beta`로 수정하지 않음

`candidate`는 실사용 배포 승인이 아닙니다. 소스 코드 ZIP/서비스 비밀정보/Chrome 프로필/수집 기록은 넣지 않습니다. manifest의 `key`는 ID를 고정하는 **공개 키**이며 OAuth 비밀 키가 아닙니다. 파일 목록 검사는 임의 바이너리의 비밀정보 탐지나 코드 보안 감사를 대신하지 않습니다.

- [ ] 기능 PR이 develop에 반영되고 검토된 정확한 develop SHA 기록 (기능 브랜치 ZIP은 검증 후보 전용)
- [ ] 해당 SHA의 Extension typecheck/test/build, 문서/패키지 검사 통과
- [ ] 해당 SHA의 Dashboard CI typecheck/test/build 증거 기록
- [ ] 필요한 API CI/통합 테스트 증거 기록
- [ ] ZIP 무결성, manifest ID `oohlcmihldmfninmdcmanddfmhoonmdl`, exact Dashboard origin 확인
- [ ] 압축 해제 후 안내 링크와 Chrome 설치/기존 설치 업데이트 확인
- [ ] Main API의 `CODEARCHIVE_BETA_ACCESS_PASSWORD` 비밀 설정(8~128자)과 API/Web 반영 확인; 실제 값은 공개 자료에 없음
- [ ] 첫 입장 성공/오입력/서버 오류, 같은 탭 새로고침·OAuth 복귀, 새 탭 입장 확인 ([간단 입장 설계와 우회 한계](beta-access-design.md))

## 2. 실제 브라우저·서버 검증 — 수행 후만 체크

각 행에 시각, 패키지 SHA-256, 배포된 서비스 SHA, PASS/FAIL, 민감정보 없는 증거를 남깁니다. 사용자의 OAuth 승인, 코드 전송, 서비스 재시작/배포에는 **실행 직전 별도 승인**을 받습니다. 본인 소유 합성/폐기 가능 데이터와 두 개의 승인된 테스트 계정만 사용합니다.

| 확인 항목 | 완료/증거 |
| --- | --- |
| 정확한 provider 작업공간/서비스, auto-deploy OFF, 유료 자원 추가 없음 | 미검증: |
| 승인된 exact develop 커밋과 실제 Dashboard/API/Analysis SHA 일치; CORS/health/비인증 차단 | 미검증: |
| 기존 설치 갱신 시 동일 프로필·ID·로컬 기록 보존 | 미검증: |
| Dashboard 닫힘/오프라인 상태의 SWEA 정답 로컬 저장 | 미검증: |
| exact HTTPS origin 연결, 로그인·동의 전 코드 전송 없음 | 미검증: |
| 새 로그인·계정 표시 확인, 명시적 동의 후 새 수집 자동 전송 | 미검증: |
| 연결 종료 중 누적 → 재연결 pending drain, 반복 시 중복 없음 | 미검증: |
| 부분 실패에서 성공/중복만 ACK, 실패 재시도, 로컬 원본 보존 | 미검증: |
| 로그아웃·계정 전환 시 이전 세션 전송 중단, 새 계정 동의 필요 | 미검증: |
| 두 계정의 풀이/AI 목록·상세·수정·삭제 교차 접근 차단 | 미검증: |
| 풀이별 복사/Source/Markdown, 서버 수정·삭제 확인/취소와 로컬 보존 | 미검증: |
| AI 3종 동의/취소·결과·오류/한도·원본 보존 ([세부 항목](dashboard-ai-beta-acceptance.md)) | 미검증: |
| 데스크톱·모바일 크기에서 주요 Dashboard 화면 overflow/가독성/조작 확인 | 미검증: |
| 별도 승인된 재시작/재배포 뒤 PostgreSQL 풀이·AI 결과 유지 | 미검증: |
| 로그/화면에 코드·토큰·쿠키 등 민감정보 노출 없음 | 미검증: |

- [ ] 위 replacement E2E 통과 후에만 #86 legacy 인증/API/AI·권한 제거 진행
- [ ] 정리된 후속 패키지에서 Extension token/Main API 요청 부재, 로컬 보존 재검증
- [ ] 중단/복구 담당자와 이전 검증 커밋·패키지 확보 (배포 rollback 별도 승인; Chrome 저장소 임의 다운그레이드 금지)

## 3. Release Note와 업데이트 등급 확정

지인에게 ZIP만 보내지 않습니다. [`beta-release-update-policy.md`](beta-release-update-policy.md)의 형식으로 사람이 읽는 Release Note를 함께 준비합니다.

- [ ] 버전 `0.MINOR.PATCH` 확정
- [ ] 업데이트 중요도 `필수 / 권장 / 선택` 중 하나 선택
- [ ] 주요 변경, 보안·개인정보 영향, 알려진 문제, 후속 Issue 기록
- [ ] 기존 사용자는 Extension 제거 금지 및 Source/Markdown 사전 백업 안내
- [ ] Dashboard 초대 비밀번호는 Release Note/ZIP/GitHub에 넣지 않고 별도 전달
- [ ] RC/candidate와 실제 지인 전달본 파일명을 혼동하지 않음

## 4. 전달 기록

```text
버전 / 업데이트 중요도:
패키지 파일명 / ZIP SHA-256:
원본 candidate 또는 수동 파생 지인 전달본 여부:
소스 full SHA / develop 포함 여부:
Extension ID:
Dashboard / API / Analysis 실제 배포 SHA:
검증 일시 / 담당자 / E2E 증거 링크:
실제 브라우저 desktop/mobile 검증 근거:
현재 AI provider / 알려진 문제 / 후속 Issue:
사용 승인 일시 / 승인자:
테스트 기간 / 문의 창구:
전달 대상 범위 / 전달 경로 / 전달 일시:
중단·복구 담당자 / 검증된 이전 버전:
```

- [ ] 실제 다운로드 권한을 확인한 ZIP/새 SHA-256/Release Note 준비 (공개 업로드를 기본값으로 삼지 않음)
- [ ] [초대 메시지](beta-invite-template.md)의 모든 빈칸을 실제 값으로 채움
- [ ] AI `fake`, 전체 pending 전송, 중요한 코드 별도 보관, 알려진 제한 안내
- [ ] 약 20명에게 실제 전달하기 직전 승인 확인 후 운영자가 전달

검증 실패/계정 간 노출/의도하지 않은 전송이 발생하면 추가 초대를 멈추고 동기화를 끕니다. 로컬 기록을 지우지 말고 비공개 제보를 받고 원인을 확인합니다. 서버 삭제·계정 접근·배포 변경을 자동 조치하지 않습니다.
