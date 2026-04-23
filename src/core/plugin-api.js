/**
 * 플러그인 API — 4종 확장 포인트 (Slot · View · Hook · Phase) 의 타입·등록 시그니처.
 *
 * 이 파일은 "계약(contract)" 에 해당. 실제 구현은 plugin-registry.js,
 * 코어 뷰는 plugin-host.jsx 의 SlotRenderer / ViewOutlet / PhaseTabs 로 소비.
 *
 * 설계 원칙:
 *   1. 플러그인은 "manifest + activate()" 로 선언. activate() 에서 ctx 로
 *      register* 호출해 확장 포인트에 등록.
 *   2. 각 register* 는 Disposable 반환 — 비활성화 시 cleanup 용.
 *   3. 코어는 플러그인 존재 여부에 무관하게 동작해야 함
 *      (기본 구현 = 최소 priority 로 등록된 'core' 플러그인).
 *   4. "공공 API" 로 노출한 scope/role/hook/phase ID 는 semver 로 관리. 변경 = breaking.
 *
 * 플러그인 폴더 구조:
 *   src/plugins/<id>/
 *     index.js          — renderer half. default export = PluginManifest
 *     main.js           — main process half (선택). default export = MainPluginManifest
 *     package.json      — 의존성 (선택)
 */

// ═══════════════════════════════════════════════════════════════════
// 공통 타입
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {() => void} Disposable
 *   등록 해제 함수. 플러그인 비활성화 시 호출.
 */

/**
 * @typedef {object} PluginStorage
 *   플러그인 전용 파일 저장 경로 계산기. 코어 파일과 충돌·혼재 방지.
 *
 * @property {(fileName: string, jobKey: JobKey) => string} jobScoped
 *   data/{date}/{vendor}/{seq}/plugins/{pluginId}/{fileName}
 * @property {(fileName: string, vendor: string) => string} vendorScoped
 *   data/vendors/{vendor}/plugins/{pluginId}/{fileName}
 * @property {(fileName: string) => string} global
 *   data/plugins/{pluginId}/{fileName}
 */

/**
 * @typedef {{ date: string, vendor: string, sequence: number }} JobKey
 */

/**
 * @typedef {object} PluginContext
 *   플러그인 activate(ctx) 로 전달되는 런타임 컨텍스트.
 *
 * @property {string} pluginId
 *   현재 플러그인 id (로깅·storage 경로에 사용).
 * @property {(cmd: Command) => Disposable} registerCommand
 * @property {(role: string, view: ViewDescriptor) => Disposable} registerView
 * @property {(id: string, handler: HookHandler, opts?: HookOpts) => Disposable} registerHook
 * @property {(phase: Phase) => Disposable} registerPhase
 *   워크플로우 단계 삽입.
 * @property {(event: string, payload: any) => void} emit
 *   플러그인 간 통신용 이벤트 발행.
 * @property {(event: string, handler: (payload: any) => void) => Disposable} on
 *   플러그인 간 이벤트 구독.
 * @property {PluginStorage} storage
 *   플러그인 전용 파일 경로.
 * @property {string[]} entitlements
 *   라이선스 서버가 발급한 권한 플래그 (예: ['core', 'tbnws.plugin', 'premium.email']).
 * @property {string|null} currentVendor
 *   현재 선택된 벤더 id. 벤더 전환 시 플러그인은 자동 재활성화.
 * @property {object} electronAPI
 *   window.electronAPI 그대로. 파일/IPC 접근용.
 * @property {(channel: string, ...args: any[]) => Promise<any>} ipcInvoke
 *   플러그인의 main.js 에서 등록한 IPC 채널 호출 shortcut.
 *   예: ipcInvoke('eflexs.submit', payload) → main.js 의 'plugin:tbnws:eflexs.submit'
 */

