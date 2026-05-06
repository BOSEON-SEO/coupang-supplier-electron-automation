# V4 마이그레이션 맵 — feat/new-ui-v4

본 프로젝트의 현재 IPC/컴포넌트 인벤토리와 v4 셸/모델로의 매핑. M1 이후 작업 가이드.

## 1. IPC 채널 매핑

### 그대로 유지 (변경 0)

| 채널 | 비고 |
|---|---|
| `vendors:load`, `vendors:save` | vendors.json 파일 그대로 |
| `settings:load`, `settings:save` | settings.json 그대로 |
| `jobs:list`, `jobs:listMonth`, `jobs:listFiles`, `jobs:loadManifest`, `jobs:create`, `jobs:updateManifest`, `jobs:complete`, `jobs:delete`, `jobs:recordUpload`, `jobs:deleteUploadHistory` | manifest.json 그대로. DB `jobs_index` 는 인덱스 캐시로만 |
| `file:*` (10개) | 파일 I/O 그대로 |
| `python:run`, `python:cancel`, `python:status`, `python:detectPath` | 자동화 엔진 변경 0 |
| `credentials:check/save/delete`, `session:check` | 인증 그대로 |
| `confirmation:patchQuantities` | ReviewStep 에서 호출 |
| `confirmedQty:sync` | ConfirmStep 에서 호출 |
| `eflex:recordOutbound` | 인박스/lot 액션에서 호출 |
| `poTbnws:patchFulfillExport` | 그대로 |
| `tbnwsCoupangExport:generate/apply/reset/zeroOutUnmatched` | 인박스 toolbar 액션으로 노출만 변경 |
| `palletList:generate` | `lots:upload(milk)` 내부에서 호출 |
| `find:query/close`, `find:onOpen/onResult` | Ctrl+F 그대로 |
| `webview:setVendor/setBounds/setVisible/navigate/reload/getUrl/onUrlChanged` | 우측 슬라이드 패널에 attach (드래그 리사이즈 포함) |
| `plugin:<id>:<channel>` | 그대로, hook 종류만 추가 |
| `license:get/activate/reverify/clear/onChanged` | 그대로 |
| `update:get/check/download/install/onStatus` | 그대로 |
| `action:confirmDangerous` | 그대로 |
| `python:log`, `python:error`, `python:done` | 로그 패널로 스트리밍 |

### 신규 추가 (DB-backed)

| 채널 | 핸들러 위치 | 동작 |
|---|---|---|
| `pos:listAll(vendor)` | `ipc/pos.js` | 전체 PO (배정+orphan) |
| `pos:listByJob(vendor, date, seq)` | `ipc/pos.js` | 특정 차수 PO |
| `pos:listOrphans(vendor)` | `ipc/pos.js` | 미배정 PO |
| `pos:refresh(vendor, source, fromTime)` | `ipc/pos.js` | 쿠팡 갱신 → DB upsert + python `po_download` 호출 |
| `pos:assignToJob(vendor, posIds, date, seq)` | `ipc/pos.js` | 미배정 PO 를 차수에 묶음 |
| `pos:unassign(posIds)` | `ipc/pos.js` | 차수 해제 → orphan 으로 |
| `inbox:list(vendor, kind, date, seq)` | `ipc/inbox.js` | 인박스 (qty=0 포함) |
| `inbox:exclude(vendor, kind, date, seq, ids)` | `ipc/inbox.js` | 차수에서 제외 (orphan 환원) |
| `inbox:routeFromConfirm(vendor, date, seq, rows)` | `ipc/inbox.js` | 확정완료 행 → ship/milk 로 fan-out |
| `lots:listByJob(vendor, kind, date, seq)` | `ipc/lots.js` | 해당 차수의 lot 목록 + 컨테이너 + 배정 |
| `lots:create(vendor, kind, date, seq, payload)` | `ipc/lots.js` | lot + containers + allocations 트랜잭션 INSERT, inbox.qty 차감 |
| `lots:cancel(lotId)` | `ipc/lots.js` | inbox.qty 환원, lot 삭제 (트랜잭션) |
| `lots:upload(vendor, kind, date, seq, lotIds)` | `ipc/lots.js` | xlsx 생성 + python `shipment_register`/`milkrun_register` 실행 + lots.uploaded=1 + upload_history INSERT |
| `lots:listUploadHistory(vendor, kind, date, seq)` | `ipc/lots.js` | 차수별 업로드 이력 |

