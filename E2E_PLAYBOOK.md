# E2E 플레이북 — 쿠팡 서플라이어 허브 Electron 자동화 앱

> **Phase 1 DoD 검증**: 앱 실행 → 벤더 선택 → PO 다운로드 실행 → 작업 뷰에 데이터 표시 → Excel 저장 → 재시작 후 동일 데이터 복원

이 플레이북은 **2명 이상이 독립적으로 재현 가능**하도록 설계되었습니다.
모든 명령어는 Windows 환경(PowerShell) 기준이며, 프로젝트 루트는 `C:\workspace\coupang-supplier-electron-automation` 입니다.

---

## 사전 요구사항

| 항목 | 최소 버전 | 확인 명령어 |
|------|-----------|-------------|
| Node.js | 18+ | `node --version` |
| Python | 3.9+ | `python --version` |
| Git | any | `git --version` |
| Chrome/Chromium | any | 시스템에 설치되어 있거나 Playwright Chromium 사용 |

### 환경변수 설정 (PowerShell)

```powershell
# 벤더 자격증명 (테스트용 — 실제 값으로 교체)
$env:COUPANG_ID_BASIC = "your_coupang_id"
$env:COUPANG_PW_BASIC = "your_coupang_password"
```

---

## Step 0: 프로젝트 설치 및 환경 검증

### 수행 명령어

```powershell
cd C:\workspace\coupang-supplier-electron-automation

# 1. Node.js 의존성 설치
npm install

# 2. Python venv 생성 및 의존성 설치
python -m venv python/.venv
python\.venv\Scripts\Activate.ps1
pip install -r python/requirements.txt
playwright install chromium
deactivate

# 3. Renderer 빌드
npm run build:renderer

# 4. 환경 검증 (preflight)
node preflight.js

# 5. Python 환경 검증
npm run python:hello
```

### 기대 출력

**preflight 성공 시:**
```
  ✔ PASS  [python-venv]
         venv 확인됨: ...\python\.venv\Scripts\python.exe

  ✔ PASS  [playwright-chromium]
         playwright + chromium 확인됨

  ⚠ WARN  [cdp-port-9222]
         localhost:9222 미응답. Chrome을 --remote-debugging-port=9222 로 실행하세요.
```

> CDP 포트 WARN은 이 시점에서 정상 — Step 1에서 Chrome을 시작합니다.

**python:hello 성공 시:**
```json
{"type": "log", "data": "Python 버전: 3.11.x ..."}
{"type": "log", "data": "playwright.sync_api import 성공"}
{"type": "log", "data": "hello.py 종료 — 모든 검증 항목 실행 완료"}
```