/**
 * @typedef {object} PluginManifest
 *   렌더러 측 플러그인. `src/plugins/<id>/index.js` 의 default export.
 *
 * @property {string} id
 *   전역 유니크. 영소문자·숫자·하이픈만. 예: 'tbnws', 'core', 'premium-email'.
 * @property {string} name
 *   UI 표시용 이름. 예: 'TBNWS'.
 * @property {string} version
 *   SemVer. 예: '1.0.0'.
 * @property {string} [entitlement]
 *   로딩에 필요한 entitlement 플래그. 없으면 entitlements 무관하게 로드.
 *   예: 'tbnws.plugin'. 라이선스 서버 미연결 시 (개발 모드) 는 무시.
 * @property {PluginSettingField[]} [settingsSchema]
 *   플러그인 고유 설정 필드 정의. PluginsView 가 이걸 읽어 폼 자동 생성.
 *   값은 글로벌 settings.json 의 `plugins.<id>.<key>` 경로에 저장됨.
 * @property {(ctx: PluginContext) => (void | Disposable)} activate
 *   플러그인 진입점. Disposable 반환 시 deactivate 때 자동 호출.
 */

/**
 * @typedef {object} PluginSettingField
 *   플러그인 설정 필드 정의. PluginsView 가 자동 렌더.
 *
 * @property {string} key           예: 'apiBaseUrl'
 * @property {string} label         표시 레이블
 * @property {'text' | 'password' | 'number' | 'url' | 'textarea' | 'boolean'} type
 * @property {string} [description] 필드 아래 설명 텍스트
 * @property {string} [placeholder]
 * @property {any}    [default]     기본값 (값 없을 때 UI 에 표시)
 */

/**
 * @typedef {object} MainPluginManifest
 *   메인 프로세스 측 플러그인. `src/plugins/<id>/main.js` 의 default export.
 *   renderer 가 `ipcInvoke('foo', ...)` 하면 'plugin:<id>:foo' 로 디스패치됨.
 *
 * @property {string} id
 * @property {(registrar: MainRegistrar) => (void | Disposable)} activate
 */

/**
 * @typedef {object} MainRegistrar
 * @property {(channel: string, handler: (event: any, ...args: any[]) => any) => Disposable} handle
 *   ipcMain.handle('plugin:<id>:<channel>', handler) 에 해당.
 * @property {string} pluginId
 * @property {string} userDataPath
 *   Electron 기본 userData 경로 (app.getPath('userData')) — 세션·쿠키·캐시 용도.
 * @property {string} dataDir
 *   프로젝트 데이터 루트 (C:\Users\{user}\AppData\Local\CoupangAutomation) —
 *   settings.json / 작업(job) 폴더가 저장되는 곳. ipc-handlers 와 공유.
 */

// ═══════════════════════════════════════════════════════════════════
// 1) Command (Slot 주입용) — 추가
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {object} Command
 *   SlotRenderer 가 해당 scope 에서 렌더하는 액션.
 *
 * @property {string} id
 *   전역 유니크. '<plugin>.<action>' 네이밍. 예: 'tbnws.compareInventory'.
 * @property {string} title
 *   표시 텍스트.
 * @property {string} [icon]
 *   이모지/아이콘 이름 (UI 에서 해석).
 * @property {string} scope
 *   렌더링 위치 ID. 코어가 정의한 scope 중 하나. 아래 KNOWN_SCOPES 참고.
 * @property {number} [order]
 *   같은 scope 내 정렬. 낮을수록 앞. 기본 100.
 * @property {string} [variant]
 *   스타일 힌트: 'primary' | 'secondary' | 'danger' 등. 기본 'secondary'.
 * @property {(ctx: CommandWhenCtx) => boolean} [when]
 *   표시 조건. false 면 해당 호출에서 숨김.
 * @property {(args: any, ctx: PluginContext) => (void | Promise<void>)} handler
 *   실행 함수. args 는 scope 별로 다름 (예: 'transport.row.actions' 는 { row } 전달).
 *
 * scope='work.tab.extra' 전용 옵션 필드:
 * @property {string} [fileName]   WorkView 탭이 로드할 파일명. 예: 'po-tbnws.xlsx'
 * @property {boolean} [readOnly]  탭에서 저장 버튼 숨김
 * @property {'po' | 'confirmation' | 'result'} [after]  탭 렌더 위치 (기본: 끝)
 * @property {(buffer: ArrayBuffer, ctx: { job: object, electronAPI: object }) => Promise<void>} [onSave]
 *   저장 버튼 눌렸을 때 호출. 주어지면 기본 파일 덮어쓰기 대신 이걸 실행.
 * @property {boolean} [hasPoActions]
 *   이 탭도 PO 원본 탭과 같은 context action(재고조정·확정서 생성/반영) 버튼을
 *   노출. 단 액션 동작은 tabVariant 값에 따라 분기 (예: 재고조정 popup 을 variant
 *   로 열어 plugin 뷰 치환). PO 원본 탭과 공존.
 * @property {string} [tabVariant]
 *   이 탭에서 버튼을 누를 때 stockAdjust.open({ variant }) 등에 전달되는 값.
 *   예: 'tbnws'.
 */

