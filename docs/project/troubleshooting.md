# 트러블슈팅 기록

반복 가능한 장애 해결 지식을 남긴다. 토큰, API Key, 개인정보, 실제 풀이 코드는 기록하지 않는다.

## 기록 원칙

- 증상, 환경, 재현 절차, 원인, 해결, 검증을 분리한다.
- 추정 원인은 “가설”로 표시하고 확인된 원인과 섞지 않는다.
- 로그는 필요한 최소 부분만 남기고 비밀정보를 마스킹한다.
- 임시 우회는 만료 조건과 후속 작업을 반드시 기록한다.
- 제품 동작이나 아키텍처 선택이 바뀌면 ADR도 연결한다.
- 해결되지 않은 문제를 해결됨으로 표시하지 않는다.

## 색인

| ID            | 날짜       | 증상                                                        | 영역          | 상태        | 관련 작업/ADR |
| ------------- | ---------- | ----------------------------------------------------------- | ------------- | ----------- | ------------- |
| `TS-YYYY-NNN` |            |                                                             |               | `open       | mitigated     | resolved` |     |
| `TS-2026-001` | 2026-07-26 | 작업 이력이 서로 다른 로컬 저장소에 분리됨                  | 개발 환경/Git | `resolved`  | TASK-0001     |
| `TS-2026-002` | 2026-07-26 | Windows checkout 파일이 Prettier LF 검사에서 실패할 수 있음 | Git/포맷      | `resolved`  | TASK-0001     |
| `TS-2026-003` | 2026-07-27 | constructor parameter property에서 TS1294 발생              | TypeScript    | `resolved`  | TASK-0003     |
| `TS-2026-004` | 2026-07-27 | Codex 환경에서 `npx`·Husky hook 실행 경로를 찾지 못함       | 개발 환경     | `mitigated` | 프로토타입    |

## 템플릿

### TS-YYYY-NNN: 제목

- 발견일:
- 해결일:
- 상태:
- 영향:
- 관련 작업/커밋:
- 환경:

#### 증상

사용자가 관찰한 결과와 정확한 오류 메시지를 기록한다.

#### 재현 절차

1.

#### 기대 결과

-

#### 실제 결과

-

#### 조사와 가설

| 가설 | 확인 방법 | 결과 |
| ---- | --------- | ---- |
|      |           |      |

#### 확인된 원인

-

#### 해결 또는 완화

- 변경 내용:
- 임시 우회:
- 후속 작업:

#### 검증

- 명령/시나리오:
- 결과:
- 관련 검증 보고서:

#### 예방

- 추가한 테스트/알림:
- 문서/ADR 변경:

## 알려진 초기 위험

### 검증이 테스트 없이 통과할 수 있음

- 증상: 테스트 파일이 없어도 `npm test`와 CI가 성공할 수 있다.
- 원인: 현재 테스트 명령의 `--passWithNoTests`.
- 현재 상태: TASK-0001 최종 재검증에서는 13개 데이터 계약 테스트가 실제 실행되어 해당
  작업의 false-green은 해소됐다. 옵션 자체는 남아 있어 다른 테스트 영역의 구조적 위험은
  계속된다.
- 판정: 테스트 수가 0이면 false-green이며 검증 보고서의 `PASS`가 될 수 없다.
- 예방 방향: 실제 테스트를 추가하고 해당 옵션을 제거하며 CI에서 수집된 테스트 수를 기록한다.

### 과거 `dist`로 빌드 성공을 오인할 수 있음

- 증상: `dist`가 존재하지만 현재 소스의 빌드 여부는 알 수 없다.
- 예방 방향: 같은 커밋에서 clean install/build를 수행하고 새 아티팩트와 SHA를 검증한다.

### package와 manifest 버전이 다를 수 있음

- 증상: 릴리스/확장 버전이 서로 다른 값을 가진다.
- 예방 방향: artifact 검사에서 버전 일치를 강제하고 단일 버전 갱신 절차를 둔다.

## 해결 기록

### TS-2026-001: 기준 저장소가 아닌 별도 경로에서 작업해 이력이 분리됨

