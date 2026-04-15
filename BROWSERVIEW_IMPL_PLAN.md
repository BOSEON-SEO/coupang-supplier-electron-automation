# BrowserView 구현 계획 검증 보고서

> 검증일: 2026-04-15
> 대상: Electron 31.7.7, Phase 1 BrowserView 통합

---

## 0. 긴급 발견: BrowserView는 Deprecated

```
Electron 31.7.7 사용 중 — BrowserView는 Electron 30에서 deprecated됨
```

**DESIGN_DEBUGGING_PORT.md의 설계는 `BrowserView` 기반이나, 현재 프로젝트의 Electron 31.7.7에서 BrowserView는 deprecated API다.**

### 대안: `WebContentsView` + `BrowserWindow.contentView`

| 항목 | BrowserView (deprecated) | WebContentsView (권장) |
|---|---|---|
| API | `new BrowserView(opts)` | `new WebContentsView(opts)` |
| attach | `win.addBrowserView(view)` | `win.contentView.addChildView(view)` |
| bounds | `view.setBounds({x,y,w,h})` | `view.setBounds({x,y,w,h})` |
| partition | `webPreferences.partition` | `webPreferences.partition` |
| 숨김 | `view.setBounds({..., width:0, height:0})` | `view.setVisible(false)` 또는 `setBounds(0)` |
| Electron 지원 | 30에서 deprecated, 향후 제거 | 30+ 공식 권장 |

**결론: `WebContentsView`로 구현해야 한다.** 아래 검증은 이 결론을 반영하여 진행한다.

### API 가용성 검증 (electron.d.ts 기반, 2026-04-15)

```
WebContentsView (extends View)  ✅ 존재
  └─ constructor(options?)      ✅ webPreferences.partition 지원
  └─ webContents (readonly)     ✅ 페이지 로드/이벤트 접근

View (base class)               ✅ 존재
  └─ setBounds(Rectangle)       ✅ bounds 설정
  └─ getBounds(): Rectangle     ✅ bounds 조회
  └─ setVisible(boolean)        ✅ 표시/숨김 (탭 전환용)
  └─ addChildView(view, index?) ✅ 자식 뷰 추가
  └─ removeChildView(view)      ✅ 자식 뷰 제거

BrowserWindow
  └─ contentView: View          ✅ 최상위 컨텐츠 뷰
```

---

## 1. Partition 전환 로직 타당성 및 세션 격리

### 1.1 설계 검증

**명명 규칙**: `persist:vendor_{vendorId}`
- `vendorId` 검증: `/^[a-z0-9_]{2,20}$/` (VendorSelector.jsx L43) — partition명 안전
- `persist:` 접두사: 디스크 지속, 앱 재시작 후 쿠키/세션 유지 — **필수**

### 1.2 세션 격리 가능 여부

```
vendor_basic  → partition "persist:vendor_basic"  → 독립 쿠키 저장소
vendor_canon  → partition "persist:vendor_canon"  → 독립 쿠키 저장소
```

- Electron partition은 `session.fromPartition()`으로 독립 `Session` 객체 생성
- 각 Session은 별도 쿠키/localStorage/Cache 보유 — **완전 격리**
- Akamai 쿠키(`_abck`, `bm_sz`)도 partition별로 분리됨 — **충돌 없음**

### 1.3 위험 요소

| 위험 | 심각도 | 대응 |
|---|---|---|
| **단일 CDP 포트에서 복수 partition의 context 식별** | 높음 | `browser.contexts`를 순회하며 URL/partition으로 필터 필요 |
| partition 전환 시 기존 뷰 메모리 누수 | 중간 | `view.webContents.close()` 호출 후 참조 해제 |
| persist 데이터 디스크 비대화 | 낮음 | 벤더 삭제 시 `session.fromPartition().clearStorageData()` |

### 1.4 CDP에서 올바른 context 찾기 — 핵심 과제

