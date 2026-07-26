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

자세한 내용은 다음 문서를 참고하세요.

- [개발 환경 구성](docs/development-setup.md)
- [아키텍처](docs/architecture.md)
- [데이터 모델](docs/data-model.md)
- [플랫폼 어댑터](docs/platform-adapter.md)
- [개발 컨벤션](docs/conventions.md)
- [보안 정책](docs/security-policy.md)

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
