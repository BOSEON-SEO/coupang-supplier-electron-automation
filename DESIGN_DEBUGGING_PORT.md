# CDP 원격 디버깅 포트 노출 — 설계 문서

## 1. 목적

Electron 앱 내부 Chromium(BrowserView)에 `--remote-debugging-port`를 적용하여,
Python subprocess(Playwright)가 `connect_over_cdp`로 attach할 수 있는 CDP 엔드포인트를 노출한다.

### 핵심 원칙

> **Playwright 직접 launch 절대 금지** — Akamai Bot Manager 탐지 회피를 위해
> 반드시 기존 Chromium 세션에 CDP attach 방식만 허용한다.

---

## 2. 현재 상태 (Phase 1)

```
main.js
  └─ BrowserWindow (React UI)
       ├─ 웹 뷰 탭: placeholder <div> (BrowserView 미연결)
       └─ 작업 뷰 탭: EditableTable + LogPanel

ipc-handlers.js
  └─ python:run → spawn(python, [script, ...args])
       └─ env: { COUPANG_DATA_DIR }
       └─ stdout/stderr → python:log / python:error 이벤트

WebView.jsx: "웹 뷰 영역" 플레이스홀더만 표시
```

**부족한 것:**
- BrowserView 인스턴스 자체가 없음 (placeholder `<div>`만 있음)
- 디버깅 포트 노출 없음
- Python에 CDP 엔드포인트를 전달하는 메커니즘 없음
- 벤더별 세션 격리(partition) 없음

---

## 3. 아키텍처 설계

### 3.1 전체 흐름

```
┌──────────────────── Electron Main ────────────────────┐
│                                                        │
│  BrowserWindow (React UI)                              │
│    ├─ 탭 "웹 뷰" → BrowserView 영역 (실시간 확인)      │
│    └─ 탭 "작업 뷰" → EditableTable + LogPanel          │
│                                                        │
│  BrowserView (벤더별 1개)                               │
│    ├─ partition: "persist:vendor_{vendorId}"            │
│    ├─ webPreferences.debugPort: 동적 할당 포트          │
│    └─ URL: supplier.coupang.com (또는 로그인 페이지)    │
│                                                        │
│  포트 매니저 (cdp-port-manager.js)                      │
│    ├─ allocate(vendorId) → port (9222–9322 범위)       │
│    ├─ release(vendorId)                                 │
│    └─ getEndpoint(vendorId) → ws://127.0.0.1:port      │
│                                                        │
│  python:run 호출 시                                     │
│    env.CDP_ENDPOINT = ws://127.0.0.1:{port}            │
│    args += ["--cdp-endpoint", ws://...]                 │
│                                                        │
└────────────────────────────────────────────────────────┘
          │ stdout (JSON-line)
          ▼
┌──────── Python subprocess ────────┐
│                                    │
│  from playwright.sync_api import   │
│    sync_playwright                 │
│                                    │
│  browser = pw.chromium             │
│    .connect_over_cdp(              │
│       os.environ["CDP_ENDPOINT"]   │
│    )                               │
│  context = browser.contexts[0]     │
│  page = context.pages[0]  # 재사용 │
│                                    │
│  ⛔ pw.chromium.launch() 금지      │
│  ⛔ context.new_page() 금지        │
│                                    │
└────────────────────────────────────┘
```

### 3.2 컴포넌트 구조

| 파일 | 역할 | 신규/수정 |
|------|------|-----------|
| `cdp-port-manager.js` | 포트 동적 할당/해제/조회 | **신규** |
| `vendor-session.js` | BrowserView 생성/관리, partition 매핑 | **신규** |
| `main.js` | BrowserView ↔ BrowserWindow 연결, IPC 등록 | 수정 |
| `ipc-handlers.js` | python:run에 CDP_ENDPOINT 주입 | 수정 |
| `preload.js` | BrowserView 관련 IPC 채널 추가 | 수정 |
| `src/components/WebView.jsx` | BrowserView 제어 UI (placeholder 대체) | 수정 |
| `python/common/cdp.py` | Playwright attach 헬퍼 | **신규** |

---

## 4. 상세 설계

### 4.1 포트 동적 할당 (`cdp-port-manager.js`)