**현재 코드** (`browser.py` L184):
```python
def get_existing_page(browser, context_index: int = 0, page_index: int = 0):
    context = browser.contexts[context_index]  # ← 하드코딩 인덱스
```

**문제**: 단일 CDP 포트에 BrowserWindow(React UI) + WebContentsView(쿠팡 사이트) 두 context가 존재.
`contexts[0]`이 항상 쿠팡 사이트라는 보장 없음.

**필요한 수정**:
```python
def find_supplier_page(browser):
    """모든 context/page를 순회하여 supplier.coupang.com 페이지를 찾는다."""
    for ctx in browser.contexts:
        for page in ctx.pages:
            if "supplier.coupang.com" in page.url or "coupang.com" in page.url:
                return page
    # 로그인 페이지(keycloak)도 허용
    for ctx in browser.contexts:
        for page in ctx.pages:
            if "coupang.com" in page.url:
                return page
    return None  # about:blank 등 — 첫 로드 전
```

---

## 2. Bounds 동기화 (탭 전환 + 윈도우 리사이즈)

### 2.1 현재 상태

- **탭 전환**: `App.jsx`에서 `activeTab` state 기반 조건부 렌더링
- **리사이즈**: 핸들러 **전무** — `window.addEventListener('resize')` 없음
- **BrowserView/WebContentsView bounds**: 코드 없음
- **WebView.jsx**: 플레이스홀더 `<div>` — ref/좌표계산 없음

### 2.2 아키텍처 제약: Overlay 모델

WebContentsView는 BrowserWindow의 네이티브 레이어 위에 **오버레이**된다.
React DOM 위에 겹쳐지므로, React가 렌더링하는 `<div>`와 정확히 같은 좌표를 유지해야 한다.

```
┌─ BrowserWindow ─────────────────────────┐
│ ┌─ React DOM (Renderer) ──────────────┐ │
│ │  header  (h=50px, flex-shrink:0)    │ │
│ │  tab-nav (h=41px, flex-shrink:0)    │ │
│ │  ┌─ app-main (flex:1, padding:16) ─┐│ │
│ │  │                                  ││ │
│ │  │  WebContentsView가 이 영역에     ││ │
│ │  │  정확히 맞춰야 함                ││ │
│ │  │                                  ││ │
│ │  └──────────────────────────────────┘│ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### 2.3 구현 전략

**핵심 원칙: Renderer가 좌표를 계산하고 IPC로 Main에 전달**

```
WebView.jsx                             Main process
────────────                            ────────────
useRef(containerDiv)
  │
  ├─ mount → getBoundingClientRect()
  │           → IPC 'session:bounds'  ──→  view.setBounds(rect)
  │
  ├─ ResizeObserver
  │   → getBoundingClientRect()
  │   → debounce(100ms)
  │   → IPC 'session:bounds'          ──→  view.setBounds(rect)
  │
  └─ window 'resize' event
      → getBoundingClientRect()
      → debounce(100ms)
      → IPC 'session:bounds'          ──→  view.setBounds(rect)
```

**탭 전환 시**:
```
activeTab === 'webview'
  → IPC 'session:show'               ──→  view.setVisible(true)
                                     ──→  view.setBounds(rect)  // 표시
activeTab === 'workview'
  → IPC 'session:hide'               ──→  view.setVisible(false)  // 숨김