/**
 * @typedef {object} CommandWhenCtx
 *   when() 에 전달되는 컨텍스트. scope 별로 추가 필드.
 * @property {string|null} currentVendor
 * @property {string[]} entitlements
 * @property {string} [phase]       예: 'po_downloaded', 'confirmed'
 * @property {object} [job]         현재 활성 job manifest
 */

// 코어가 정의하는 표준 scope 목록. 이 ID 는 공공 API — 변경 시 breaking.
export const KNOWN_SCOPES = Object.freeze({
  WORK_TOOLBAR: 'work.toolbar',                    // WorkView 툴바 우측
  WORK_TAB_EXTRA: 'work.tab.extra',                // 탭 목록 끝. { phase } 전달
  TRANSPORT_TOOLBAR: 'transport.toolbar',          // TransportView 툴바
  TRANSPORT_ROW_ACTIONS: 'transport.row.actions',  // 행 액션. { row } 전달
  STOCK_ADJUST_TOOLBAR: 'stock-adjust.toolbar',    // StockAdjustView 툴바
  STOCK_ADJUST_ROW_ACTIONS: 'stock-adjust.row.actions', // 행 액션. { row } 전달
  RESULT_TOOLBAR: 'result.toolbar',                // ResultView 툴바
  RESULT_DOWNLOAD_MENU: 'result.download.menu',    // 다운로드 메뉴 내 아이템
  SETTINGS_SECTION: 'settings.section',            // 설정 탭에 섹션 추가
  SIDEBAR_EXTRA: 'sidebar.extra',                  // 사이드바 하단 링크
});

// ═══════════════════════════════════════════════════════════════════
// 2) ViewDescriptor (View Registry 용) — 치환
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {object} ViewDescriptor
 *   코어가 정의한 role 에 대한 대체 뷰.
 *
 * @property {React.ComponentType<any>} component
 *   렌더링할 React 컴포넌트. props 는 role 별로 계약 문서화.
 * @property {number} [priority]
 *   같은 role 에 여러 뷰 등록 시 높은 값이 이김.
 *   코어 기본 뷰는 내부적으로 priority=-100 으로 등록됨.
 * @property {(ctx: ViewWhenCtx) => boolean} [when]
 *   해당 뷰가 활성화될 조건. false 면 다음 priority 로 폴백.
 */

/**
 * @typedef {object} ViewWhenCtx
 * @property {string|null} currentVendor
 * @property {string[]} entitlements
 * @property {object} [settings]    벤더별 설정 (vendors.json)
 */

// 코어가 정의하는 표준 view role. 공공 API.
export const KNOWN_VIEW_ROLES = Object.freeze({
  HOME: 'home',                              // 사이드바 기본 선택. 기본=CalendarView
  WORK_MAIN: 'work.main',                    // WorkView 중앙 패널. 기본=SpreadsheetView
  RESULT_PANEL: 'result.panel',              // ResultView 본체
  JOB_CARD: 'job.card',                      // 달력 셀 내 작업 카드
  STOCK_ADJUST_MAIN: 'stock-adjust.main',    // 재고조정 모달 내부 메인 뷰
  NEWJOB_OPTIONS: 'newjob.options',          // 새 작업 모달의 플러그인 옵션 영역. props: { options, onChange(key,value) }
});

// ═══════════════════════════════════════════════════════════════════
// 3) Hook (Middleware 스타일) — 행위 교체 · 데이터 변환 · 라이프사이클
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {(payload: any, ctx: HookCtx, next: NextFn) => (any | Promise<any>)} HookHandler
 *   payload 를 처리. 필요 시 next() 호출해 다음 핸들러로 전달.
 *   next() 호출하지 않으면 "대체" — 후순위 핸들러·기본 구현 실행 안 됨.
 *   반환값은 runHook(id, payload) 의 resolve 값.
 */