- 발견일: 2026-07-26
- 해결일: 2026-07-26
- 상태: `resolved`
- 영향: 사용자가 지정한 저장소와 별도 writable 경로의 저장소가 서로 다른 HEAD와 working
  tree를 가지게 되어 커밋·푸시 여부를 잘못 판단했고, 후속 작업의 기준 경로가 불명확해졌다.
- 관련 작업/커밋: TASK-0001, GitHub Issue #1
- 환경: Windows, Git, Codex workspace sandbox

#### 증상

사용자가 작업하던 `C:\workspace\personalPJT\codeArchive`가 아니라
`C:\Users\ghdwl\Documents\CodeArchive`를 작업 기준으로 사용했다. 따라서 한 경로에서
작성하거나 스테이징한 변경이 다른 경로의 `git status`, HEAD, upstream에 나타나지 않았다.

#### 재현 절차

1. 사용자가 지정한 기존 저장소 외의 경로에 소스를 복사하거나 새 Git 저장소를 만든다.
2. 별도 경로에서 파일을 변경하고 스테이징한다.
3. 기존 저장소에서 HEAD와 working tree를 확인한다.
4. 두 저장소의 HEAD, 브랜치, 원격, working tree가 독립적으로 관리되는 것을 확인한다.

#### 기대 결과

- 모든 변경과 Git 명령이 사용자가 지정한 기존 저장소에서 수행된다.

#### 실제 결과

- 별도 writable 경로가 작업 기준으로 사용되어 변경 이력과 Git 상태가 두 저장소로 분리됐다.

#### 조사와 가설

| 가설                                           | 확인 방법                                        | 결과                                                |
| ---------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| 두 경로가 같은 Git 저장소를 가리킨다           | 각 경로에서 `git rev-parse --show-toplevel` 실행 | 서로 다른 top-level로 확인                          |
| 원격이 다르기 때문에 푸시 결과가 보이지 않는다 | 각 경로에서 `git remote -v` 실행                 | 원격 URL만으로 동일 working tree임을 보장할 수 없음 |
| 브랜치나 커밋 상태가 다르다                    | 각 경로에서 branch, HEAD, upstream, status 비교  | 저장소별 상태가 독립적임을 확인                     |

#### 확인된 원인

- 샌드박스에서 쓰기 가능한 경로를 우선해, 사용자가 지정한 기존 Git 저장소의 top-level을
  변경 전에 확인하지 않고 별도 경로를 작업 기준으로 삼았다.
- 동일한 원격 URL을 사용하는지 여부만으로 로컬 저장소의 동일성을 판단했다.

#### 해결 또는 완화

- 변경 내용:
  - 기준 저장소를 `C:\workspace\personalPJT\codeArchive`로 다시 확정했다.
  - 해당 경로에서 branch, HEAD, origin, upstream 및 working tree를 다시 확인했다.
  - 복구된 TASK-0001 산출물에 대해 `npm ci`와 `npm run validate`를 다시 실행해 PASS를
    확인했다.
- 안전한 복구 절차:
  1. 두 경로 모두에서 새 변경을 중단한다.
  2. 각 경로에서 `git rev-parse --show-toplevel`, `git branch --show-current`,
     `git rev-parse HEAD`, `git remote -v`, `git status --short --branch`를 수집한다.
  3. 사용자가 지정한 기존 저장소를 canonical 저장소로 확정한다.
  4. 별도 저장소의 diff와 untracked 파일을 읽기 전용으로 검토하고, canonical 저장소에
     없는 변경만 파일 단위로 선별한다.
  5. 덮어쓰기 전에 canonical 저장소의 기존 변경과 충돌 여부를 확인한다.
  6. canonical 저장소에서 전체 검증을 다시 수행한다.
  7. 커밋과 푸시는 사용자가 요청한 주체와 절차에 따라 canonical 저장소에서만 수행한다.
- 임시 우회: 없음.
- 후속 작업: 각 작업 시작과 모든 파일 변경·Git 명령 전에 canonical top-level을 확인한다.

#### 검증

- 명령/시나리오:
  - `git -c safe.directory=C:/workspace/personalPJT/codeArchive rev-parse --show-toplevel`
  - `git -c safe.directory=C:/workspace/personalPJT/codeArchive branch --show-current`
  - `git -c safe.directory=C:/workspace/personalPJT/codeArchive remote -v`
  - `npm ci`
  - `npm run validate`
