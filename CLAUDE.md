# 쿠팡 서플라이어 허브 Electron 자동화 앱

## 아키텍처 핵심

### CDP Attach 모델
- Playwright는 Electron 내장 Chromium 또는 사용자 Chrome에 `connect_over_cdp`로 붙는다
- Playwright가 직접 Chromium을 launch하면 Akamai Bot Manager에 탐지됨 → 반드시 attach 방식
- Keycloak OAuth2 SPA: access_token이 JS 메모리에만 존재 → `context.pages[0]` 재사용 필수, 새 탭 금지

### 프로세스 구조
- **Main process**: IPC 허브, Python subprocess 관리, 파일 I/O, 벤더 설정 관리
- **Renderer (React)**: 웹 뷰(BrowserView) + 작업 뷰(editable table) 탭 구조
- **Python subprocess**: Playwright 자동화 로직 (기존 코드 재사용)

### 뷰 구분
| 뷰 | 역할 |
|---|---|
| 웹 뷰 | Playwright 동작 실시간 확인, 위험 동작(적용 버튼 등) 3초 카운트다운 후 실행, 사용자 중단 가능 |
| 작업 뷰 | 작업 로그, editable table, 쿠팡 양식/통합 양식 다운로드 |

### 데이터 흐름
1. 자동화 실행 → 2. 웹 뷰 동작 확인 → 3. 작업 뷰에서 사람이 검토·수정 → 4. 수정 내용 반영해 다음 스텝 실행

## 스택
- Electron (Main + Renderer)
- React (Renderer UI)
- Python + Playwright (자동화 subprocess)
- Node.js child_process (Python 브릿지)
- xlsx 라이브러리 (Excel 읽기/쓰기)
- JSON 파일 (벤더 설정, 로컬 저장)

## 도메인 규칙

### 자동화 대상
| 작업 | URL 패턴 | 핵심 동작 |
|---|---|---|
| PO SKU 다운로드 | `/scm/purchase/order/sku/list` | 쿼리파라미터 날짜/상태 필터 → 다운로드 버튼 → 파일 polling |
| 발주확정 업로드 | `/scm/purchase/upload/form` | #btn-upload-show → 약관동의(JS) → 파일 input → #btn-upload-execute |
| 밀크런 배치등록 | `/milkrun/batchRegister` | enabled 행 순회 → 출고지/박스/중량/팔레트 자동입력 |

### 쿠팡 사이트 함정 (반드시 준수)
- **Bootstrap 모달 좀비**: `.modal-backdrop` 잔존 → JS로 강제 제거
- **display:none 체크박스**: `.click()` 불가 → `evaluate()`로 JS 직접 조작
- **모달 fade-in 지연**: 페이지 로드 직후 동작 시도 금지 → polling 대기
- **SPA 내부 라우팅**: `page.goto()` 리다이렉트 가로채짐 → `location.replace()` 폴백
- **Akamai 쿠키** (`_abck`, `bm_sz`): CDP attach 필수, 직접 launch 절대 금지

### 로그인 흐름
- 셀렉터: `#username`, `#password`, `#kc-login`
- 비밀번호 만료 페이지 → "Change My Password Later" / "나중에 변경하기" 자동 클릭
- 세션 유효 판단: URL에 `supplier.coupang.com` 포함 여부
- 자격증명: `COUPANG_ID_{VENDOR}`, `COUPANG_PW_{VENDOR}` 형태

### 벤더 관리
- 벤더 목록: 로컬 `vendors.json` (추후 DB화 가능)
- 앱 시작 시 드롭다운 선택 + UI에서 추가 가능
- 벤더별: 별도 Electron partition(세션 격리) + 별도 자격증명

### 파일 저장 규칙
- 저장 위치: `C:\Users\{username}\AppData\Local\CoupangAutomation\` (없으면 자동 생성)
- 파일명 패턴: `{vendor}-{YYYYMMDD}-{차수:02d}.xlsx`
- 유니크 키: vendor + 날짜 + 차수 (중복 시 덮어쓰기)
- **쿠팡 양식**: 쿠팡 제출용 고정 포맷
- **통합 양식**: 내부 현황 + DB 대체 편의 포맷

### 납품여부 결정 흐름 (사람 개입)
- PO 다운 → 작업 뷰에서 상품별 납품여부(보냄/반려) 사람이 직접 선택 → 선택 완료 후 자동 등록
- 로컬 Excel 자동 저장 및 재시작 시 불러오기 동기화

## DoD 패턴
- 모든 자동화 액션은 IPC 이벤트로 Main ↔ Renderer 통신
- Python subprocess stdout/stderr는 작업 뷰 로그로 스트리밍
- 위험 동작(Submit/적용) 실행 전 3초 카운트다운 UI 표시 + 취소 버튼 노출
- 로컬 저장 데이터는 JSON/Excel 모두 스키마 버전 필드 포함 (추후 DB 마이그레이션 대비)
- 벤더 설정은 항상 `vendors.json` 단일 파일로 관리, 직접 파일 편집 없이 UI로만