/**
 * @typedef {() => Promise<any>} NextFn
 *   체인의 다음 핸들러 호출. 반환값 그대로 쓰거나 가공 후 반환.
 */

/**
 * @typedef {object} HookCtx
 * @property {string|null} currentVendor
 * @property {string[]} entitlements
 * @property {object} electronAPI
 * @property {object} [job]         일부 훅에 추가 전달 (예: 라이프사이클)
 */

/**
 * @typedef {object} HookOpts
 * @property {number} [priority]
 *   높은 값이 먼저 실행 (기본 0, 코어 기본 구현은 -100).
 *   → 플러그인이 우선적으로 가로챔. next() 안 부르면 코어 기본이 실행되지 않음.
 */

// 코어가 정의하는 표준 hook ID. 공공 API.
export const KNOWN_HOOKS = Object.freeze({
  // ── 데이터 변환 (파이프라인 스타일, next() 권장) ──
  PO_POSTPROCESS: 'po.postprocess',           // payload: { workbook, job } → 변형된 workbook 반환
  PRODUCT_GROUP_KEY: 'product.group-key',     // payload: { sku, row } → 그룹키 반환 (기본=sku 그대로)
  STOCK_ADJUST_AUTOFILL: 'stock-adjust.autofill', // payload: { rows, job } → 자동 채움된 rows 반환
  CONFIRMATION_BUILD: 'confirmation.build',   // payload: { poWorkbook, job, settings } → 확정서 workbook

  // ── 행위 교체 (next() 호출 여부가 분기) ──
  RESULT_DELIVER: 'result.deliver',           // payload: { files, job } — 기본=파일 저장대화상자
  PO_IMPORT: 'po.import',                     // payload: { buffer, fileName, job } → PO 저장
  VENDOR_LOGIN: 'vendor.login',               // payload: { vendor, page } → 로그인 플로우

  // ── 라이프사이클 (부작용용, next() 꼭 호출) ──
  JOB_PRE_CREATE: 'job.pre-create',           // payload: { date, vendor, sequence, plugin, options } — 작업 생성 직후·PO 다운 전. 실패하면 생성 흐름 중단.
  JOB_CREATED: 'job.created',                 // payload: { job } — 작업 생성 직후
  JOB_COMPLETED: 'job.completed',             // payload: { job } — 완료 처리 직후
  PHASE_ENTER: 'phase.enter',                 // payload: { job, from, to } — phase 진입
  PHASE_LEAVE: 'phase.leave',                 // payload: { job, from, to } — phase 이탈
});

// ═══════════════════════════════════════════════════════════════════
// 4) Phase (워크플로우 단계) — 삽입
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {object} Phase
 *   워크플로우 단계 정의. registerPhase 로 등록하면 PhaseStepper 탭에 자동 포함.
 *
 *   내부적으로 이것은 "탭 slot + view 등록 + can-advance 훅" 의 syntactic sugar.
 *
 * @property {string} id
 *   phase 식별자. 영소문자·하이픈. 예: 'tbnws.stock-reflect'.
 *   manifest.phase 에 이 값이 저장되므로 한번 배포된 id 는 절대 바꾸지 말 것.
 * @property {string} label
 *   stepper 탭 라벨.
 * @property {string} [description]
 *   stepper 탭 부제.
 * @property {string} [after]
 *   기존 phase id 뒤에 삽입. 예: after='assigned'.
 * @property {string} [before]
 *   기존 phase id 앞에 삽입. after 와 함께 주면 after 우선.
 * @property {number} [order]
 *   after/before 로 해결 안 되는 경우 백업용. 낮을수록 앞.
 * @property {React.ComponentType<PhaseViewProps>} component
 *   이 phase 가 활성일 때 WorkView 메인 영역에 렌더링될 뷰.
 * @property {(job: object) => boolean | { ok: boolean, error?: string }} [canAdvance]
 *   다음 phase 로 넘어갈 수 있는지. false/error 면 진행 버튼 비활성화.
 * @property {(ctx: { currentVendor: string|null, entitlements: string[] }) => boolean} [when]
 *   벤더·entitlement 조건. false 면 phase 자체가 stepper 에 나타나지 않음.
 */

