/**
 * UI 구조 검증 스크립트
 * Electron 앱을 실행하고 DOM 구조, 탭 전환, 컴포넌트 렌더링을 검증한다.
 *
 * 실행: npx electron test-ui-validation.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const TIMEOUT_MS = 15000;
const results = [];

function log(category, status, detail) {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : 'ℹ️';
  const msg = `${icon} [${category}] ${detail}`;
  console.log(msg);
  results.push({ category, status, detail });
}

async function runTests(win) {
  const wc = win.webContents;

  // Helper: evaluate JS in renderer
  const evaluate = (code) => wc.executeJavaScript(code);

  // ── 1. 기본 로드 확인 ──
  try {
    const title = await evaluate('document.title');
    log('기본 로드', title.includes('쿠팡') ? 'PASS' : 'FAIL',
      `페이지 타이틀: "${title}"`);
  } catch (e) {
    log('기본 로드', 'FAIL', `타이틀 확인 실패: ${e.message}`);
  }

  // ── 2. #root 마운트 확인 ──
  try {
    const rootChildCount = await evaluate('document.getElementById("root").childElementCount');
    log('React 마운트', rootChildCount > 0 ? 'PASS' : 'FAIL',
      `#root 자식 요소 수: ${rootChildCount}`);
  } catch (e) {
    log('React 마운트', 'FAIL', `React 마운트 확인 실패: ${e.message}`);
  }

  // ── 3. 앱 헤더 확인 ──
  try {
    const headerText = await evaluate('document.querySelector(".app-header .app-title")?.textContent || ""');
    log('앱 헤더', headerText.includes('쿠팡 서플라이어 자동화') ? 'PASS' : 'FAIL',
      `헤더 텍스트: "${headerText}"`);
  } catch (e) {
    log('앱 헤더', 'FAIL', `헤더 확인 실패: ${e.message}`);
  }

  // ── 4. 탭 네비게이션 확인 ──
  try {
    const tabCount = await evaluate('document.querySelectorAll(".tab-btn").length');
    log('탭 네비게이션', tabCount === 2 ? 'PASS' : 'FAIL',
      `탭 버튼 수: ${tabCount} (기대: 2)`);

    const tabLabels = await evaluate(
      'Array.from(document.querySelectorAll(".tab-btn")).map(b => b.textContent).join(", ")'
    );
    log('탭 레이블', tabLabels.includes('웹 뷰') && tabLabels.includes('작업 뷰') ? 'PASS' : 'FAIL',
      `탭 레이블: "${tabLabels}"`);
  } catch (e) {
    log('탭 네비게이션', 'FAIL', `탭 확인 실패: ${e.message}`);
  }

  // ── 5. 웹 뷰 탭 (기본 활성) ──
  try {
    const activeTab = await evaluate(
      'document.querySelector(".tab-btn--active")?.textContent || ""'
    );
    log('웹 뷰 기본 활성', activeTab.includes('웹 뷰') ? 'PASS' : 'FAIL',
      `활성 탭: "${activeTab}"`);

    const webviewPlaceholder = await evaluate(
      'document.querySelector(".webview-placeholder")?.textContent || ""'
    );
    log('웹 뷰 플레이스홀더', webviewPlaceholder.includes('웹 뷰 영역') ? 'PASS' : 'FAIL',
      `웹 뷰 콘텐츠 포함: "${webviewPlaceholder.substring(0, 50)}..."`);
  } catch (e) {
    log('웹 뷰', 'FAIL', `웹 뷰 확인 실패: ${e.message}`);
  }

  // ── 6. 작업 뷰 탭 전환 ──
  try {
    // 작업 뷰 탭 클릭
    await evaluate(`
      const workBtn = Array.from(document.querySelectorAll(".tab-btn"))
        .find(b => b.textContent.includes("작업 뷰"));
      if (workBtn) workBtn.click();
    `);
    // 약간의 React 렌더링 대기
    await new Promise(r => setTimeout(r, 500));

    const newActiveTab = await evaluate(
      'document.querySelector(".tab-btn--active")?.textContent || ""'
    );
    log('탭 전환', newActiveTab.includes('작업 뷰') ? 'PASS' : 'FAIL',
      `전환 후 활성 탭: "${newActiveTab}"`);
  } catch (e) {
    log('탭 전환', 'FAIL', `탭 전환 실패: ${e.message}`);
  }

  // ── 7. 작업 뷰 - 툴바 버튼 확인 ──
  try {
    const btnTexts = await evaluate(
      'Array.from(document.querySelectorAll(".workview-toolbar .btn")).map(b => b.textContent).join(" | ")'
    );
    log('작업 뷰 툴바',
      btnTexts.includes('쿠팡 양식') && btnTexts.includes('통합 양식') ? 'PASS' : 'FAIL',
      `툴바 버튼: "${btnTexts}"`);
  } catch (e) {
    log('작업 뷰 툴바', 'FAIL', `툴바 확인 실패: ${e.message}`);
  }

  // ── 8. Editable Table 렌더링 확인 ──
  try {
    const tableExists = await evaluate('!!document.querySelector(".editable-table")');
    log('Editable Table 존재', tableExists ? 'PASS' : 'FAIL',
      `테이블 DOM 존재: ${tableExists}`);

    const headerCells = await evaluate(
      'Array.from(document.querySelectorAll(".editable-table__th")).map(th => th.textContent).join(", ")'
    );
    log('테이블 헤더',
      headerCells.includes('PO 번호') && headerCells.includes('납품여부') ? 'PASS' : 'FAIL',
      `헤더 셀: "${headerCells}"`);

    const rowCount = await evaluate(
      'document.querySelectorAll(".editable-table__row").length'
    );
    log('테이블 데이터 행', rowCount === 3 ? 'PASS' : 'FAIL',
      `데이터 행 수: ${rowCount} (기대: 3, 샘플 데이터)`);
  } catch (e) {
    log('Editable Table', 'FAIL', `테이블 확인 실패: ${e.message}`);
  }

  // ── 9. Editable 셀 확인 (납품여부 컬럼만 editable) ──
  try {
    const inputCount = await evaluate(
      'document.querySelectorAll(".editable-table__input").length'
    );
    log('Editable 입력 필드', inputCount === 3 ? 'PASS' : 'FAIL',
      `입력 필드 수: ${inputCount} (기대: 3, 납품여부 컬럼 3행)`);

    const readOnlyCount = await evaluate(
      'document.querySelectorAll(".editable-table__text").length'
    );
    log('읽기 전용 셀', readOnlyCount === 12 ? 'PASS' : 'FAIL',
      `읽기 전용 셀 수: ${readOnlyCount} (기대: 12 = 4컬럼 x 3행)`);
  } catch (e) {
    log('Editable 셀', 'FAIL', `셀 확인 실패: ${e.message}`);
  }

  // ── 10. 셀 편집 기능 확인 ──
  try {
    // 첫 번째 납품여부 셀의 input value 변경
    const oldValue = await evaluate(
      'document.querySelector(".editable-table__input")?.value || ""'
    );
    await evaluate(`
      const input = document.querySelector(".editable-table__input");
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, '테스트수정');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await new Promise(r => setTimeout(r, 300));
    const newValue = await evaluate(
      'document.querySelector(".editable-table__input")?.value || ""'
    );
    log('셀 편집', newValue === '테스트수정' ? 'PASS' : 'FAIL',
      `값 변경: "${oldValue}" → "${newValue}"`);
  } catch (e) {
    log('셀 편집', 'FAIL', `셀 편집 실패: ${e.message}`);
  }

  // ── 11. 로그 패널 확인 ──
  try {
    const logPanelExists = await evaluate('!!document.querySelector(".log-panel")');
    log('로그 패널 존재', logPanelExists ? 'PASS' : 'FAIL',
      `로그 패널 DOM 존재: ${logPanelExists}`);

    const logHeader = await evaluate(
      'document.querySelector(".log-panel__header")?.textContent || ""'
    );
    log('로그 패널 헤더', logHeader.includes('작업 로그') ? 'PASS' : 'FAIL',
      `로그 헤더: "${logHeader}"`);

    const logEntryCount = await evaluate(
      'document.querySelectorAll(".log-entry").length'
    );
    log('로그 항목', logEntryCount >= 1 ? 'PASS' : 'FAIL',
      `로그 항목 수: ${logEntryCount} (최소 1건 기대)`);
  } catch (e) {
    log('로그 패널', 'FAIL', `로그 패널 확인 실패: ${e.message}`);
  }

  // ── 12. 웹 뷰 탭으로 복귀 확인 ──
  try {
    await evaluate(`
      const webBtn = Array.from(document.querySelectorAll(".tab-btn"))
        .find(b => b.textContent.includes("웹 뷰"));
      if (webBtn) webBtn.click();
    `);
    await new Promise(r => setTimeout(r, 500));

    const backTab = await evaluate(
      'document.querySelector(".tab-btn--active")?.textContent || ""'
    );
    log('탭 복귀', backTab.includes('웹 뷰') ? 'PASS' : 'FAIL',
      `복귀 후 활성 탭: "${backTab}"`);

    const workviewGone = await evaluate(
      '!document.querySelector(".workview-container")'
    );
    log('뷰 전환 정리', workviewGone ? 'PASS' : 'FAIL',
      `작업 뷰 DOM 제거됨: ${workviewGone}`);
  } catch (e) {
    log('탭 복귀', 'FAIL', `탭 복귀 실패: ${e.message}`);
  }

  // ── 13. 콘솔 에러 수집 ──
  // (이미 아래에서 수집 중)

  // ── 14. IPC 브릿지 확인 ──
  try {
    const hasElectronAPI = await evaluate('typeof window.electronAPI');
    log('IPC 브릿지', hasElectronAPI === 'object' ? 'PASS' : 'FAIL',
      `window.electronAPI 타입: ${hasElectronAPI}`);

    const apiMethods = await evaluate(`
      Object.keys(window.electronAPI).join(', ')
    `);
    log('IPC 메서드',
      apiMethods.includes('loadVendors') && apiMethods.includes('runPython') ? 'PASS' : 'FAIL',
      `API 메서드: ${apiMethods}`);
  } catch (e) {
    log('IPC 브릿지', 'FAIL', `IPC 확인 실패: ${e.message}`);
  }

  // ── 15. CSS 스타일 적용 확인 ──
  try {
    const headerBg = await evaluate(
      'getComputedStyle(document.querySelector(".app-header")).backgroundColor'
    );
    log('CSS 스타일', headerBg !== '' ? 'PASS' : 'FAIL',
      `앱 헤더 배경색: ${headerBg}`);
  } catch (e) {
    log('CSS 스타일', 'FAIL', `CSS 확인 실패: ${e.message}`);
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,  // headless
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 콘솔 에러 수집
  const consoleErrors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    // level: 0=verbose, 1=info, 2=warning, 3=error
    if (level >= 3) {
      consoleErrors.push(message);
    }
  });

  // 페이지 크래시 감지
  win.webContents.on('render-process-gone', (_event, details) => {
    log('프로세스', 'FAIL', `렌더러 프로세스 크래시: ${details.reason}`);
  });

  // 프로덕션 빌드 로드
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  console.log(`\n📦 빌드된 파일 로드: ${indexPath}\n`);

  try {
    await win.loadFile(indexPath);
    log('파일 로드', 'PASS', `dist/index.html 정상 로드`);
  } catch (e) {
    log('파일 로드', 'FAIL', `로드 실패: ${e.message}`);
    printSummary(consoleErrors);
    app.quit();
    return;
  }

  // React 렌더링 대기
  await new Promise(r => setTimeout(r, 2000));

  // 테스트 실행
  await runTests(win);

  // 콘솔 에러 보고
  if (consoleErrors.length === 0) {
    log('콘솔 에러', 'PASS', '콘솔 에러 없음');
  } else {
    log('콘솔 에러', 'FAIL', `콘솔 에러 ${consoleErrors.length}건 발견`);
    consoleErrors.forEach((e, i) => console.log(`   ⚠️  에러 ${i + 1}: ${e}`));
  }

  printSummary(consoleErrors);
  app.quit();
});

function printSummary(consoleErrors) {
  console.log('\n' + '═'.repeat(70));
  console.log('📊 UI 검증 결과 요약');
  console.log('═'.repeat(70));

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const total = passed + failed;

  console.log(`\n총 ${total}개 테스트: ✅ ${passed}개 통과, ❌ ${failed}개 실패\n`);

  if (failed > 0) {
    console.log('실패 항목:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ [${r.category}] ${r.detail}`);
    });
  }

  console.log('\n── Phase 1 요구사항 체크리스트 ──');
  console.log('☐ Electron Main + Renderer 프로젝트 초기화');
  console.log('☐ 웹 뷰(BrowserView) + 작업 뷰(React editable table) 탭 UI');
  console.log('☐ 벤더 선택 드롭다운 + vendors.json 추가/수정 UI');
  console.log('☐ Python subprocess 브릿지 (IPC ↔ Playwright)');
  console.log('☐ Editable Table 렌더링');
  console.log('☐ 로컬 Excel 저장 및 재시작 시 불러오기');

  // 자동 판정
  const phase1Checks = {
    '프로젝트 초기화': passed > 0,
    '탭 UI': results.some(r => r.category.includes('탭') && r.status === 'PASS'),
    'Editable Table': results.some(r => r.category.includes('Editable') && r.status === 'PASS'),
    'IPC 브릿지': results.some(r => r.category.includes('IPC') && r.status === 'PASS'),
  };

  console.log('\n── 자동 판정 ──');
  Object.entries(phase1Checks).forEach(([k, v]) => {
    console.log(`  ${v ? '✅' : '❌'} ${k}`);
  });

  console.log('\n' + '═'.repeat(70));
}

// 타임아웃 안전장치
setTimeout(() => {
  console.error('⏰ 타임아웃: 테스트가 15초 내에 완료되지 않음');
  app.quit();
  process.exit(1);
}, TIMEOUT_MS);
