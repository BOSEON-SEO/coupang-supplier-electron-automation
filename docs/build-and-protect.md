# 빌드 + 코드 보호 가이드

memory 의 `project_licensing_plan` 합의 — "크랙 비용 > 라이선스 비용" 만 만들면 됨. 완벽 방어 불가능을 받아들이고 비용 대비 효과를 최대화하는 계층화 전략.

## 적용 계층 (효과 ↓)

| # | 계층 | 효과 | 적용 비용 | 본 PR |
|---|---|---|---|---|
| 1 | **라이선스 검증 (Supabase)** | 비검증 카피 차단 | 낮음 | ✅ PR #1~#3 |
| 2 | **Electron Fuses (asar integrity, runAsNode 차단)** | 패치 도구 + JS 인젝션 차단 | 낮음 | ✅ 본 PR |
| 3 | **EV 코드서명** | SmartScreen 통과, 서명 변조 시 경고 | 인증서 비용 ($300~/년) | 🟡 자리만 |
| 4 | **bytenode (V8 바이트코드)** | 소스 정적 분석 차단 80% | 중간 — 테스트 필요 | ⏳ 추후 |
| 5 | **라이선스 모듈 .node 분리** | 핵심 검증 로직 컴파일 | 높음 | ⏳ 옵션 |

---

## 1. Electron Fuses (자동 적용)

`@electron/fuses` 의존 + [scripts/electron-fuses.js](../scripts/electron-fuses.js) 의 afterPack hook 이 빌드 후 일렉트론 바이너리에 다음 fuse 를 굽는다 (변경 불가):

- `RunAsNode: false` — `ELECTRON_RUN_AS_NODE` 환경변수로 일렉트론을 node 처럼 실행하는 통로 차단
- `EnableNodeCliInspectArguments: false` — `--inspect` 등 디버거 attach 차단
- `EnableNodeOptionsEnvironmentVariable: false` — `NODE_OPTIONS` 환경변수 차단
- `EnableEmbeddedAsarIntegrityValidation: true` — `app.asar` 변조 감지 시 실행 거부
- `OnlyLoadAppFromAsar: true` — asar 외부 코드 로드 거부

빌드 명령:

```bash
npm install         # @electron/fuses 등 dep 설치
npm run build       # webpack(prod) + electron-builder + afterPack(fuses)
```

빌드 산출물: `dist-electron/<제품명> Setup x.x.x.exe`

검증:

```bash
# 빌드된 exe 확인 (PowerShell)
& 'dist-electron\win-unpacked\쿠팡 서플라이어 자동화.exe' --inspect
# → fuse 적용됐으면 디버거 안 뜨고 일반 실행
```

---

## 2. EV 코드서명 (인증서 필요)

Windows SmartScreen 통과를 위해 EV(Extended Validation) 코드서명 인증서 필요.

**구매처**: DigiCert / Sectigo / GlobalSign — 연 $300~$500. EV 는 USB 토큰(하드웨어) 형태로 배송. 보관 + 매 빌드 시 토큰 연결.

**electron-builder 에서 자동 서명**:

```jsonc
// package.json 의 build 에 추가
"build": {
  "win": {
    "target": [...],
    "certificateFile": "path/to/cert.pfx",
    "certificatePassword": "<env:CSC_KEY_PASSWORD>",
    "signingHashAlgorithms": ["sha256"],
    "verifyUpdateCodeSignature": true
  }
}
```

EV 토큰은 .pfx 파일이 아닌 토큰 자체로 서명 — `signtool.exe` 직접 호출하는 customSign 함수 필요. 인증서 도입 시점에 추가.

---

## 3. bytenode (V8 바이트코드) — 추후 적용

main process 의 .js 를 V8 바이트코드 (.jsc) 로 컴파일. 디컴파일 가능하지만 일반 텍스트 분석 80% 차단.

**주의사항**:
- 모든 .js 를 .jsc 로 바꾸면 동작 불안정 (특히 의존성). main process 진입점 + 라이선스 검증 모듈 정도만 컴파일.
- electron-builder 의 afterPack 또는 별도 빌드 스크립트 필요.
- 컴파일된 .jsc 는 일렉트론 버전 의존 — 일렉트론 업그레이드 시 재컴파일.

**적용 대상 (예시)**:
- `license-service.js` (라이선스 로직 핵심)
- `main.js` 의 일부 (핵심 분기)

```bash
npm i -D bytenode
npx bytenode --compile license-service.js
# → license-service.jsc 생성. 원본 .js 는 require('bytenode'); 한 줄로 대체
```

PR 분리 — 충분한 통합 테스트 후 적용.

---

## 4. 라이선스 모듈 .node 분리 (옵션)

가장 강력한 보호 — Node-API 로 native module 작성. 사용자가 .js 만 보지만 핵심 로직은 .node 안.

비용:
- C++/Rust 빌드 환경
- 일렉트론 ABI 마다 재빌드
- 디버깅 어려움

**효과 vs 비용 따져 출시 후 매출 안정화 시점에 검토**.

---

## 빌드 체크리스트 (출시 직전)

- [ ] `.env.production` 작성 (SUPABASE_URL/ANON_KEY 채우기)
- [ ] `npm run build` 로 fuses 적용된 빌드 산출물 생성
- [ ] Windows VM 클린 환경에서 설치 + 첫 실행 테스트
- [ ] 라이선스 활성 → 메인 앱 진입 테스트
- [ ] 만료된 라이선스로 차단 테스트 (DB 의 expired_at 과거로 일시 변경)
- [ ] EV 코드서명 적용 (인증서 도입 후)
- [ ] SmartScreen / Defender 검역 테스트
- [ ] 사용자 매뉴얼 + 시리얼 발급 안내문서