- 결과:
  - top-level: `C:/workspace/personalPJT/codeArchive`
  - branch: `codex/task-0001-core-data-contract`
  - origin: `https://github.com/devkimhongjin/codeArchive.git`
  - 전체 품질 게이트 PASS, Vitest 13개 테스트 PASS
- 관련 검증 보고서: `docs/verification/2026-07-26-TASK-0001-recovery.md`

#### 예방

- 추가한 테스트/알림: 기능 테스트가 아닌 작업 전 경로 검증 절차를 운영 게이트로 추가했다.
- 문서/ADR 변경: `AGENTS.md`의 “작업 저장소 경로 불변 규칙”을 적용한다.
- 권한 또는 샌드박스 제약으로 canonical 저장소에 쓸 수 없으면 다른 경로로 복사하지 않고
  승인을 요청한 뒤 작업을 중단한다.

### TS-2026-002: Windows 줄바꿈과 Prettier LF 정책 불일치

- 발견일: 2026-07-26
- 해결일: 2026-07-26
- 상태: `resolved`
- 영향: 내용 변경이 없는 파일도 working tree에서 줄바꿈 변경으로 표시되거나 Prettier
  format check가 실패할 수 있었다.
- 관련 작업/커밋: TASK-0001
- 환경: Windows, Git `core.autocrlf`, Prettier `endOfLine: lf`

#### 증상

Windows checkout에서 일부 파일이 실제 내용 변경 없이 수정된 것으로 표시될 수 있었고,
Prettier가 기대하는 LF와 working tree의 CRLF가 다르면 format check가 실패할 수 있었다.

#### 재현 절차

1. `core.autocrlf`가 CRLF checkout을 허용하는 Windows 환경에서 저장소를 checkout한다.
2. Prettier의 줄바꿈 정책이 LF인 파일을 검사한다.
3. `git diff --ignore-space-at-eol` 및 일반 `git diff`와 `npm run format:check` 결과를
   비교한다.

#### 기대 결과

- 운영체제와 관계없이 텍스트 파일은 저장소 정책에 따라 LF로 정규화되고 Prettier 검사가
  동일하게 통과한다.

#### 실제 결과

- Git checkout 정책과 Prettier 정책이 일치하지 않으면 CRLF/LF만 다른 diff 또는 format
  check 실패가 발생할 수 있었다.

#### 조사와 가설

| 가설                                  | 확인 방법                                             | 결과                                             |
| ------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| 파일 내용이 실제로 변경됐다           | 일반 diff와 줄끝 공백 무시 diff 비교                  | 줄바꿈만 다른 파일을 구분할 수 있음              |
| Git과 Prettier의 줄바꿈 정책이 다르다 | `git config --get core.autocrlf`와 Prettier 설정 확인 | Windows checkout과 LF 검사 간 불일치 가능성 확인 |
| 저장소에 줄바꿈 정책이 없다           | `.gitattributes` 확인                                 | `* text=auto eol=lf` 규칙을 추가해 정책을 명시함 |

#### 확인된 원인

- Windows의 `core.autocrlf` 동작과 Prettier의 LF 기대값이 저장소 수준에서 명시적으로
  정렬되지 않으면 working tree 표현과 format check 기준이 달라질 수 있다.

#### 해결 또는 완화

- 변경 내용:
  - `.gitattributes`에 `* text=auto eol=lf`를 두어 텍스트 파일의 LF 정책을 명시했다.
  - 이미지, 폰트 등 바이너리 확장자는 `binary`로 지정해 텍스트 정규화 대상에서 제외했다.
- 안전한 적용 절차:
  1. 작업 중인 변경을 먼저 확인하고 보존한다.
  2. `.gitattributes`를 추가한다.
  3. 새 규칙 적용 후 `git diff`에서 의도하지 않은 전체 파일 재기록이 없는지 확인한다.
  4. `npm run format:check` 또는 전체 `npm run validate`를 실행한다.
  5. 줄바꿈만 바뀐 대규모 diff가 생기면 기능 변경과 섞어 커밋하지 않고 원인을 다시
     확인한다.