```javascript
// cdp-port-manager.js

const BASE_PORT = 9222;
const MAX_VENDORS = 100;  // 9222–9322 범위

class CdpPortManager {
  constructor() {
    this._ports = new Map();   // vendorId → port
    this._used = new Set();    // 사용 중인 포트 집합
  }

  /**
   * 벤더에 포트를 할당한다.
   * 이미 할당된 벤더는 기존 포트 반환.
   * @param {string} vendorId
   * @returns {number} 할당된 포트
   * @throws 포트 고갈 시 에러
   */
  allocate(vendorId) {
    if (this._ports.has(vendorId)) {
      return this._ports.get(vendorId);
    }
    for (let p = BASE_PORT; p < BASE_PORT + MAX_VENDORS; p++) {
      if (!this._used.has(p)) {
        this._ports.set(vendorId, p);
        this._used.add(p);
        return p;
      }
    }
    throw new Error('CDP port pool exhausted');
  }

  /**
   * 벤더의 포트를 해제한다.
   */
  release(vendorId) {
    const port = this._ports.get(vendorId);
    if (port != null) {
      this._used.delete(port);
      this._ports.delete(vendorId);
    }
  }

  /**
   * 벤더의 CDP WebSocket 엔드포인트를 반환한다.
   * @returns {string|null} "ws://127.0.0.1:{port}" 또는 null
   */
  getEndpoint(vendorId) {
    const port = this._ports.get(vendorId);
    return port != null ? `http://127.0.0.1:${port}` : null;
  }

  /**
   * 벤더의 할당된 포트를 반환한다.
   * @returns {number|null}
   */
  getPort(vendorId) {
    return this._ports.get(vendorId) ?? null;
  }

  /** 현재 할당 상태를 반환한다 (디버깅용). */
  snapshot() {
    return Object.fromEntries(this._ports);
  }
}

module.exports = { CdpPortManager };
```

**설계 근거:**
- **범위 9222–9322**: Chrome 관례적 디버깅 포트(9222) 기준, 벤더 최대 100개 수용
- **Map 기반**: 벤더↔포트 1:1 매핑, 중복 할당 방지
- **멱등 allocate**: 같은 벤더로 두 번 호출해도 같은 포트 반환
- 포트 충돌 검사(실제 bind 시도)는 BrowserView 생성 시 Electron이 처리

### 4.2 벤더 세션 관리 (`vendor-session.js`)

```javascript
// vendor-session.js

const { BrowserView } = require('electron');
const { CdpPortManager } = require('./cdp-port-manager');

class VendorSessionManager {
  constructor() {
    this._portManager = new CdpPortManager();
    this._views = new Map();  // vendorId → BrowserView
    this._mainWindow = null;
    this._activeVendor = null;
  }

  setMainWindow(win) {
    this._mainWindow = win;
  }