### 예상 오류 및 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `python-venv` FAIL | venv 미생성 | `python -m venv python/.venv` 실행 |
| `playwright-chromium` FAIL | Chromium 미설치 | venv 활성화 후 `playwright install chromium` |
| `npm install` ENOENT | Node.js 미설치 | [nodejs.org](https://nodejs.org) 에서 18+ 설치 |
| `build:renderer` 실패 | webpack 의존성 누락 | `npm install` 재실행 |
| `python:hello` "Python not found" | Python 경로 미탐지 | `$env:PYTHON_BIN = "C:\...\python.exe"` 설정 |

---

## Step 1: Chrome 원격 디버깅 모드 시작

### 수행 명령어

```powershell
# 별도 터미널에서 실행 (앱과 독립적으로 유지)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    --remote-debugging-port=9222 `
    --no-first-run `
    --no-default-browser-check `
    "https://supplier.coupang.com"
```

> **Playwright Chromium 사용 시** (Chrome 미설치 환경):
> ```powershell
> # Playwright Chromium 경로 확인
> python -c "from playwright.sync_api import sync_playwright; pw=sync_playwright().start(); print(pw.chromium.executable_path); pw.stop()"
>
> # 출력된 경로로 실행
> & "C:\Users\...\chromium-1148\chrome-win\chrome.exe" --remote-debugging-port=9222 --no-first-run "https://supplier.coupang.com"
> ```

### 기대 결과

- Chrome 창이 열리며 `https://supplier.coupang.com`으로 이동
- Keycloak 로그인 페이지로 리다이렉트됨 (또는 이미 로그인된 상태면 서플라이어 허브 표시)
- CDP 엔드포인트 활성화 확인:

```powershell
# 별도 터미널에서 확인
Invoke-RestMethod http://127.0.0.1:9222/json/version
```

**기대 응답:**
```json
{
  "Browser": "Chrome/131.x.x.x",
  "Protocol-Version": "1.3",
  "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/..."
}
```

### 예상 오류 및 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| Chrome 창 안 열림 | Chrome 경로 오류 | `where chrome` 또는 직접 경로 확인 |
| "address already in use" | 9222 포트 점유 | `netstat -ano \| findstr 9222` → 기존 프로세스 종료 |
| CDP 응답 없음 | `--remote-debugging-port` 누락 | 명령어에 플래그 포함 확인 |
| SSL 오류 | 기업 프록시/방화벽 | `--ignore-certificate-errors` 추가 (테스트 환경만) |

---

## Step 2: Electron 앱 시작

### 수행 명령어

```powershell
# 프로젝트 루트에서
npm start

# 또는 개발 모드 (HMR 지원):
# npm run dev
```

### 기대 결과

- Electron 창이 열림
- 상단에 **탭 네비게이션**: "웹 뷰" / "작업 뷰"
- **벤더 선택 드롭다운**이 표시됨
- 앱 타이틀 바에 **"쿠팡 서플라이어 자동화"** 표시

**개발 모드 DevTools 검증** (`Ctrl+Shift+I` → Console 탭):
```
[IPC] registerIpcHandlers — ready
[App] dataDir: C:\Users\{username}\AppData\Local\CoupangAutomation
[App] cdpPort: 9222
```
> 위 로그가 보이면 IPC 핸들러와 데이터 경로가 정상 초기화된 것입니다.
> 로그가 없어도 탭·드롭다운이 보이면 진행 가능합니다.

### 예상 오류 및 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 빈 흰 화면 | Renderer 빌드 안 됨 | `npm run build:renderer` 후 재시작 |
| `dist/index.html` not found | 빌드 산출물 없음 | `npm run build:renderer` 실행 |
| "Cannot find module 'electron'" | 의존성 누락 | `npm install` 재실행 |
| DevTools 에러: "PYTHON_BIN" | Python 미탐지 | `$env:PYTHON_BIN` 설정 또는 venv 생성 |

---

## Step 3: 벤더 선택 및 자격증명 확인

### UI 조작

1. 상단 **벤더 드롭다운** 클릭
2. `basic` 벤더 선택 (없으면 "+" 버튼으로 추가: ID=`basic`, 이름=`BASIC`)
3. "작업 뷰" 탭으로 전환

### 기대 결과

**작업 뷰 로그 패널에 표시:**
```
[INFO] 작업 뷰가 초기화되었습니다.
[INFO] [basic] 저장된 파일 없음 — 빈 테이블 표시
```

**도구 모음 상태:**
- 세션 배지: "— 상태 미확인" (아직 세션 미확인)
- PO 다운로드 버튼: 활성화
- 쿠팡/통합 양식 저장 버튼: 비활성 (데이터 없음)

**자격증명 미설정 시:**
```
[WARN] 자격증명 미설정: COUPANG_ID_BASIC, COUPANG_PW_BASIC 환경변수를 설정하세요.
```
→ "⚠ 자격증명 미설정" 경고 표시, 로그인 버튼 비활성

### 예상 오류 및 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 벤더 드롭다운 비어있음 | vendors.json 없음 | UI에서 벤더 추가 또는 앱이 자동 생성 |
| "자격증명 미설정" 경고 | 환경변수 누락 | PowerShell에서 `$env:COUPANG_ID_BASIC` 설정 후 앱 재시작 |
| 세션 배지 "✕ 오류" | CDP 포트 미응답 | Step 1의 Chrome이 실행 중인지 확인 |

---

## Step 4: 로그인 실행

### UI 조작

1. 작업 뷰에서 **🔑 로그인** 버튼 클릭
2. 로그 패널에서 진행 상황 실시간 확인
3. 동시에 Step 1에서 열린 Chrome 창 확인 — Keycloak 폼이 자동 입력됨

### 기대 로그 (성공 시)

```
[INFO] 로그인 시작: 벤더 'basic'
[INFO] 로그인 프로세스 시작됨 (pid=12345)
[INFO] [system] Python process started (pid=12345, script=scripts/login.py)
[INFO] 자격증명 확인 완료: you***
[INFO] CDP 연결 시도: http://127.0.0.1:9222
[INFO] CDP 연결 성공 — contexts: 1, pages: 1
[INFO] 기존 페이지 재사용: https://login.coupang.com/auth/...
[INFO] Keycloak 로그인 페이지 감지 — 로그인 진행
[INFO] 로그인 폼 입력 시작
[INFO] 아이디 입력 완료
[INFO] 비밀번호 입력 완료 (값 마스킹)
[INFO] 로그인 버튼 클릭
[INFO] [Session Valid: True] Current URL: https://supplier.coupang.com/...
[INFO] [Login Complete] vendor=basic, URL=https://supplier.coupang.com/...
[INFO] [system] Python 정상 종료 (exitCode=0)
```

**세션 배지 변화:**
`— 상태 미확인` → `◌ 로그인 중...` → `● 세션 유효`

### 예상 오류 및 트러블슈팅

| 증상 | 로그 메시지 | 해결 |
|------|-------------|------|
| CDP 연결 실패 | `CDP 연결 실패: connect ECONNREFUSED` | Step 1에서 Chrome 실행 확인 |
| 비밀번호 만료 | `비밀번호 만료 페이지 감지` → 자동 처리 | 정상 동작 — "나중에 변경하기" 자동 클릭 |
| 로그인 실패 | `로그인 실패: Invalid credentials` | `$env:COUPANG_ID_BASIC`, `$env:COUPANG_PW_BASIC` 확인 |
| 이미 실행 중 | `Python process already running` | 기존 프로세스 완료 대기 또는 ⏹ 취소 클릭 |
| 세션 확인만 됨 | `[Session Valid] 기존 세션 유효` | 이미 로그인됨 — 정상 동작 |

---

## Step 5: PO SKU 다운로드 실행

### UI 조작

1. 작업 뷰에서 **📦 PO 다운로드** 버튼 클릭
2. **3초 카운트다운 모달** 표시 — "PO SKU 다운로드" 확인
3. 카운트다운 완료 또는 "확인" 클릭

### 기대 로그 (성공 시)

```
[INFO] PO 다운로드 시작: 벤더 'basic'
[INFO] PO 다운로드 프로세스 시작됨 (pid=12346)
[INFO] ============================================================
[INFO] po_download.py — PO SKU 다운로드 자동화
[INFO]   벤더: basic
[INFO]   기간: 2026-04-15 ~ 2026-04-15
[INFO] ============================================================
[INFO] [STEP:CDP_CONNECT:START]
[INFO] [STEP:CDP_CONNECT:OK] http://127.0.0.1:9222
[INFO] [STEP:PAGE_ACQUIRE:OK] URL: https://supplier.coupang.com/...
[INFO] [STEP:LOGIN:START] 벤더 'basic' 로그인 확인
[INFO] [STEP:LOGIN:OK] 로그인 성공
[INFO] [STEP:NAVIGATE:START] https://supplier.coupang.com/scm/purchase/order/sku/list
[INFO] [STEP:NAVIGATE:OK] https://supplier.coupang.com/scm/purchase/order/sku/list
[INFO] [STEP:FILTER:START] 2026-04-15 ~ 2026-04-15
[INFO] [STEP:FILTER:OK]
[INFO] [STEP:SEARCH:START]
[INFO] [STEP:SEARCH:OK]
[INFO] [STEP:DOWNLOAD:START]
[INFO] 다운로드 버튼 발견 (셀렉터: #downloadBtn)
[INFO] [STEP:DOWNLOAD:OK] 저장: ...\basic-20260415-01.xlsx
[INFO] [STEP:SAVE:OK] ...\basic-20260415-01.xlsx
[INFO] [STEP:RESULT:START]
[INFO] [STEP:RESULT:OK] 파일: basic-20260415-01.xlsx
[INFO] [PO Download Complete] basic-20260415-01.xlsx
[INFO] [system] Python 정상 종료 (exitCode=0)
[INFO] [PO 완료] 최신 파일 로드: basic-20260415-01.xlsx
[INFO] 파일 로드: basic-20260415-01.xlsx (15행, schemaVersion=1)
```

### 기대 결과 확인

- **테이블**: PO 번호, SKU ID, 상품명, 수량, 납품여부 컬럼에 데이터 표시
- **상태 바**: `basic-20260415-01.xlsx | 저장: 오후 2:30:00`
- **도구 모음**: 쿠팡/통합 양식 저장 버튼 **활성화**
- **파일 시스템**:
  ```powershell
  dir $env:LOCALAPPDATA\CoupangAutomation\basic-*.xlsx
  # 출력: basic-20260415-01.xlsx
  ```

### 예상 오류 및 트러블슈팅

| 증상 | 로그 마커 | 해결 |
|------|-----------|------|
| 다운로드 버튼 미발견 | `[STEP:DOWNLOAD:FAIL]` → `[STEP:EXTRACT:START]` | 폴백으로 테이블 직접 추출 시도 (정상 동작) |
| 세션 만료 | `[STEP:LOGIN:FAIL]` | Step 4 로그인 재실행 |
| PO 데이터 없음 | `[STEP:EXTRACT:FAIL] 테이블 데이터 없음` | 쿠팡 사이트에서 해당 날짜 PO 존재 확인 |
| 네비게이션 실패 | `[STEP:NAVIGATE:FAIL]` | Chrome 창에서 수동으로 URL 확인 |
| 3초 카운트다운 중 취소 | 로그에 "취소됨: PO SKU 다운로드" | 정상 동작 — 다운로드 미실행 |
| 테이블에 데이터 안 뜸 | `파일 로드` 로그 없음 | `type=result` JSON 파싱 실패 → 로그에서 result 메시지 확인 |

---

## Step 6: 작업 뷰에서 데이터 편집

### UI 조작

1. 테이블의 **납품여부** 컬럼 클릭 (현재 빈 칸 또는 기존 값)
2. 값 입력: `보냄`, `반려`, 또는 `미정`
3. 여러 행의 납품여부를 수정

### 기대 결과

- 셀 편집 즉시: 상태 바에 **● 미저장** 표시
- 편집 후 **2초 경과**: 자동 저장 실행

**자동 저장 로그:**
```
[INFO] [자동 저장] basic-20260415-01.xlsx
```

- 상태 바: `basic-20260415-01.xlsx | 저장: 오후 2:32:15`
- **● 미저장** 표시 사라짐

**파일 확인:**
```powershell
# 파일 수정 시각 확인
(Get-Item "$env:LOCALAPPDATA\CoupangAutomation\basic-20260415-01.xlsx").LastWriteTime
```

### 예상 오류 및 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 납품여부 외 컬럼 편집 불가 | `editable: false` 설정 | 정상 동작 — PO번호/SKU 등은 읽기 전용 |
| 자동 저장 안 됨 | rows가 비어있거나 vendor 미선택 | 벤더 선택 + 데이터 존재 확인 |
| "저장 실패" 로그 | 디스크 권한 문제 | `CoupangAutomation` 폴더 쓰기 권한 확인 |

---

## Step 7: 쿠팡/통합 양식으로 새 차수 저장

### UI 조작

1. **📥 쿠팡 양식 저장** 버튼 클릭
2. 3초 카운트다운 모달에서 확인
3. (선택) **📥 통합 양식 저장** 버튼으로 추가 저장

### 기대 결과

**쿠팡 양식 저장 로그:**
```
[INFO] 쿠팡 양식 저장: basic-20260415-02.xlsx
```

**통합 양식 저장 로그:**
```
[INFO] 통합 양식 저장: basic-20260415-03.xlsx
```

**파일 시스템 확인:**
```powershell
dir $env:LOCALAPPDATA\CoupangAutomation\basic-20260415-*.xlsx
# 출력:
#   basic-20260415-01.xlsx   ← 원본 (PO 다운로드 + 편집)
#   basic-20260415-02.xlsx   ← 쿠팡 양식 (5컬럼: PO번호, SKU, 상품명, 수량, 납품여부)
#   basic-20260415-03.xlsx   ← 통합 양식 (7컬럼: + 수정시각, 메모)
```

**차수 증가 규칙 확인:**
- Step 5에서 01 생성 → 쿠팡 양식 = 02 → 통합 양식 = 03
- 이후 셀 편집 자동 저장은 **03에 덮어쓰기** (새 차수 아님)

### 예상 오류 및 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 버튼 비활성 | 테이블 데이터 없음 | Step 5 PO 다운로드 먼저 실행 |
| 차수 99 초과 | 하루 99회 이상 저장 | 이전 날짜 파일 정리 (수동) |
| Excel 열기 오류 | 파일 잠금 (다른 프로그램) | Excel에서 파일 닫기 후 재시도 |

---

## Step 8: 앱 종료 및 재시작

### 수행 절차

1. **Electron 앱 종료**: 창 닫기 또는 `Ctrl+Q`
2. Chrome은 **종료하지 않음** (CDP 세션 유지)
3. **앱 재시작**: `npm start`

### 기대 결과

앱이 재시작되면 **벤더 선택 → 최신 파일 자동 로드** 흐름이 동작합니다.

벤더 `basic`을 다시 선택하면:

```
[INFO] 작업 뷰가 초기화되었습니다.
[INFO] 파일 로드: basic-20260415-03.xlsx (15행, schemaVersion=1)
```

- Step 7에서 마지막으로 저장한 **03번 차수 파일**이 자동 로드됨
- 테이블에 **편집했던 납품여부 값**이 그대로 복원됨
- 상태 바: `basic-20260415-03.xlsx`

### 예상 오류 및 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 데이터 복원 안 됨 | 자동 저장이 실행되기 전에 앱 종료 | 종료 전 `● 미저장` 표시 없는지 확인 |
| 빈 테이블 | 다른 벤더 선택 상태 | `basic` 벤더 재선택 |
| "파일 읽기 실패" | xlsx 파일 손상 | 이전 차수 파일로 복구 가능 (01, 02) |
| "저장된 파일 없음" | COUPANG_DATA_DIR 변경 | 환경변수 또는 AppData 경로 확인 |

---

## Step 9: 데이터 무결성 최종 검증

### 수행 절차

```powershell
# 1. 파일 목록 확인
dir "$env:LOCALAPPDATA\CoupangAutomation\basic-20260415-*.xlsx"

# 2. 최신 파일 내용 검증 (Python으로)
python -c "
import os, openpyxl
data_dir = os.path.join(os.environ['LOCALAPPDATA'], 'CoupangAutomation')
wb = openpyxl.load_workbook(os.path.join(data_dir, 'basic-20260415-03.xlsx'))
print('시트 목록:', wb.sheetnames)

# data 시트
ws = wb['data']
print(f'행 수: {ws.max_row - 1} (헤더 제외)')
print(f'헤더: {[cell.value for cell in ws[1]]}')

# 첫 번째 데이터 행
if ws.max_row > 1:
    print(f'첫 행: {[cell.value for cell in ws[2]]}')

# _meta 시트
meta = wb['_meta']
for row in meta.iter_rows(values_only=True):
    print(f'  {row[0]}: {row[1]}')
"
```

### 기대 출력

```
시트 목록: ['data', '_meta']
행 수: 15 (헤더 제외)
헤더: ['PO 번호', 'SKU ID', '상품명', '수량', '납품여부']
첫 행: ['PO-2026-001', 'SKU-A001', '테스트 상품', 100, '보냄']
  schemaVersion: 1
  format: coupang
  vendor: basic
  date: 20260415
  sequence: 3
  savedAt: 2026-04-15T14:32:15.000Z
  columns: ["poNumber","skuId","productName","quantity","deliveryStatus"]
```

### 검증 체크리스트

- [ ] `schemaVersion`이 1인가?
- [ ] `format`이 `coupang` 또는 `integrated`인가?
- [ ] `vendor`가 선택한 벤더와 일치하는가?
- [ ] `sequence`가 파일명의 차수와 일치하는가?
- [ ] `savedAt`이 최근 시각인가?
- [ ] 납품여부 컬럼에 Step 6에서 입력한 값이 있는가?
- [ ] 데이터 행 수가 PO 다운로드 결과와 일치하는가?

---

## Step 10: 오프라인 회귀 테스트 실행

실제 쿠팡 서버 없이도 전체 흐름을 자동 검증합니다.

### 수행 명령어

```powershell
# 오프라인 PO 다운로드 회귀 테스트
npm run test:po-download:offline

# 기존 단위 테스트
npm run test:po-download
```

### 기대 출력 (오프라인 테스트)

```
=======================================================
  PO 다운로드 오프라인 회귀 테스트
=======================================================

-- Prerequisites --
  [ok] openpyxl 3.1.5
  [ok] playwright ?
  [ok] Chromium: C:\Users\...\chrome-win\chrome.exe

=======================================================
  Test 1: 전체 다운로드 흐름
=======================================================
  [PASS] chromium -- chrome.exe
  [PASS] fixture-xlsx
  [PASS] fixture-server -- port=54927
  [PASS] cdp-ready -- port=54929
  [PASS] exit-code-0
  [PASS] step:CDP_CONNECT:OK
  [PASS] step:PAGE_ACQUIRE:OK
  [PASS] step:LOGIN:SKIP
  [PASS] step:NAVIGATE:OK
  [PASS] step:FILTER:OK
  [PASS] step:SEARCH:OK
  [PASS] download-or-extract -- EXTRACT:OK (fallback)
  [PASS] step:RESULT:OK
  [PASS] output-file -- testvendor-20260415-01.xlsx
  [PASS] output-readable -- sheets=['data', '_meta']
  [PASS] result-json-success

=======================================================
  Test 2: 테이블 추출 폴백
=======================================================
  [PASS] fixture-server -- port=55646 (no-download)
  [PASS] cdp-ready
  [PASS] exit-code-0
  [PASS] extract-fallback
  [PASS] output-file -- testvendor-20260415-01.xlsx

=======================================================
  Result: 21 passed, 0 failed, 0 skipped
=======================================================
```

### 기대 출력 (단위 테스트)

```
============================================================
  결과: 총 44개 | ✅ 44개 통과 | ❌ 0개 실패
============================================================
```

### 예상 오류 및 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| "openpyxl missing" | pip 의존성 누락 | venv 활성화 후 `pip install openpyxl` |
| "Chromium not installed" | Playwright 브라우저 미설치 | `playwright install chromium` |
| CDP timeout | 포트 충돌 | 다른 Chrome/Electron 인스턴스 종료 |
| cp949 UnicodeDecodeError | Windows 인코딩 | 테스트에 `encoding='utf-8'` 이미 적용됨 — 최신 코드 확인 |

---

## 부록 A: 전체 흐름 요약도

```
                      ┌──────────────────────────────┐
                      │  Step 0: 환경 설치/검증       │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 1: Chrome CDP 시작      │
                      │  --remote-debugging-port=9222 │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 2: Electron 앱 시작     │
                      │  npm start                    │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 3: 벤더 선택            │
                      │  basic → 자격증명 확인         │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 4: 로그인               │
                      │  Keycloak → supplier.coupang   │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 5: PO 다운로드          │
                      │  → basic-20260415-01.xlsx      │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 6: 데이터 편집          │
                      │  납품여부 수정 → 자동 저장     │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 7: 양식 저장            │
                      │  쿠팡(02) / 통합(03) 차수     │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 8: 앱 재시작            │
                      │  자동 로드: 03 파일 복원       │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 9: 데이터 무결성 검증   │
                      │  schemaVersion + 납품여부 확인 │
                      └─────────────┬────────────────┘
                                    ▼
                      ┌──────────────────────────────┐
                      │  Step 10: 오프라인 회귀 테스트 │
                      │  21/21 PASS + 44/44 PASS       │
                      └────────────────────────────────┘
```

---

## 부록 B: 핵심 파일 경로 참조

| 구분 | 파일 | 역할 |
|------|------|------|
| **Electron Main** | `main.js` | CDP 포트 설정, 창 생성, IPC 등록 |
| **IPC 핸들러** | `ipc-handlers.js` | Python 브릿지, 파일 I/O, 벤더 관리 |
| **보안 브릿지** | `preload.js` | contextBridge API 노출 |
| **작업 뷰** | `src/components/WorkView.jsx` | 테이블+로그+자동저장+PO다운로드 |
| **편집 테이블** | `src/components/EditableTable.jsx` | 셀 편집 UI |
| **Excel 직렬화** | `src/lib/excelFormats.js` | xlsx ↔ rows 변환 |
| **파일명 규칙** | `src/lib/vendorFiles.js` | 차수 계산, 최신 파일 탐색 |
| **PO 다운로드** | `python/scripts/po_download.py` | Playwright 자동화 |
| **CDP 연결** | `python/common/browser.py` | connect_over_cdp, 가드 |
| **로그인** | `python/common/login.py` | Keycloak OAuth2 |
| **IPC 프로토콜** | `python/common/ipc.py` | JSON-line stdout |
| **데이터 디렉토리** | `%LOCALAPPDATA%\CoupangAutomation\` | xlsx 저장 위치 |

---

## 부록 C: 주요 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `COUPANG_ID_{VENDOR}` | ✅ | — | 벤더별 로그인 ID |
| `COUPANG_PW_{VENDOR}` | ✅ | — | 벤더별 비밀번호 |
| `CDP_PORT` | — | `9222` | Chrome 원격 디버깅 포트 |
| `PYTHON_BIN` | — | 자동 탐지 | Python 인터프리터 절대 경로 |
| `COUPANG_DATA_DIR` | — | `%LOCALAPPDATA%\CoupangAutomation` | 앱 시작 시 자동 설정 (미설정 시 `AppData\Local\CoupangAutomation` 사용) |