```
`setVisible(false)`는 Electron 31 View 클래스 공식 API.
`setBounds({width:0,height:0})`보다 깔끔하고 클릭 이벤트 누수 방지.

### 2.4 위험 요소

| 위험 | 심각도 | 대응 |
|---|---|---|
| **padding 계산 오류 → 뷰 위치 어긋남** | 높음 | `app-main`의 padding(16px)을 반영한 좌표. `getBoundingClientRect()`가 padding 내부를 반환하므로 정확 |
| **DevTools 열림 → 윈도우 크기 변경** | 중간 | resize 이벤트에서 자동 재계산 |
| **DPI 스케일링 (Windows 125%/150%)** | 높음 | `getBoundingClientRect()`는 CSS 픽셀 반환. Electron `view.setBounds()`도 CSS 픽셀 기준 — 일치 |
| **debounce 중 순간 깜빡임** | 낮음 | 100ms debounce면 체감 불가 |
| **탭 전환 시 WebContentsView 깜빡임** | 중간 | `{width:0,height:0}`으로 숨기되 `webContents.destroy()` 안 함 — 상태 유지 |

### 2.5 CSS 변경 필요 사항

현재 `.app-main`에 `overflow: auto` + `padding: 16px`.
WebContentsView가 오버레이되므로 웹 뷰 탭에서는 padding이 좌표 계산에 포함되어야 한다.
**별도 CSS 변경 불필요** — `getBoundingClientRect()`가 content 영역 좌표를 정확히 반환.

다만 WebView.jsx의 컨테이너는 **반드시 100% 높이**여야 한다:
```css
.webview-container {
  height: 100%;        /* ← 이미 설정됨 (global.css L342) */
  position: relative;  /* ← 추가 필요: 좌표 기준점 */
}
```

---

## 3. attach_smoke.py CDP Attach 가능성

### 3.1 현재 코드 흐름

```
main.js L11: app.commandLine.appendSwitch('remote-debugging-port', '9222')
  → Electron 프로세스 전체에 CDP 포트 노출
  → http://127.0.0.1:9222/json/version 접근 가능

ipc-handlers.js L289: env.CDP_ENDPOINT = 'http://127.0.0.1:9222'
  → Python subprocess에 환경변수 주입

attach_smoke.py:
  → create_cdp_connection(os.environ["CDP_ENDPOINT"])
  → pw.chromium.connect_over_cdp("http://127.0.0.1:9222")
  → browser.contexts[0].pages[0]
```

### 3.2 검증 결과

| 검증 항목 | 결과 | 비고 |
|---|---|---|
| CDP 포트 노출 | ✅ 동작 | `--remote-debugging-port` 스위치 설정됨 |
| 환경변수 주입 | ✅ 동작 | `CDP_ENDPOINT`, `CDP_PORT` 모두 전달 |
| connect_over_cdp 호출 | ✅ 코드 완성 | `browser.py` L170 |
| launch() 차단 | ✅ 동작 | monkey-patch 확인 |
| new_page() 차단 | ✅ 동작 | monkey-patch 확인 |

### 3.3 현재 attach_smoke.py가 실패하는 이유

**WebContentsView(쿠팡 사이트)가 아직 존재하지 않기 때문.**

현재 CDP attach 시:
```
browser.contexts = [
  context[0] = BrowserWindow의 React UI context
    └─ pages[0] = http://localhost:3000 (개발 서버) 또는 dist/index.html
]
```

WebContentsView 추가 후:
```
browser.contexts = [
  context[0] = BrowserWindow의 React UI context
    └─ pages[0] = http://localhost:3000
  context[1] = WebContentsView (partition: persist:vendor_basic)
    └─ pages[0] = https://supplier.coupang.com/...
]
```

### 3.4 필수 수정: Python 쪽 context 탐색

`get_existing_page(browser, context_index=0)` → **인덱스 하드코딩 제거**.
URL 기반 탐색으로 전환 필요 (위 1.4절 참조).

추가로 `python:run` 호출 시 현재 활성 벤더 정보를 환경변수로 전달해야 함:
```javascript
// ipc-handlers.js 수정 필요
env: {
  ...process.env,
  CDP_ENDPOINT: `http://127.0.0.1:${_cdpPort}`,
  COUPANG_VENDOR_ID: activeVendorId,  // ← 추가
}
```

---

## 4. 벤더 변경 시 Partition 검증 전략

### 4.1 벤더 변경 흐름

```
사용자가 VendorSelector에서 "canon" 선택
  │
  ▼
