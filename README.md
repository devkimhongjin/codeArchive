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
