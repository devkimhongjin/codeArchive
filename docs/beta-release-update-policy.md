# 지인 베타 릴리스·업데이트 정책

이 문서는 CodeArchive를 소수의 지인에게 ZIP으로 전달하는 동안 사용할 릴리스·업데이트 운영 규칙입니다. Chrome Web Store 배포, provider 배포, `develop -> master`, Production 승인을 의미하지 않습니다.

## 1. 배포 채널

현재 지인 베타의 기본 배포 채널은 **운영자가 직접 전달하는 ZIP**입니다.

지인에게 전달하는 한 릴리스는 다음 세 가지를 한 세트로 봅니다.

- `codearchive-beta-<version>.zip`
- 해당 ZIP의 SHA-256 확인값
- 사람이 읽는 Release Note / 업데이트 안내 메시지

Dashboard 초대 비밀번호 등 비밀 값은 ZIP·Release Note·GitHub 공개 문서에 넣지 않고 별도 비공개 연락으로 전달합니다.

Chrome Web Store Private/Unlisted 전환은 사용자가 늘거나 수동 업데이트 비용이 커질 때 별도 작업으로 검토합니다. 현재 정책만으로 Web Store 게시를 승인하지 않습니다.

## 2. 후보 패키지와 실제 지인 전달본

### 자동 생성 candidate

현재 `scripts/package-beta.ps1`은 검증용 candidate를 만들며 다음을 포함합니다.

- `extension/`
- `docs/`
- `README.md`
- `release-info.json`
- 별도 `.zip.sha256`

`release-info.json.distributionStatus`는 현재 자동화상 `candidate`입니다. candidate 생성은 지인 전달 승인이 아닙니다.

### 지인 전달용 목표 형태

지인에게 실제로 건네는 ZIP은 운영 문서를 최소화한 아래 형태를 목표로 합니다.

```text
codearchive-beta-<version>/
├─ extension/
├─ README.md
└─ release-info.json
```

설치·업데이트·문제 해결·운영자 체크리스트의 원본은 GitHub `docs/`를 source of truth로 유지하고, 지인에게는 Release Note 메시지와 필요한 온라인 문서 링크를 함께 전달합니다.

### 현재 전환 주의사항

현재 패키징 자동화는 아직 `docs/` 포함 candidate를 기준으로 ZIP 내부 파일 해시를 `release-info.json`에 기록합니다. 따라서 candidate ZIP을 만든 뒤 `docs/`를 수동 삭제하면:

- 원래 ZIP SHA-256은 더 이상 유효하지 않고,
- `release-info.json.sha256`에는 제거된 `docs/` 항목이 남으며,
- 그 수정본을 `package-beta.ps1`이 검증한 원본 candidate와 동일하다고 표현하면 안 됩니다.

패키징 자동화를 별도 변경하기 전까지 `docs/`를 제거한 파일은 **수동으로 파생한 지인 전달본**으로 기록하고 새 ZIP SHA-256을 계산합니다. `release-info.json`의 per-file manifest까지 일치한다고 주장하지 않습니다. 자동화 변경은 별도 작업으로 취급하며 이 문서 변경만으로 수행하지 않습니다.

## 3. 버전 규칙

1.0 이전 지인 베타에서는 `0.MINOR.PATCH`를 사용합니다.

- `0.1.0` → 최초 베타 단위
- `0.2.0` → 커뮤니티처럼 사용자에게 보이는 큰 기능 묶음
- `0.2.1` → `0.2.0`의 버그·호환성·보안 수정
- `0.3.0` → 다음 큰 기능 묶음
- `1.0.0` → 일반 사용자에게 안정적으로 제공할 준비가 됐다고 별도 승인한 시점

RC가 필요하면 파일명/운영 기록에 `-rc1`, `-rc2` 같은 BuildLabel을 붙이고, Chrome manifest 버전은 Chrome 규칙에 맞는 숫자 버전을 유지합니다.

## 4. 업데이트 중요도

Release Note에는 아래 중 하나를 명시합니다.

### 필수 업데이트

보안 문제, 서버/API 호환성 중단, 데이터 손상 위험 등 구버전을 계속 쓰면 문제가 되는 경우입니다.

### 권장 업데이트

버그 수정, 안정성·UX 개선처럼 구버전도 동작하지만 최신 사용을 권장하는 경우입니다.

### 선택 업데이트

새 기능 추가 위주이며 기존 기능만 쓰는 사람은 당장 갱신하지 않아도 되는 경우입니다.

## 5. Release Note 형식

지인용 Release Note는 commit 목록이 아니라 사용자가 알아야 할 변화 중심으로 작성합니다.

```text
CodeArchive Beta <version>
<release date>

업데이트 중요도: 필수 / 권장 / 선택

[주요 변경]
- 사용자가 바로 체감하는 새 기능과 개선

[보안·개인정보]
- 공개 범위, 인증, 데이터 처리에 영향을 주는 변경

[알려진 문제]
- 재현 중이거나 후속 이슈로 분리된 문제

[업데이트 방법]
- 기존 Extension 제거 금지
- 중요 풀이 Source/Markdown 백업
- 새 extension 파일 덮어쓰기
- chrome://extensions에서 기존 CodeArchive 새로고침
- 로컬 기록/ID 확인 후 자동 동기화 재활성화

[문의]
- 운영자가 지정한 비공개 연락 채널
```

기술적인 상세 변경은 GitHub PR/CHANGELOG에 남기고 지인용 Release Note에는 필요한 경우에만 요약합니다.

## 6. 기존 사용자 업데이트 원칙

업데이트 시 가장 중요한 불변식은 다음입니다.

- **Extension을 Chrome에서 제거하지 않습니다.**
- 같은 Chrome 프로필과 같은 Extension ID를 유지합니다.
- 브라우저 저장소·IndexedDB를 초기화하지 않습니다.
- 중요한 풀이는 업데이트 전에 Source/Markdown으로 사람이 확인할 수 있는 사본을 만듭니다.
- 자동 동기화를 끈 상태에서 파일을 갱신하고, 새 버전의 로컬 기록·로그인 계정을 확인한 뒤 다시 켭니다.

구체적인 절차는 [`beta-install.md`](beta-install.md)를 따릅니다.

## 7. 릴리스 흐름

```text
develop 기능 완료
→ PR/CI/필요한 실제 브라우저 검증
→ RC/candidate 생성
→ 운영자 최종 확인
→ 버전과 Release Note 확정
→ 지인 전달 ZIP + SHA-256 준비
→ 직접 전달
→ 피드백을 GitHub Issue로 분리
→ PATCH hotfix 또는 다음 MINOR 기능 릴리스
```

다음 단계로 넘어갈 때 앞 단계의 PASS를 추정해서 기록하지 않습니다. 특히 자동 테스트 성공은 실제 브라우저 acceptance, provider 배포, 지인 전달 승인을 대신하지 않습니다.

## 8. 릴리스 기록에 남길 최소 정보

```text
버전:
업데이트 중요도:
소스 exact SHA:
배포 ZIP 파일명:
배포 ZIP SHA-256:
candidate/수동 파생본 여부:
API/Web/Extension 검증 근거:
실제 브라우저 검증 근거:
알려진 문제와 후속 Issue:
지인 전달 승인 일시:
전달 범위/채널:
이전 복구 가능 버전:
```

`distributionStatus: approved-beta` 같은 자동 메타데이터 상태 도입은 향후 패키징 자동화 변경으로 별도 구현합니다. 현재 `release-info.json`의 `candidate` 값을 사람이 임의로 바꾸지 않습니다.