App.jsx: setVendor("canon")
  │
  ├─ WebView.jsx: vendor prop 변경 감지
  │   → IPC 'session:activate' (vendorId="canon")
  │     → Main: 기존 뷰 숨김/제거
  │     → Main: canon용 WebContentsView 생성 (partition: persist:vendor_canon)
  │     → Main: supplier.coupang.com 로드
  │     → Main: 뷰를 BrowserWindow에 attach
  │     → Renderer: bounds 전달
  │
  └─ WorkView.jsx: vendor prop 변경 감지 (기존 로직)
      → 해당 벤더 최신 Excel 로드
```

### 4.2 검증해야 할 항목

| 검증 | 방법 | 시점 |
|---|---|---|
| partition 이름 정확성 | `view.webContents.session.partition` 로그 확인 | 뷰 생성 시 |
| 세션 격리 | 벤더 A 로그인 → 벤더 B 전환 → 벤더 B는 미로그인 상태 확인 | 수동 테스트 |
| 쿠키 독립성 | `session.cookies.get({})` 비교 | 자동 테스트 가능 |
| 벤더 복귀 시 세션 유지 | A→B→A 전환 후 A 세션 여전히 유효 | 수동 테스트 |

### 4.3 구현 전략: 뷰 풀(Pool)

```javascript
// vendor-session.js
class VendorViewPool {
  // vendorId → WebContentsView (lazy 생성, 전환 시 재사용)
  _views = new Map();
  _active = null;