  /**
   * 벤더용 BrowserView를 생성하고 디버깅 포트를 활성화한다.
   * 이미 존재하면 기존 인스턴스를 반환.
   */
  getOrCreate(vendorId) {
    if (this._views.has(vendorId)) {
      return this._views.get(vendorId);
    }

    const port = this._portManager.allocate(vendorId);

    const view = new BrowserView({
      webPreferences: {
        partition: `persist:vendor_${vendorId}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Chromium 원격 디버깅 포트 활성화
        // BrowserView에서는 직접 지정 불가 → app.commandLine으로 대체
        // 또는 별도 프로세스에서 처리 (아래 4.3절 참조)
      },
    });

    this._views.set(vendorId, view);
    return { view, port };
  }

  /**
   * 활성 벤더의 BrowserView를 MainWindow에 attach한다.
   */
  activate(vendorId) {
    if (!this._mainWindow) return;

    // 기존 뷰 제거
    if (this._activeVendor) {
      const oldView = this._views.get(this._activeVendor);
      if (oldView) {
        this._mainWindow.removeBrowserView(oldView);
      }
    }

    const viewInfo = this.getOrCreate(vendorId);
    this._mainWindow.addBrowserView(viewInfo.view);
    this._activeVendor = vendorId;

    // BrowserView 영역 설정 (IPC로 Renderer에서 좌표 전달)
    return viewInfo;
  }

  /**
   * 벤더 세션을 종료한다.
   */
  destroy(vendorId) {
    const view = this._views.get(vendorId);
    if (view) {
      if (this._activeVendor === vendorId && this._mainWindow) {
        this._mainWindow.removeBrowserView(view);
      }
      view.webContents.destroy();
      this._views.delete(vendorId);
    }
    this._portManager.release(vendorId);
  }

  /** CDP 엔드포인트 조회 */
  getCdpEndpoint(vendorId) {
    return this._portManager.getEndpoint(vendorId);
  }

  /** 포트 조회 */
  getCdpPort(vendorId) {
    return this._portManager.getPort(vendorId);
  }
}

module.exports = { VendorSessionManager };
```

### 4.3 디버깅 포트 활성화 방식 (핵심 결정)

Electron의 `BrowserView`는 개별 프로세스가 아니므로 **뷰별 디버깅 포트를 직접 지정할 수 없다.**
대신 다음 전략을 사용한다:

#### 전략 A: 앱 수준 단일 포트 (권장, Phase 1)

```javascript
// main.js — app.whenReady() 이전에 설정
const CDP_PORT = 9222;
app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT));
```

- Electron 앱 전체의 Chromium에 단일 디버깅 포트 노출
- `http://127.0.0.1:9222/json/version` → WebSocket URL 획득
- Playwright가 이 URL로 attach → `browser.contexts` 중 partition으로 필터
- **장점**: 구현 단순, Electron 공식 지원
- **단점**: 벤더 간 포트 격리 없음 (보안 위험 낮음 — 로컬 전용)

#### 전략 B: 벤더별 별도 Electron 프로세스 (Phase 4)

```javascript
// 벤더마다 별도 hidden BrowserWindow를 생성하고 각각 다른 포트 할당
// → 프로세스 격리 완전, 포트 완전 독립
// → 구현 복잡도 높음, Phase 4에서 검토
```

**Phase 1 결정: 전략 A** — 단일 포트로 시작하고, 벤더 전환 시 BrowserView의 partition을 교체한다.

### 4.4 `main.js` 수정

```javascript
// main.js 수정 사항

const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const { VendorSessionManager } = require('./vendor-session');

// ── CDP 디버깅 포트 활성화 ──
const CDP_PORT = parseInt(process.env.CDP_PORT, 10) || 9222;
app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT));

const sessionManager = new VendorSessionManager();

app.whenReady().then(() => {
  registerIpcHandlers({
    ipcMain,
    getWindow: () => mainWindow,
    dataDir: DATA_DIR,
    sessionManager,    // 추가: 세션 매니저 주입
    cdpPort: CDP_PORT, // 추가: CDP 포트
  });
  createWindow();
  sessionManager.setMainWindow(mainWindow);
});
```

### 4.5 `ipc-handlers.js` 수정 — Python에 CDP 엔드포인트 전달

```javascript
// python:run 핸들러 수정 (spawn env에 CDP 정보 추가)

ipcMain.handle('python:run', async (_e, scriptName, args) => {
  // ... 기존 검증 로직 ...

  // ── CDP 엔드포인트 주입 ──
  const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;

  child = spawn(pythonPath, ['-u', scriptPath, ...safeArgs], {
    cwd: SCRIPTS_DIR,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      COUPANG_DATA_DIR: dataDir,
      CDP_ENDPOINT: cdpEndpoint,           // 추가
      CDP_PORT: String(cdpPort),           // 추가
      CDP_VENDOR_PARTITION: `persist:vendor_${activeVendor}`, // 추가
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
});

// ── 신규 IPC: CDP 상태 조회 ──
ipcMain.handle('cdp:status', async () => {
  return {
    port: cdpPort,
    endpoint: `http://127.0.0.1:${cdpPort}`,
    active: true,
  };
});
```

### 4.6 Python Playwright attach 헬퍼 (`python/common/cdp.py`)

```python
"""
CDP 연결 헬퍼

Electron이 노출한 디버깅 포트에 Playwright가 attach하는 유틸리티.
절대로 chromium.launch()를 호출하지 않는다.

사용 예:
    from common.cdp import attach_browser, get_page

    browser = attach_browser()          # CDP 엔드포인트에 연결
    page = get_page(browser)            # 기존 페이지 재사용 (새 탭 금지)
    page.goto("https://supplier.coupang.com/...")
"""

import os
import sys
from typing import Optional
from common.ipc import send_log, send_error

# Playwright 가드: launch 호출 감지 시 에러
_LAUNCH_BLOCKED = True


def get_cdp_endpoint() -> str:
    """환경변수에서 CDP 엔드포인트를 가져온다."""
    endpoint = os.environ.get("CDP_ENDPOINT")
    if not endpoint:
        send_error("CDP_ENDPOINT 환경변수 미설정. Electron 앱에서 실행하세요.")
        sys.exit(1)
    return endpoint


def attach_browser(endpoint: Optional[str] = None):
    """
    CDP 엔드포인트에 Playwright로 attach한다.

    ⛔ chromium.launch() 금지
    ⛔ context.new_page() 금지
    ✅ chromium.connect_over_cdp() 만 허용

    Args:
        endpoint: CDP HTTP 엔드포인트 (기본: CDP_ENDPOINT 환경변수)

    Returns:
        (playwright, browser) 튜플
    """
    from playwright.sync_api import sync_playwright

    ep = endpoint or get_cdp_endpoint()
    send_log(f"CDP 연결 시도: {ep}")

    pw = sync_playwright().start()
    browser = pw.chromium.connect_over_cdp(ep)

    send_log(f"CDP 연결 성공 — contexts: {len(browser.contexts)}")
    return pw, browser


def get_page(browser, index: int = 0):
    """
    기존 컨텍스트의 기존 페이지를 반환한다.
    Keycloak OAuth2 SPA는 access_token이 JS 메모리에만 존재하므로
    반드시 기존 페이지를 재사용해야 한다.

    ⛔ context.new_page() 절대 금지 (세션 토큰 소실)

    Args:
        browser: Playwright Browser (CDP로 연결된 것)
        index: 페이지 인덱스 (기본 0 = 첫 번째 페이지)

    Returns:
        Page 인스턴스
    """
    if not browser.contexts:
        send_error("BrowserContext가 없습니다. Electron BrowserView가 로드되지 않았습니다.")
        sys.exit(1)

    context = browser.contexts[0]
    pages = context.pages

    if not pages:
        send_error("열린 페이지가 없습니다. BrowserView에서 페이지를 먼저 로드하세요.")
        sys.exit(1)

    if index >= len(pages):
        send_error(f"페이지 인덱스 {index} 초과 (총 {len(pages)}개)")
        sys.exit(1)

    page = pages[index]
    send_log(f"페이지 재사용: {page.url}")
    return page


def close_browser(pw, browser):
    """Playwright 연결을 정리한다 (브라우저 자체는 종료하지 않음)."""
    try:
        browser.close()
    except Exception:
        pass
    try:
        pw.stop()
    except Exception:
        pass
```

---

## 5. IPC 채널 설계 (신규)

| 채널 | 방향 | 시그니처 | 용도 |
|------|------|----------|------|
| `cdp:status` | Renderer → Main | `() → {port, endpoint, active}` | CDP 포트/엔드포인트 상태 조회 |
| `session:activate` | Renderer → Main | `(vendorId) → {success, port, endpoint}` | 벤더 BrowserView 생성/활성화 |
| `session:deactivate` | Renderer → Main | `(vendorId) → {success}` | 벤더 BrowserView 해제 |
| `session:navigate` | Renderer → Main | `(vendorId, url) → {success}` | BrowserView URL 이동 |
| `session:bounds` | Renderer → Main | `(vendorId, {x,y,w,h}) → void` | BrowserView 영역 설정 |

### `preload.js` 추가

```javascript
// ── CDP / 세션 관리 ──
cdpStatus: () => ipcRenderer.invoke('cdp:status'),
activateSession: (vendorId) => ipcRenderer.invoke('session:activate', vendorId),
deactivateSession: (vendorId) => ipcRenderer.invoke('session:deactivate', vendorId),
navigateSession: (vendorId, url) => ipcRenderer.invoke('session:navigate', vendorId, url),
setSessionBounds: (vendorId, bounds) => ipcRenderer.invoke('session:bounds', vendorId, bounds),
```

---

## 6. 검증 목표 (Goal)

### Goal 1: CDP 엔드포인트 접근 가능

```bash
# 앱 실행 후
curl http://127.0.0.1:9222/json/version
# 기대 응답 (200 OK):
# {"Browser":"Chrome/...","Protocol-Version":"1.3","webSocketDebuggerUrl":"ws://127.0.0.1:9222/..."}
```

### Goal 2: Python 호출 시 엔드포인트 전달 확인

```
# WorkView에서 ▶ Python 실행 → 로그 패널 출력:
# [INFO] CDP_ENDPOINT=http://127.0.0.1:9222
# [INFO] CDP 연결 시도: http://127.0.0.1:9222
# [INFO] CDP 연결 성공 — contexts: 1
```

---

## 7. 보안 고려사항

| 위험 | 대응 |
|------|------|
| 디버깅 포트를 외부에서 접근 | `127.0.0.1`로 바인딩 → 로컬만 접근 가능 |
| 악의적 스크립트가 `launch()` 호출 | Python 코드에서 `launch` 금지 규칙 문서화 + 코드 리뷰 |
| 포트 스캔으로 세션 탈취 | 로컬 환경 전용 앱이므로 위험 낮음 |
| 다중 Electron 인스턴스 포트 충돌 | `CDP_PORT` 환경변수로 오버라이드 가능 |

---

## 8. 구현 체크리스트

### Phase A: CDP 포트 노출 (이 마일스톤)

- [ ] `cdp-port-manager.js` 생성 — 포트 할당/해제/조회
- [ ] `main.js` 수정 — `app.commandLine.appendSwitch('remote-debugging-port', port)`
- [ ] `main.js` 수정 — `CDP_PORT` 환경변수 지원
- [ ] `ipc-handlers.js` 수정 — `python:run` 환경변수에 `CDP_ENDPOINT`, `CDP_PORT` 추가
- [ ] `ipc-handlers.js` 수정 — `cdp:status` IPC 핸들러 추가
- [ ] `preload.js` 수정 — `cdpStatus()` 메서드 노출
- [ ] `python/common/cdp.py` 생성 — `attach_browser()`, `get_page()`, `close_browser()`
- [ ] `python/hello.py` 수정 — CDP_ENDPOINT 환경변수 출력 추가
- [ ] 테스트: `curl http://127.0.0.1:9222/json/version` → 200 확인
- [ ] 테스트: Python 실행 시 로그에 CDP_ENDPOINT 출력 확인

### Phase B: BrowserView 통합 (후속 마일스톤)

- [ ] `vendor-session.js` 생성 — BrowserView 생성/관리
- [ ] `main.js` 수정 — VendorSessionManager 연결
- [ ] IPC 핸들러 추가 — `session:activate`, `session:deactivate`, `session:navigate`, `session:bounds`
- [ ] `preload.js` 수정 — 세션 관련 IPC 메서드 노출
- [ ] `WebView.jsx` 수정 — placeholder 대체, BrowserView 영역 좌표 전달
- [ ] 벤더 전환 시 BrowserView 교체 동작 확인
- [ ] Partition 기반 세션 격리 동작 확인

### Phase C: Playwright 자동화 연동 (Phase 2)

- [ ] PO 다운로드 스크립트 — `cdp.attach_browser()` + 페이지 조작
- [ ] 발주확정 업로드 스크립트 — 파일 업로드 자동화
- [ ] 쿠팡 사이트 함정 대응 코드 (모달 좀비, display:none 체크박스 등)

---

## 9. 테스트 계획

### 9.1 Unit 테스트 (`test-cdp-port.js`)

```javascript
// CdpPortManager 단위 테스트
const mgr = new CdpPortManager();
assert(mgr.allocate('basic') === 9222);
assert(mgr.allocate('basic') === 9222);  // 멱등
assert(mgr.allocate('canon') === 9223);
assert(mgr.getEndpoint('basic') === 'http://127.0.0.1:9222');
mgr.release('basic');
assert(mgr.getPort('basic') === null);
assert(mgr.allocate('newvendor') === 9222);  // 재사용
```

### 9.2 E2E 테스트 (Electron)

```javascript
// test-ui-validation.js에 추가
// CDP 상태 IPC 확인
const cdpRes = await evaluate('window.electronAPI.cdpStatus()');
log('CDP 상태', cdpRes?.port === 9222 ? 'PASS' : 'FAIL', ...);

// CDP 엔드포인트 HTTP 접근 확인 (Main process에서)
const http = require('http');
http.get('http://127.0.0.1:9222/json/version', (res) => {
  assert(res.statusCode === 200);
});
```

### 9.3 Python 통합 테스트

```python
# python/test_cdp_attach.py
from common.cdp import attach_browser, get_page, close_browser

pw, browser = attach_browser()
print(f"Contexts: {len(browser.contexts)}")
# BrowserView가 없으면 contexts가 0 → 에러 메시지 출력
close_browser(pw, browser)
```

---

## 10. 참고: Playwright attach 패턴 (절대 규칙)

```python
# ✅ 허용 패턴 (유일한 올바른 방법)
from playwright.sync_api import sync_playwright

pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp("http://127.0.0.1:9222")
context = browser.contexts[0]          # 기존 컨텍스트 재사용
page = context.pages[0]                # 기존 페이지 재사용
# ... 페이지 조작 ...
browser.close()                        # 연결만 끊음, 브라우저는 유지
pw.stop()
```

```python
# ⛔ 금지 패턴 1: 직접 launch (Akamai 탐지됨)
browser = pw.chromium.launch()

# ⛔ 금지 패턴 2: 새 탭 생성 (Keycloak 토큰 소실)
page = context.new_page()

# ⛔ 금지 패턴 3: 새 컨텍스트 생성 (세션 쿠키 없음)
context = browser.new_context()
```