### 폐기 (M5 즉시 삭제)

| 채널 | 대체 |
|---|---|
| `transport:open/close/load/save` | `inbox:*` + `lots:*` 로 흡수 |
| `stockAdjust:open/close/load/save/getLocks/onLocksChanged` | ReviewStep grouping 으로 흡수 |

## 2. 컴포넌트 매핑 (src/)

### 신규 (M1~M5)

```
src/shell/
  AppShell.jsx                  Desktop+Header+Body+Log 단일 윈도우 컨테이너
  AppHeader.jsx                 상단 바 (브레드크럼 + 벤더 + 토글)
  WebPanel.jsx                  우측 슬라이드 + 드래그 리사이즈
  LogPanel.jsx                  하단 collapsible 로그 (기존 LogPanel 재포장)
  UploadIndicator.jsx           헤더 배경 업로드 상태 인디케이터

src/views/calendar/
  CalendarView.jsx              v4 사이드바 + 7×6 그리드 (기존 CalendarView 대체)

src/views/po-list/
  PoListView.jsx                차수 사이드바 + ALL_POS 테이블
  PoListSidebar.jsx
  PoListTable.jsx
  PoRefreshModal.jsx            쿠팡 갱신 / Excel 업로드

src/views/job/
  JobView.jsx                   사이드 step 네비 + step body
  JobStepNav.jsx
  steps/ReviewStep.jsx          기존 SpreadsheetView + 재고조정 grouping 흡수
  steps/ConfirmStep.jsx
  steps/AdminSyncStep.jsx       플러그인 step
  steps/ShipAssignStep.jsx      쉽먼트 lot 배정
  steps/MilkAssignStep.jsx      밀크런 lot 배정
  steps/HistoryStep.jsx         기존 ResultView 재포장

src/views/lot/                  ShipAssignStep / MilkAssignStep 공유
  LotAssignView.jsx             좌(미배정) + 우(빌더+lot 목록)
  UnassignedList.jsx            센터 그룹 + lockedWh + 완료 항목 표시
  LotBuilder.jsx                컨테이너 카드 + allocation
  LotList.jsx                   내 lot 카드 + 일괄 업로드
  LotCard.jsx

src/views/plugin/
  PluginTakeover.jsx            fullscreen modal
  PluginManagerModal.jsx
  PluginLockBanner.jsx

src/modals/
  UploadProgressModal.jsx       기존 CountdownModal 흡수 + 단계 stepper + 백그라운드
  ConfirmDialog.jsx
  NewJobModal.jsx               기존 NewJobModal 재사용

src/db/                         (Main process — renderer 에선 안 보임)
  index.js                      better-sqlite3 connection (singleton)
  migrations/001_init.sql       SCHEMA_V1.sql 의 컴파일된 형태
  migrations/index.js           부팅 시 schema_meta.version 확인 + 적용
  repos/pos.js
  repos/jobs.js
  repos/inbox.js
  repos/lots.js
  repos/uploads.js

src/ipc/                        (Main process — ipc-handlers.js 분해)
  index.js                      registerIpcHandlers() 진입점
  vendors.js
  settings.js
  jobs.js                       (manifest 파일 read/write + jobs_index sync)
  files.js
  python.js
  credentials.js
  session.js
  confirmation.js
  poTbnws.js
  eflex.js
  tbnwsCoupangExport.js
  palletList.js
  webview.js
  find.js
  plugin.js
  license.js
  update.js
  pos.js                        (NEW)
  inbox.js                      (NEW)
  lots.js                       (NEW)
```

### 재사용 (그대로 또는 소폭 수정)

