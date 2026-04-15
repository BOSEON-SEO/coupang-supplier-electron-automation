# 쿠팡 서플라이어 허브 Electron 자동화 앱 — Developer Setup

## 사전 요구사항

- **Node.js** 18+ (`node --version`)
- **Python** 3.9+ (`python --version`)
- **Git**

---

## 1. Node.js 환경 설정

```bash
# 프로젝트 루트에서
npm install
npm run build:renderer
```

---

## 2. Python 가상환경 (venv) 설정

프로젝트 내부에 격리된 Python 환경을 구성한다. Electron이 Python subprocess를 실행할 때 이 venv를 자동으로 탐지한다.

```bash
# venv 생성 (프로젝트 루트에서)
python -m venv python/.venv

# 활성화
# Windows (PowerShell):
python\.venv\Scripts\Activate.ps1
# Windows (CMD):
python\.venv\Scripts\activate.bat
# macOS/Linux:
source python/.venv/bin/activate

# 의존성 설치
pip install -r python/requirements.txt

# Playwright 브라우저 설치 (Chromium만)
playwright install chromium
```

또는 npm 스크립트를 사용:
```bash
npm run python:venv:create
npm run python:venv:install
```

---

## 3. Python 인터프리터 탐지 순서

Electron Main process (`ipc-handlers.js`)가 Python subprocess를 실행할 때 다음 순서로 인터프리터를 탐지한다:

| 우선순위 | 소스 | 설명 |
|---|---|---|
| 1 | `PYTHON_BIN` 환경변수 | 절대 경로 직접 지정 (예: `C:\Python311\python.exe`) |
| 2 | `PYTHON_PATH` 환경변수 | 하위 호환용 |
| 3 | `python/.venv` (프로젝트 로컬) | Windows: `.venv/Scripts/python.exe`, Unix: `.venv/bin/python3` |
| 4 | 시스템 PATH | `where python` (Windows) / `which python3` (Unix) |

특정 Python을 사용하고 싶다면:
```bash
# .env 파일 또는 시스템 환경변수로 설정
PYTHON_BIN=C:\Users\username\AppData\Local\Programs\Python\Python311\python.exe
```

---

## 4. 환경 검증

```bash
# hello.py 실행 — Python 환경 + playwright 설치 확인
npm run python:hello
```

정상 출력 예시:
```
{"type": "log", "data": "Python 버전: 3.11.x ..."}
{"type": "log", "data": "playwright.sync_api import 성공"}
{"type": "log", "data": "hello.py 종료 — 모든 검증 항목 실행 완료"}
```

---

## 5. 앱 실행

```bash
# 개발 모드 (webpack-dev-server + Electron 동시 실행)
npm run dev

# 프로덕션 빌드 직접 실행
npm run build:renderer && npm start
```

---

## 6. 테스트

```bash
# 전체 테스트 (Excel 라이브러리 + Python 브릿지 + UI E2E)
npm test

# 개별 테스트
npm run test:lib       # Excel 직렬화/역직렬화
npm run test:python    # Python subprocess IPC 브릿지
npm run test:ui        # Electron UI E2E (빌드 필요)
```

---

## 7. 수동 설정 체크리스트

자동화 Agent가 처리할 수 없어 **사람이 직접** 해야 하는 작업입니다.

- [ ] Chrome 원격 디버깅 모드 단축아이콘/스크립트 준비
      `chrome.exe --remote-debugging-port=9222` — CDP attach 전제 조건
- [ ] `vendors.json`에 벤더 자격증명 설정
      환경변수: `COUPANG_ID_BASIC`, `COUPANG_PW_BASIC`, `COUPANG_ID_CANON`, `COUPANG_PW_CANON`
- [ ] Python venv 생성 및 의존성 설치 (위 섹션 2 참조)
- [ ] `playwright install chromium` 실행
- [ ] MCP 서버 `.mcp.json` env 설정 확인 (선택)

---

## 프로젝트 디렉토리 구조

```
coupang-supplier-electron-automation/
├── main.js                    # Electron Main process
├── ipc-handlers.js            # IPC 핸들러 (Python 브릿지 포함)
├── preload.js                 # contextBridge 보안 브릿지
├── webpack.config.js          # React 빌드 설정
├── package.json
├── python/                    # Python 자동화 스크립트
│   ├── requirements.txt       # pip 의존성 (playwright 등)
│   ├── .venv/                 # Python 가상환경 (gitignore 대상)
│   ├── common/                # 공용 유틸리티
│   │   ├── __init__.py
│   │   └── ipc.py             # JSON-line IPC 헬퍼
│   ├── hello.py               # 환경 검증 스크립트
│   └── echo_test.py           # IPC 프로토콜 테스트용
├── src/                       # React Renderer
│   ├── App.jsx
│   ├── components/
│   └── lib/
├── dist/                      # webpack 빌드 산출물
└── test-*.js                  # 테스트 스크립트
```
