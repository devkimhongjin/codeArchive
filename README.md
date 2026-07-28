# CodeArchive

SWEA, 프로그래머스, 정올, LeetCode의 코딩테스트 문제 풀이 기록을 수집하고 관리하기 위한 Chrome Extension입니다.

## 시작하기

요구 사항은 Node.js 22, npm, Chrome, Git입니다.

```bash
npm ci
npm run dev
```

프로덕션 빌드와 전체 검증은 다음 명령으로 실행합니다.

```bash
npm run validate
```

빌드 결과는 `dist`에 생성됩니다. Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 해당 폴더를 압축 해제된 확장 프로그램으로 로드할 수 있습니다.

### 프로토타입 빌드와 로드

```bash
npm ci
npm run build
```

1. Chrome에서 `chrome://extensions`를 연다.
2. 오른쪽 위의 **개발자 모드**를 켠다.
3. **압축해제된 확장 프로그램을 로드합니다.**를 선택한다.
4. 이 저장소의 `dist` 폴더를 선택한다.
5. CodeArchive Popup을 열고 **대시보드 열기**를 선택한다.

소스 변경 후에는 `npm run build`를 다시 실행하고 확장 관리 화면에서 CodeArchive를
새로고침한다. 프로토타입 통합 수동 검증 전이므로 현재 빌드 성공만으로 Chrome 동작이
최종 검증됐다고 간주하지 않는다.

자세한 내용은 다음 문서를 참고하세요.

- [개발 환경 구성](docs/development-setup.md)
- [아키텍처](docs/architecture.md)
- [데이터 모델](docs/data-model.md)
- [플랫폼 어댑터](docs/platform-adapter.md)
- [개발 컨벤션](docs/conventions.md)
- [보안 정책](docs/security-policy.md)

## 수동 풀이 등록 프로토타입

현재 프로토타입은 브라우저 안에 풀이를 직접 기록하는 local-first 흐름을 제공한다.

1. Extension Popup에서 **대시보드 열기**를 선택한다.
2. Dashboard의 저장된 풀이 목록에서 기존 기록을 선택하거나 **풀이 추가**를 선택한다.
3. 플랫폼과 언어를 고르고 문제 제목 또는 문제 번호 중 하나 이상을 입력한다. 코드,
   풀이 날짜와 AI 활용 수준은 선택하거나 기본값을 사용할 수 있다.
4. 같은 플랫폼·문제 번호 또는 정규화된 제목의 후보가 있으면 자동으로 합치지 않는다.
   기존 문제에 새 풀이를 추가하거나, 별도 문제로 저장하거나, 입력 수정으로 돌아간다.
5. 저장한 기록은 목록과 상세에서 확인하고 상세의 **수정**에서 바꿀 수 있다. 여러 풀이가
   같은 Problem을 공유하면 문제 정보 수정의 영향도 화면에서 안내한다.

Problem, SolutionSession과 AIUsageRecord는 native IndexedDB의 단일 transaction으로
저장한다. 서버 전송이나 동기화 없이 현재 Chrome 프로필의 로컬 `codearchive` 데이터베이스를
사용하며, Dashboard는 object store를 직접 다루지 않고 repository 경계를 통해 읽고 쓴다.

현재 프로토타입에는 삭제, Submission 이력, 파일·JSON·Markdown 가져오기, 중복 병합,
실사이트 DOM 기반 자동 수집이 없다. 자동·수동 상세 검증과 Chrome unpacked smoke test도
프로토타입 통합 검증 시점으로 유예되어 있다.

## 멀티에이전트 프로젝트 운영

프로젝트는 기획, 구현, 검증, 기록의 네 역할로 운영한다.

- [프로젝트 상태판](project.md)
- [에이전트 공통 규칙](AGENTS.md)
- [프로젝트 로드맵](docs/project/roadmap.md)
- [작업 백로그](docs/project/backlog.md)
- [KPI 관리](docs/project/kpi.md)
- [역할별 지침](.agents/roles)
- [작업 인계 문서](.agents/handoffs)

작업은 `기획 → 구현 → 검증 → 기록 → 기획 종료 승인` 순서로 진행한다. 검증 결과와 문서 반영이 끝나기 전에는 작업을 완료로 표시하지 않는다.