  getOrCreate(vendorId) {
    if (this._views.has(vendorId)) {
      return this._views.get(vendorId);
    }
    const view = new WebContentsView({
      webPreferences: {
        partition: `persist:vendor_${vendorId}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this._views.set(vendorId, view);
    return view;
  }

  activate(vendorId, parentView, bounds) {
    // 기존 활성 뷰 숨김 (bounds 0으로)
    if (this._active && this._active !== vendorId) {
      const oldView = this._views.get(this._active);
      if (oldView) {
        oldView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
    const view = this.getOrCreate(vendorId);
    parentView.addChildView(view);  // 이미 추가되어 있으면 무시됨
    view.setBounds(bounds);
    this._active = vendorId;
    return view;
  }
}
```

### 4.4 위험 요소

| 위험 | 심각도 | 대응 |
|---|---|---|
| **메모리 누수: 미사용 뷰 축적** | 중간 | 최대 보관 수 제한 (예: 5개). LRU 초과 시 `webContents.close()` |
| **벤더 삭제 시 고아 뷰** | 낮음 | `vendors:save` 핸들러에서 삭제된 벤더의 뷰 정리 |
| **동시 Python 실행 중 벤더 전환** | 높음 | Python 실행 중에는 벤더 전환 차단 또는 경고 |

---

## 5. supplier.coupang.com 로드 완료 대기 메커니즘

### 5.1 문제 정의

WebContentsView가 `supplier.coupang.com`을 로드할 때:
1. **Keycloak 리다이렉트**: 미로그인 → `login.coupang.com`으로 302 → 로그인 폼 표시
2. **SPA 부트스트랩**: 로그인 후 → `supplier.coupang.com` 도착 → React SPA 초기화 → DOM 렌더링
3. **Akamai 검증**: `_abck` 쿠키 생성을 위한 JS 실행

### 5.2 대기 전략 (계층적)

```
Level 1: webContents 'did-navigate' 이벤트
  → URL 변경 감지 (리다이렉트 추적)
  → Renderer에 현재 URL 상태 전송

Level 2: webContents 'did-finish-load' 이벤트
  → 페이지 로드 완료 (DOMContentLoaded 수준)
  → 그러나 SPA 동적 콘텐츠는 미완성일 수 있음

Level 3: webContents 'did-stop-loading' + polling
  → 네트워크 활동 중단
  → 추가로 page.evaluate()로 특정 셀렉터 존재 확인

Python 자동화 진입 시:
  → page.wait_for_load_state("networkidle") 또는
  → page.wait_for_selector(대상_셀렉터) 사용
```

### 5.3 Main process 구현

```javascript
// WebContentsView 생성 후
view.webContents.on('did-navigate', (event, url) => {
  sendToRenderer('session:navigated', { vendorId, url });

  // 세션 유효 판단
  if (url.includes('supplier.coupang.com')) {
    sendToRenderer('session:ready', { vendorId, url, status: 'valid' });
  } else if (url.includes('login.coupang.com') || url.includes('/auth/realms/')) {
    sendToRenderer('session:ready', { vendorId, url, status: 'login_required' });
  }
});

view.webContents.on('did-fail-load', (event, errorCode, errorDesc, validatedURL) => {
  sendToRenderer('session:error', {
    vendorId,
    errorCode,
    errorDesc,
    url: validatedURL,
  });
});
```

### 5.4 Renderer 상태 머신

```
WebView.jsx 내부 상태:

  IDLE          → 벤더 미선택 / 뷰 미생성
  LOADING       → WebContentsView가 URL 로드 중
  LOGIN_REQUIRED → Keycloak 로그인 페이지 도달
  READY         → supplier.coupang.com 로드 완료
  ERROR         → 로드 실패

상태 전이:
  IDLE → (벤더 선택) → LOADING
  LOADING → (did-navigate: supplier.coupang.com) → READY
  LOADING → (did-navigate: login.coupang.com) → LOGIN_REQUIRED
  LOADING → (did-fail-load) → ERROR
  LOGIN_REQUIRED → (Python 로그인 실행) → LOADING
  READY → (세션 만료 감지) → LOGIN_REQUIRED
```

### 5.5 위험 요소

| 위험 | 심각도 | 대응 |
|---|---|---|
| **SPA 내부 라우팅 → did-navigate 미발생** | 높음 | `did-navigate-in-page` 이벤트도 리스닝. 또는 polling 방식으로 URL 주기 감시 |
| **Akamai JS 실행 지연** | 중간 | `did-finish-load` 후 2초 추가 대기 |
| **무한 리다이렉트 루프** | 중간 | 리다이렉트 횟수 카운터 (5회 초과 시 ERROR) |
| **네트워크 타임아웃** | 낮음 | `did-fail-load` 핸들링 + 재시도 UI |

---

## 6. 종합 위험 매트릭스

| # | 위험 | 심각도 | 발생확률 | 대응 | 선행 작업 |
|---|---|---|---|---|---|
| **R1** | BrowserView deprecated (Electron 31) | **치명** | 확정 | WebContentsView 사용 | 설계 문서 갱신 |
| **R2** | CDP context 식별 실패 | 높음 | 높음 | URL 기반 context 탐색 | browser.py 수정 |
| **R3** | bounds 좌표 불일치 | 높음 | 중간 | ResizeObserver + debounce | WebView.jsx 구현 |
| **R4** | Python 실행 중 벤더 전환 | 높음 | 중간 | 전환 차단 UX | App.jsx 가드 |
| **R5** | SPA 라우팅 이벤트 누락 | 중간 | 높음 | did-navigate-in-page 리스닝 | Main 이벤트 등록 |
| **R6** | 벤더 풀 메모리 누수 | 중간 | 낮음 | LRU 풀 (최대 5개) | vendor-session.js |
| **R7** | DPI 스케일링 좌표 오차 | 중간 | 낮음 | CSS 픽셀 일관 사용 | 테스트 |

---

## 7. 선행 필수 작업 (Prerequisites)

### P1: Electron API 확인 (즉시)
- [ ] `WebContentsView` import 가능 확인
- [ ] `BrowserWindow.contentView.addChildView()` 동작 확인
- [ ] `webPreferences.partition` 적용 확인

### P2: Python context 탐색 개선 (browser.py 수정)
- [ ] `get_existing_page()` → URL 기반 탐색으로 리팩토링
- [ ] 현재 활성 벤더 환경변수(`COUPANG_VENDOR_ID`) 주입
- [ ] 기존 test_browser.py 테스트 통과 유지

### P3: IPC 채널 설계 확정
- [ ] `session:activate(vendorId)` → WebContentsView 생성/활성화
- [ ] `session:hide()` → bounds를 0으로
- [ ] `session:bounds(rect)` → bounds 업데이트
- [ ] `session:navigated` / `session:ready` / `session:error` (Main→Renderer)

### P4: 벤더 전환 가드
- [ ] Python 실행 중 벤더 전환 시 경고 모달
- [ ] 또는 Python 취소 후 전환

---

## 8. 예상 실장 순서

```
Phase A — 기반 구축 (2파일 신규, 2파일 수정)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. vendor-session.js (신규)
     └─ VendorViewPool 클래스
     └─ WebContentsView 생성/풀 관리
     └─ partition 매핑
     └─ bounds 설정

  2. main.js (수정)
     └─ WebContentsView import 추가
     └─ VendorViewPool 인스턴스화
     └─ createWindow 후 pool.setParent(mainWindow.contentView) 호출

  3. ipc-handlers.js (수정)
     └─ session:activate / session:hide / session:bounds 핸들러
     └─ session:navigated / session:ready 이벤트 송출
     └─ python:run에 COUPANG_VENDOR_ID 환경변수 추가

  4. preload.js (수정)
     └─ activateSession / hideSession / setSessionBounds API 노출
     └─ onSessionNavigated / onSessionReady 이벤트 리스너


Phase B — Renderer 통합 (2파일 수정)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  5. WebView.jsx (전면 재작성)
     └─ useRef → containerDiv 참조
     └─ useEffect: mount 시 session:activate IPC
     └─ ResizeObserver + window resize → session:bounds IPC
     └─ 상태 머신: IDLE/LOADING/LOGIN_REQUIRED/READY/ERROR
     └─ 상태별 오버레이 UI (로딩 스피너, 로그인 필요 알림 등)

  6. App.jsx (수정)
     └─ 탭 전환 시 session:hide / session:bounds 호출
     └─ Python 실행 중 벤더 전환 가드


Phase C — Python 측 수정 (1파일 수정, 1파일 신규)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  7. python/common/browser.py (수정)
     └─ find_supplier_page(browser) 신규 함수
     └─ get_existing_page → find_supplier_page 폴백 추가

  8. python/scripts/login_smoke.py (신규)
     └─ CDP attach → 로그인 페이지 판별 → ensure_logged_in 호출
     └─ 세션 유효 확인 → 로그 출력


Phase D — 통합 테스트 (검증)
━━━━━━━━━━━━━━━━━━━━━━━━━━━

  9.  수동 테스트: 앱 실행 → 벤더 선택 → 웹 뷰에 쿠팡 사이트 표시
  10. 수동 테스트: 윈도우 리사이즈 → 뷰 크기 동기화
  11. 수동 테스트: 탭 전환 → 뷰 숨김/표시
  12. 수동 테스트: 벤더 전환 → partition 격리 확인
  13. 자동 테스트: test-cdp-attach.js 업데이트 → context 탐색 검증
```

---

## 9. 최종 결론

| 항목 | 판정 | 핵심 근거 |
|---|---|---|
| **(1) Partition 격리** | ✅ 타당 | Electron `persist:` partition은 완전 격리. 명명 규칙 안전. |
| **(2) Bounds 동기화** | ⚠️ 구현 필요 | ResizeObserver + IPC 패턴은 표준적. 단, DPI/DevTools 엣지케이스 테스트 필수. |
| **(3) CDP Attach** | ⚠️ 조건부 가능 | CDP 포트는 동작하나, context 식별 로직 수정 필수 (URL 기반 탐색). |
| **(4) 벤더 전환 검증** | ✅ 전략 확립 | 뷰 풀 + LRU + partition 확인 로그. Python 실행 중 전환 가드 필요. |
| **(5) 로드 완료 대기** | ✅ 설계 완료 | did-navigate + 상태 머신. SPA in-page 라우팅 대응 추가 필요. |
| **⚠ BrowserView deprecated** | **치명적 변경** | **Electron 31에서 deprecated. WebContentsView로 전환 필수.** |