- 임시 우회: 없음.
- 후속 작업: 최초 커밋 후 새 checkout에서도 불필요한 줄바꿈 diff가 없는지 확인한다.

#### 검증

- 명령/시나리오:
  - `.gitattributes` 규칙 확인
  - `git diff`
  - `npm run validate`
- 결과: canonical 저장소의 복구 검증에서 Prettier check를 포함한 전체 품질 게이트가
  PASS했다.
- 관련 검증 보고서: `docs/verification/2026-07-26-TASK-0001-recovery.md`

#### 예방

- 추가한 테스트/알림: CI와 로컬 전체 검증에서 Prettier check를 유지한다.
- 문서/ADR 변경: `.gitattributes`를 저장소 줄바꿈 정책의 기준으로 사용한다.

### TS-2026-003: `erasableSyntaxOnly`에서 constructor parameter property 사용 불가

- 발견일: 2026-07-27
- 해결일: 2026-07-27
- 상태: `resolved`
- 영향: IndexedDB repository 구현의 typecheck가 `TS1294`로 실패했다.
- 관련 작업/커밋: TASK-0003
- 환경: TypeScript 6, `erasableSyntaxOnly`

#### 증상

constructor 매개변수에 `private readonly database: IDBDatabase`처럼 접근 제어자와 필드
선언을 함께 사용했을 때, 현재 TypeScript 설정에서 해당 문법을 지울 수 없다는 `TS1294`
오류가 발생했다.

#### 확인된 원인

`erasableSyntaxOnly`는 JavaScript로 단순 삭제할 수 없는 TypeScript 문법을 허용하지 않는다.
parameter property는 constructor 매개변수뿐 아니라 런타임 필드 초기화 코드를 생성하므로
이 설정과 맞지 않았다.

#### 해결 또는 완화

- 클래스 본문에 일반 필드를 선언했다.
- constructor에서는 전달받은 값을 명시적으로 필드에 할당했다.
- 저장소의 TypeScript 설정을 완화하거나 예외 처리하지 않았다.

#### 검증

- 명령: `npm run typecheck`
- 결과: PASS
- 상세 동작 검증은 프로토타입 통합 검증 시점으로 유예했다.

#### 예방

- `erasableSyntaxOnly`가 켜진 코드에서는 enum, namespace, parameter property 등 런타임
  변환이 필요한 문법을 새로 사용하지 않는다.

### TS-2026-004: Codex 환경의 `npx`·Husky hook 실행 경로 부재

- 발견일: 2026-07-27
- 상태: `mitigated`
- 영향: Codex의 제한된 실행 환경에서 hook이 기대한 `npx` 실행 파일을 찾지 못해 자동
  커밋 전 검사를 그대로 실행할 수 없었다.
- 관련 작업/커밋: 프로토타입 작업
- 환경: Windows, Codex bundled Node/npm, Husky

#### 확인된 원인

프로젝트 의존성 문제가 아니라 Codex 실행 환경의 PATH와 Git hook 프로세스 환경이 일반
개발자 셸과 달랐다. 따라서 저장소에 설치된 패키지가 있어도 hook이 전제한 `npx` 명령을
해석하지 못했다.

#### 해결 또는 완화

- hook 자체를 성공한 것으로 기록하지 않았다.
- 동일 목적의 `npm run lint`, `npm run typecheck`, `npm run build`를 명시적으로 실행했다.
- 프로토타입 통합 전에는 전체 `npm run validate`와 정상 개발 환경의 Husky 동작을 다시
  확인해야 한다.
- 제품 코드, package script와 hook 설정은 환경 문제를 우회하기 위해 변경하지 않았다.

#### 검증

- 결과: 최소 게이트인 lint, typecheck, production build는 PASS로 전달받았다.
- 상태가 `mitigated`인 이유: Codex 환경의 hook 실행 자체는 복구하지 않았고 수동 명령으로
  대체했기 때문이다.

#### 예방

- 자동 hook 결과와 수동 대체 검사를 구분해 handoff에 기록한다.
- CI Validate check를 원격 병합의 최종 품질 게이트로 유지한다.