```
components/
  SpreadsheetView.jsx           ReviewStep 안에 마운트
  EditableTable.jsx             InboxList / lot allocations 에 재사용
  FindBar.jsx                   Ctrl+F
  LicenseGate.jsx               AppShell 위 overlay
  UpdateModal.jsx
  Toast.jsx                     위치만 우상단 → 헤더 옆
  VendorSelector.jsx            CalendarSidebar 안으로 이동
  ListManagerModal.jsx
  NewJobModal.jsx               PoListView "새 차수 만들기" 에서 호출

core/
  plugin-host.jsx               그대로
  plugin-api.js                 KNOWN_HOOKS 확장만
  plugin-registry.js
  plugin-loader.js
  entitlements.js
  plugins.js
  confirmationBuilder.js
  poParser.js
  poStyler.js
  deliveryCompanies.js

lib/
  excelFormats.js
  vendorFiles.js
  webviewReserve.js
```

### 삭제 대상 (M5/M7)

```
components/Sidebar.jsx              ← AppShell 로 대체 (M1)
components/WorkDetailView.jsx       ← JobView 로 대체 (M4)
components/WorkView.jsx             ← JobView 로 대체 (M4)
components/PhaseStepper.jsx         ← JobStepNav 로 대체 (M4)
components/JobCard.jsx              ← PoListSidebar 항목으로 대체 (M3)
components/TabNav.jsx               ← step nav 로 대체 (M4)
components/CalendarView.jsx         ← views/calendar/CalendarView.jsx 로 교체 (M3)
components/TransportView.jsx        ← LotAssignView 로 대체 (M5 즉시 삭제)
components/StockAdjustView.jsx      ← ReviewStep grouping 으로 흡수 (M5 즉시 삭제)
components/PluginsView.jsx          ← PluginManagerModal 로 대체 (M6)
components/SettingsView.jsx         ← AppHeader 의 설정 모달로 변환 (M1~M2 결정)

ipc-handlers.js (3857줄)            ← src/ipc/* 로 분해 (M2)
  - transport:* 핸들러 (M5 즉시 삭제)
  - stockAdjust:* 핸들러 (M5 즉시 삭제)
```

## 3. 데이터 마이그레이션 (M7)

### in-place (변경 없음)

- `vendors.json`, `settings.json`, `license-*` files, plugin manifest, `secrets.js`
- 모든 manifest.json (차수별)
- 모든 `po*.xlsx`, `confirmation.xlsx`, `po-tbnws.xlsx`, `eflex-*.xlsx`, `pallet-list-*.xlsx`, `tbnws-coupang-export-*.xlsx`
- 사용자 자격증명, 세션 cookie

### DB 로 이동 (새 데이터 모델)

| 출처 | 대상 | 변환 시점 |
|---|---|---|
| 모든 manifest.json scan | `jobs_index` | M2 부팅 시 자동 sync |
| manifest 의 SKU 행 (po.xlsx) | `pos` | M3 부팅 시 backfill |
| 모든 차수 폴더의 `transport.json` | `inbox_items` + `lots` + `lot_containers` + `lot_allocations` | M7 마이그레이션 스크립트 1회 실행 |
| manifest 의 uploadHistory 배열 | `upload_history` | M7 backfill |

### 백업

마이그레이션 직전 자동 생성:
```
%LOCALAPPDATA%/CoupangAutomation/data-backup-{YYYYMMDDHHMMSS}/
  ├ jobs/                  (모든 차수 폴더 사본)
  └ vendors-backup.json
```

## 4. 결정사항 (메모리)

- **flag 없이 직진** — feature flag 안 깖
- **floating webview 폐기** — 단일 윈도우 + 우측 슬라이드 패널 (mockup 검증 완료)
- **transport/stockAdjust M5 즉시 삭제**
- **단일 DB 파일** + `vendor_id` 컬럼 분리
- **재고조정 ReviewStep 흡수**
- **better-sqlite3 12.9.0** 사용, electron 31 ABI 로 rebuild 됨

## 5. M0 체크리스트 (현재)

- [x] M0.1 — floating webview PoC: 폐기 결정 (단일 윈도우)
- [x] M0.2 — better-sqlite3 + electron-rebuild 검증
- [x] M0.3 — DB 스키마 V1 초안 (`docs/SCHEMA_V1.sql`)
- [x] M0.4 — IPC ↔ v4 매핑표 (이 문서)
- [ ] M1 — 디자인 토큰 + 셸 골격 도입 (`src/shell/`)