/**
 * @typedef {object} PhaseViewProps
 *   Phase.component 가 받는 props. 코어가 주입.
 * @property {object} job
 * @property {() => void} onAdvance   다음 phase 로 이동 요청 (코어가 can-advance 체크 후 처리)
 * @property {(patch: object) => Promise<void>} onUpdateJob
 *   manifest 부분 업데이트.
 */

// ═══════════════════════════════════════════════════════════════════
// 등록 API (stub — 실제 구현은 plugin-registry.js 로 분리)
// ═══════════════════════════════════════════════════════════════════

/**
 * 플러그인을 로드하고 activate() 실행.
 * entitlement 요구 시 entitlements 에 포함 안 되면 skip.
 *
 * @param {PluginManifest} manifest
 * @param {{ entitlements: string[], currentVendor: string|null, electronAPI: object }} runtime
 * @returns {Disposable|null}  등록 해제 함수. 스킵 시 null.
 */
export function loadPlugin(manifest, runtime) {
  throw new Error('loadPlugin: not implemented yet (see plugin-registry.js)');
}

/**
 * 특정 scope 의 Command 목록을 when() 필터링 후 order 순 정렬해 반환.
 * SlotRenderer 가 소비.
 *
 * @param {string} scope
 * @param {CommandWhenCtx} ctx
 * @returns {Command[]}
 */
export function getCommandsForScope(scope, ctx) {
  throw new Error('getCommandsForScope: not implemented yet');
}

/**
 * 주어진 role 에 대해 활성 ViewDescriptor 를 해결.
 * priority 내림차순 중 when() 통과하는 첫 항목.
 *
 * @param {string} role
 * @param {ViewWhenCtx} ctx
 * @returns {ViewDescriptor|null}
 */
export function resolveView(role, ctx) {
  throw new Error('resolveView: not implemented yet');
}

/**
 * 훅 체인 실행. priority 내림차순으로 미들웨어 호출.
 *
 * @param {string} id
 * @param {any} payload
 * @param {HookCtx} ctx
 * @returns {Promise<any>}
 */
export function runHook(id, payload, ctx) {
  throw new Error('runHook: not implemented yet');
}

/**
 * 활성 phase 목록 조회. after/before 위상 정렬 후 when() 필터.
 *
 * @param {{ currentVendor: string|null, entitlements: string[] }} ctx
 * @returns {Phase[]}
 */
export function getActivePhases(ctx) {
  throw new Error('getActivePhases: not implemented yet');
}

// ═══════════════════════════════════════════════════════════════════
// 소비 측 컴포넌트 (React) — API 시그니처만. 구현은 plugin-host.jsx.
// ═══════════════════════════════════════════════════════════════════

/**
 * <SlotRenderer scope="work.toolbar" ctx={{ job, phase }} />
 *   해당 scope 의 Command 목록을 button 으로 렌더링.
 *   ctx 는 CommandWhenCtx 와 merge 되어 when/handler 에 전달.
 *
 * @typedef {object} SlotRendererProps
 * @property {string} scope
 * @property {object} [ctx]
 * @property {string} [className]
 * @property {any} [args]
 *   handler 첫번째 인자로 전달. 예: 행 액션은 { row }.
 */

/**
 * <ViewOutlet role="home" ctx={{...}} fallback={<CalendarView/>} />
 *   resolveView(role, ctx) 결과를 렌더링. 없으면 fallback.
 *
 * @typedef {object} ViewOutletProps
 * @property {string} role
 * @property {object} [ctx]
 * @property {React.ReactNode} [fallback]
 * @property {object} [viewProps]   찾은 ViewDescriptor.component 에 전달할 props
 */

/**
 * <PhaseTabs job={job} onAdvance={...} />
 *   getActivePhases(ctx) 로 목록 조회해 stepper + 본문 렌더링.
 *   기존 PhaseStepper 의 확장 가능 버전.
 *
 * @typedef {object} PhaseTabsProps
 * @property {object} job
 * @property {(next: string) => void} onAdvance
 * @property {(patch: object) => Promise<void>} onUpdateJob
 */
