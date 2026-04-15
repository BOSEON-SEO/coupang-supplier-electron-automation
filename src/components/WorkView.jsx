import React, { useCallback, useEffect, useState, useRef } from 'react';
import EditableTable from './EditableTable';
import LogPanel from './LogPanel';
import CountdownModal from './CountdownModal';
import { rowsToXlsx, xlsxToRows } from '../lib/excelFormats';
import {
  buildFileName,
  findLatest,
  nextSequence,
  parseFileName,
  todayYmd,
} from '../lib/vendorFiles';

/**
 * 작업 뷰 탭
 *   - 벤더가 바뀌면 해당 벤더의 최신 파일 자동 로드
 *   - PO 다운로드 완료 시 결과 파일 자동 로드
 *   - 셀 편집 시 자동 저장 (debounce)
 *   - 쿠팡/통합 양식 저장 (차수 자동 증가) — 위험 동작 3초 카운트다운
 *   - Python subprocess 실행/취소 + 로그 실시간 스트리밍
 */

const DEFAULT_COLUMNS = [
  { key: 'poNumber', label: 'PO 번호', editable: false },
  { key: 'skuId', label: 'SKU ID', editable: false },
  { key: 'productName', label: '상품명', editable: false },
  { key: 'quantity', label: '수량', editable: false },
  { key: 'deliveryStatus', label: '납품여부', editable: true },
];

// 로그 최대 보관 개수 (성능 보호)
const MAX_LOG_ENTRIES = 500;

// 자동 저장 debounce 지연 (ms)
const AUTOSAVE_DELAY_MS = 2000;

// 로그인 세션 상태
const SESSION_STATUS = {
  UNKNOWN: 'unknown',
  CHECKING: 'checking',
  VALID: 'valid',
  EXPIRED: 'expired',
  LOGGING_IN: 'logging_in',
  ERROR: 'error',
};

export default function WorkView({ vendor, job }) {
  // ── 데이터 상태 ──
  const [rows, setRows] = useState([]);
  const [logs, setLogs] = useState([
    { time: new Date().toISOString(), level: 'info', message: '작업 뷰가 초기화되었습니다.' },
  ]);
  const [loadedFile, setLoadedFile] = useState(null);
  const [dirty, setDirty] = useState(false);           // 저장되지 않은 변경 여부
  const [lastSavedAt, setLastSavedAt] = useState(null); // 마지막 저장 시각
  const [pendingAction, setPendingAction] = useState(null);
  const [pythonRunning, setPythonRunning] = useState(false);
  const [loginStatus, setLoginStatus] = useState(SESSION_STATUS.UNKNOWN);
  const [loginScriptRunning, setLoginScriptRunning] = useState(false);
  const [logOpen, setLogOpen] = useState(() => {
    try { return window.localStorage?.getItem('coupang-supplier:logOpen') === 'true'; }
    catch { return false; }
  });

  // ── Refs ──
  const cleanupRef = useRef([]);
  const autoLoginTriggeredRef = useRef(false);
  const autosaveTimerRef = useRef(null);
  // rows/vendor/loadedFile의 최신 값을 ref로 유지 (autosave에서 참조)
  const rowsRef = useRef(rows);
  const vendorRef = useRef(vendor);
  const loadedFileRef = useRef(loadedFile);

  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { vendorRef.current = vendor; }, [vendor]);
  useEffect(() => { loadedFileRef.current = loadedFile; }, [loadedFile]);

  const appendLog = useCallback((level, message) => {
    setLogs((prev) => {
      const next = [...prev, { time: new Date().toISOString(), level, message }];
      return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
    });
  }, []);

  // ── 파일 로드 (공용) ──
  const loadFile = useCallback(async (fileName) => {
    const api = window.electronAPI;
    if (!api) return false;
    const resolved = await api.resolveVendorPath(fileName);
    if (!resolved?.success) {
      appendLog('error', `경로 해석 실패: ${resolved?.error}`);
      return false;
    }
    const read = await api.readFile(resolved.path);
    if (!read?.success) {
      appendLog('error', `파일 읽기 실패: ${read?.error}`);
      return false;
    }
    try {
      const { rows: loadedRows, meta } = xlsxToRows(read.data);
      setRows(loadedRows);
      setLoadedFile(fileName);
      setDirty(false);
      setLastSavedAt(meta.savedAt || null);
      appendLog('info', `파일 로드: ${fileName} (${loadedRows.length}행, schemaVersion=${meta.schemaVersion})`);
      return true;
    } catch (err) {
      appendLog('error', `xlsx 파싱 실패: ${err.message}`);
      return false;
    }
  }, [appendLog]);

  // ── 파일 저장 (현재 loadedFile에 덮어쓰기, 없으면 새 차수) ──
  const saveCurrentFile = useCallback(async (format = 'coupang') => {
    const v = vendorRef.current;
    const r = rowsRef.current;
    if (!v || r.length === 0) return null;

    const api = window.electronAPI;
    if (!api) return null;

    // loadedFile이 있으면 같은 파일에 덮어쓰기, 없으면 새 차수 생성
    let fileName = loadedFileRef.current;
    let parsed = fileName ? parseFileName(fileName) : null;

    if (!parsed) {
      // 새 파일 생성
      const list = await api.listVendorFiles(v);
      const ymd = todayYmd();
      const seq = nextSequence(list?.files ?? [], v, ymd);
      fileName = buildFileName(v, ymd, seq);
      parsed = { vendor: v, date: ymd, sequence: seq };
    }

    const buf = rowsToXlsx(r, format, {
      vendor: parsed.vendor,
      date: parsed.date,
      sequence: parsed.sequence,
    });
    const resolved = await api.resolveVendorPath(fileName);
    if (!resolved?.success) {
      appendLog('error', `저장 경로 해석 실패: ${resolved?.error}`);
      return null;
    }
    const w = await api.writeFile(resolved.path, buf);
    if (!w?.success) {
      appendLog('error', `저장 실패: ${w?.error}`);
      return null;
    }
    const now = new Date().toISOString();
    setLoadedFile(fileName);
    setDirty(false);
    setLastSavedAt(now);
    return fileName;
  }, [appendLog]);

  // ── 자동 저장 (debounce) ──
  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(async () => {
      autosaveTimerRef.current = null;
      if (!vendorRef.current || rowsRef.current.length === 0) return;
      const saved = await saveCurrentFile('coupang');
      if (saved) {
        appendLog('info', `[자동 저장] ${saved}`);
      }
    }, AUTOSAVE_DELAY_MS);
  }, [saveCurrentFile, appendLog]);

  // cleanup autosave timer
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  // ── Python 이벤트 리스너 등록 ──
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const unsubLog = api.onPythonLog?.((data) => {
      const line = data.line || JSON.stringify(data);
      appendLog('info', line);

      // ── PO 다운로드 결과 파일 자동 로드 ──
      // po_download.py는 type=result로 JSON 결과를 보낸다
      if (data.parsed && data.parsed.type === 'result') {
        try {
          const result = JSON.parse(data.parsed.data || data.line);
          if (result.success && result.fileName) {
            appendLog('info', `[PO 결과 수신] 파일 자동 로드: ${result.fileName}`);
            loadFile(result.fileName);
          }
        } catch {
          // result 파싱 실패 — 무시
        }
      }

      // ── 로그인 스크립트 세션 상태 감지 ──
      if (data.scriptName === 'scripts/login.py' || data.scriptName === 'login.py') {
        if (line.includes('[Session Valid: True]')) {
          setLoginStatus(SESSION_STATUS.VALID);
          autoLoginTriggeredRef.current = false;
        } else if (line.includes('[Session Valid: False]')) {
          setLoginStatus(SESSION_STATUS.EXPIRED);
        } else if (line.includes('[Login Success]') || line.includes('[Login Complete]')) {
          setLoginStatus(SESSION_STATUS.VALID);
          autoLoginTriggeredRef.current = false;
        }
      }
    });

    const unsubError = api.onPythonError?.((data) => {
      appendLog('error', data.line || JSON.stringify(data));
      if (data.scriptName === 'scripts/login.py' || data.scriptName === 'login.py') {
        const line = data.line || '';
        if (line.includes('로그인 실패') || line.includes('Login failed')) {
          setLoginStatus(SESSION_STATUS.ERROR);
        }
      }
    });

    const unsubDone = api.onPythonDone?.((data) => {
      setPythonRunning((prev) => {
        if (!prev) return false;
        if (data.killed) {
          appendLog('warn', `[system] Python 프로세스 취소됨 (signal=${data.signal})`);
        } else if (data.error) {
          appendLog('error', `[system] Python 프로세스 오류: ${data.error}`);
        } else if (data.exitCode === 0) {
          appendLog('info', `[system] Python 정상 종료 (exitCode=0)`);
        } else {
          appendLog('error', `[system] Python 비정상 종료 (exitCode=${data.exitCode})`);
        }
        return false;
      });

      // PO 다운로드 완료 시 — 파일 목록 갱신 후 최신 파일 로드
      if (
        (data.scriptName === 'scripts/po_download.py' || data.scriptName === 'po_download.py') &&
        data.exitCode === 0 &&
        !data.killed
      ) {
        const v = vendorRef.current;
        if (v) {
          (async () => {
            const api2 = window.electronAPI;
            if (!api2) return;
            const res = await api2.listVendorFiles(v);
            if (res?.success) {
              const latest = findLatest(res.files, v);
              if (latest && latest !== loadedFileRef.current) {
                appendLog('info', `[PO 완료] 최신 파일 로드: ${latest}`);
                await loadFile(latest);
              }
            }
          })();
        }
      }

      // 로그인 스크립트 종료
      if (data.scriptName === 'scripts/login.py' || data.scriptName === 'login.py') {
        setLoginScriptRunning(false);
        if (data.exitCode !== 0 && !data.killed) {
          setLoginStatus(SESSION_STATUS.ERROR);
        }
      }
    });

    cleanupRef.current = [unsubLog, unsubError, unsubDone];

    return () => {
      cleanupRef.current.forEach((unsub) => {
        if (typeof unsub === 'function') unsub();
      });
      cleanupRef.current = [];
    };
  }, [appendLog, loadFile]);

  // ── 세션 확인 (CDP 기반) ──
  const checkSessionStatus = useCallback(async (silent = false) => {
    const api = window.electronAPI;
    if (!api?.checkSession) return null;
    if (!silent) setLoginStatus(SESSION_STATUS.CHECKING);
    try {
      const result = await api.checkSession();
      if (result.error) {
        if (!silent) {
          appendLog('warn', `세션 확인 실패: ${result.error}`);
          setLoginStatus(SESSION_STATUS.UNKNOWN);
        }
        return result;
      }
      if (result.valid) {
        setLoginStatus(SESSION_STATUS.VALID);
        if (!silent) appendLog('info', `[Session Check] 유효 — ${result.url}`);
      } else if (result.loginRequired) {
        setLoginStatus(SESSION_STATUS.EXPIRED);
        if (!silent) appendLog('info', `[Session Check] 로그인 필요 — ${result.url}`);
      } else {
        setLoginStatus(SESSION_STATUS.EXPIRED);
        if (!silent) appendLog('info', `[Session Check] 세션 없음 — ${result.url || '(페이지 없음)'}`);
      }
      return result;
    } catch (err) {
      if (!silent) {
        appendLog('error', `세션 확인 에러: ${err.message}`);
        setLoginStatus(SESSION_STATUS.UNKNOWN);
      }
      return null;
    }
  }, [appendLog]);

  // ── 자격증명 확인 ──
  const [credentialStatus, setCredentialStatus] = useState(null);

  const checkCredentials = useCallback(async (vid) => {
    const api = window.electronAPI;
    if (!api?.checkCredentials || !vid) return;
    const result = await api.checkCredentials(vid);
    setCredentialStatus(result);
    if (!result.hasId || !result.hasPassword) {
      const missing = [];
      if (!result.hasId) missing.push(result.envIdKey);
      if (!result.hasPassword) missing.push(result.envPwKey);
      appendLog('warn', `자격증명 미설정: ${missing.join(', ')} 환경변수를 설정하세요.`);
    }
    return result;
  }, [appendLog]);

  // ── 벤더 변경 시: 상태 리셋 + 자격증명 확인 + 세션 체크 + 최신 파일 로드 ──
  useEffect(() => {
    setLoginStatus(SESSION_STATUS.UNKNOWN);
    setCredentialStatus(null);
    setDirty(false);
    setLastSavedAt(null);

    if (!vendor) {
      setRows([]);
      setLoadedFile(null);
      return;
    }

    checkCredentials(vendor);
    checkSessionStatus(true);

    // 최신 파일 자동 로드
    const api = window.electronAPI;
    if (!api) return;
    (async () => {
      const res = await api.listVendorFiles(vendor);
      if (!res?.success) {
        appendLog('warn', `파일 목록 조회 실패: ${res?.error ?? 'unknown'}`);
        return;
      }
      const latest = findLatest(res.files, vendor);
      if (!latest) {
        appendLog('info', `[${vendor}] 저장된 파일 없음 — 빈 테이블 표시`);
        setRows([]);
        setLoadedFile(null);
        return;
      }
      await loadFile(latest);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor]);

  // ── 세션 주기 폴링 ──
  useEffect(() => {
    if (!vendor || loginScriptRunning || pythonRunning) return;
    const intervalId = setInterval(() => {
      checkSessionStatus(true);
    }, 60_000);
    return () => clearInterval(intervalId);
  }, [vendor, loginScriptRunning, pythonRunning, checkSessionStatus]);

  // ── 세션 만료 자동 재로그인 ──
  useEffect(() => {
    autoLoginTriggeredRef.current = false;
  }, [vendor]);

  useEffect(() => {
    if (
      loginStatus === SESSION_STATUS.EXPIRED &&
      credentialStatus?.hasId &&
      credentialStatus?.hasPassword &&
      !pythonRunning &&
      !loginScriptRunning &&
      !autoLoginTriggeredRef.current
    ) {
      autoLoginTriggeredRef.current = true;
      appendLog('info', '[Auto-Login] 세션 만료 감지 — 자동 재로그인 시도');
      handleLoginInternal(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginStatus, credentialStatus, pythonRunning, loginScriptRunning]);

  // ── 로그인 실행 ──
  const handleLoginInternal = useCallback(async (forceRelogin = false) => {
    if (!vendor) {
      appendLog('warn', '벤더를 먼저 선택해주세요.');
      return;
    }
    const api = window.electronAPI;
    if (!api) return;

    const cred = await api.checkCredentials(vendor);
    if (!cred?.hasId || !cred?.hasPassword) {
      const missing = [];
      if (!cred?.hasId) missing.push(cred?.envIdKey || `COUPANG_ID_${vendor.toUpperCase()}`);
      if (!cred?.hasPassword) missing.push(cred?.envPwKey || `COUPANG_PW_${vendor.toUpperCase()}`);
      appendLog('error', `로그인 불가: 환경변수 미설정 — ${missing.join(', ')}`);
      setLoginStatus(SESSION_STATUS.ERROR);
      return;
    }

    setLoginStatus(SESSION_STATUS.LOGGING_IN);
    setLoginScriptRunning(true);

    const scriptArgs = ['--vendor', vendor];
    if (forceRelogin) scriptArgs.push('--force');

    appendLog('info', `로그인 ${forceRelogin ? '(강제) ' : ''}시작: 벤더 '${vendor}'`);
    const res = await api.runPython('scripts/login.py', scriptArgs);
    if (res.success) {
      setPythonRunning(true);
      appendLog('info', `로그인 프로세스 시작됨 (pid=${res.pid})`);
    } else {
      if (res.error && res.error.includes('already running')) {
        appendLog('warn', '이미 Python 프로세스가 실행 중입니다.');
      } else {
        appendLog('error', `로그인 실행 실패: ${res.error}`);
      }
      setLoginStatus(SESSION_STATUS.ERROR);
      setLoginScriptRunning(false);
    }
  }, [vendor, appendLog]);

  // ── 카운트다운 모달 열림/닫힘 시 WCV 숨김/표시 ──
  // WCV는 native overlay라 React 모달이 가려진다.
  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api) return;
    api.setVisible(!pendingAction);
  }, [pendingAction]);

  // ── 셀 변경 + 자동 저장 트리거 ──
  const handleCellChange = useCallback((rowIndex, columnKey, newValue) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[rowIndex] = { ...updated[rowIndex], [columnKey]: newValue };
      return updated;
    });
    setDirty(true);
    scheduleAutosave();
  }, [scheduleAutosave]);

  // ── 쿠팡/통합 양식으로 새 차수 저장 ──
  const saveAs = useCallback(async (format) => {
    if (!vendor) {
      appendLog('warn', '벤더를 먼저 선택해주세요.');
      return;
    }
    const api = window.electronAPI;
    const list = await api.listVendorFiles(vendor);
    const ymd = todayYmd();
    const seq = nextSequence(list?.files ?? [], vendor, ymd);
    const fileName = buildFileName(vendor, ymd, seq);
    const buf = rowsToXlsx(rows, format, { vendor, date: ymd, sequence: seq });
    const resolved = await api.resolveVendorPath(fileName);
    if (!resolved?.success) {
      appendLog('error', `경로 해석 실패: ${resolved?.error}`);
      return;
    }
    const w = await api.writeFile(resolved.path, buf);
    if (!w?.success) {
      appendLog('error', `저장 실패: ${w?.error}`);
      return;
    }
    setLoadedFile(fileName);
    setDirty(false);
    setLastSavedAt(new Date().toISOString());
    appendLog('info', `${format === 'integrated' ? '통합' : '쿠팡'} 양식 저장: ${fileName}`);
  }, [vendor, rows, appendLog]);

  // ── PO 갱신 (현재 job 의 date/vendor/sequence 로 재다운로드) ──
  const handlePoRefresh = useCallback(async () => {
    if (!job) {
      appendLog('warn', '활성 작업이 없습니다. 달력에서 작업을 선택하세요.');
      return;
    }
    const api = window.electronAPI;
    if (!api) return;

    appendLog('info', `PO 갱신 시작: ${job.date} · ${job.vendor} · ${job.sequence}차`);
    const res = await api.runPython('scripts/po_download.py', [
      '--vendor', job.vendor,
      '--date-from', job.date,
      '--date-to', job.date,
      '--sequence', String(job.sequence),
    ]);
    if (res.success) {
      setPythonRunning(true);
      appendLog('info', `PO 갱신 프로세스 시작됨 (pid=${res.pid})`);
    } else {
      appendLog('error', `PO 갱신 실행 실패: ${res.error}`);
    }
  }, [job, appendLog]);

  // ── Python 실행 취소 ──
  const handleCancelPython = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    appendLog('warn', 'Python 프로세스 취소 요청...');
    const res = await api.cancelPython();
    if (res.success) {
      appendLog('info', `Kill 신호 전송 (pid=${res.pid})`);
    } else {
      appendLog('error', `취소 실패: ${res.error}`);
    }
  }, [appendLog]);

  // ── 위험 동작 ──
  const requestDangerous = (label, run) => {
    setPendingAction({ label, run });
  };

  const confirmPending = useCallback(() => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    appendLog('info', `실행: ${action.label}`);
    Promise.resolve(action.run()).catch((e) => appendLog('error', `실행 오류: ${e.message}`));
  }, [pendingAction, appendLog]);

  const cancelPending = () => {
    if (pendingAction) appendLog('warn', `취소됨: ${pendingAction.label}`);
    setPendingAction(null);
  };

  // ── 저장 상태 텍스트 ──
  const statusText = (() => {
    if (!vendor) return '(벤더 미선택)';
    if (!loadedFile && rows.length === 0) return '저장된 파일 없음 — PO 다운로드를 실행하세요';
    const parts = [];
    if (loadedFile) parts.push(loadedFile);
    if (dirty) parts.push('(미저장 변경)');
    if (lastSavedAt) {
      const t = new Date(lastSavedAt);
      parts.push(`저장: ${t.toLocaleTimeString('ko-KR')}`);
    }
    return parts.join(' | ');
  })();

  return (
    <div className="workview-container">
      <div className="workview-toolbar">
        <button
          className="btn btn--primary"
          onClick={() => requestDangerous('PO 갱신', handlePoRefresh)}
          type="button"
          disabled={!job || pythonRunning}
          title={!job ? '활성 작업 없음' : `${job.date} · ${job.vendor} · ${job.sequence}차 PO 재다운로드`}
        >
          🔄 PO 갱신
        </button>

        {pythonRunning && (
          <>
            <button
              className="btn btn--danger btn--cancel-python"
              onClick={handleCancelPython}
              type="button"
            >
              ⏹ 실행 취소
            </button>
            <span className="python-status python-status--running">● 실행 중</span>
          </>
        )}

        <div className="workview-toolbar__spacer" />
      </div>

      <div className="workview-table-section">
        <EditableTable
          columns={DEFAULT_COLUMNS}
          rows={rows}
          onCellChange={handleCellChange}
        />
      </div>

      <div className={`workview-log-accordion${logOpen ? ' workview-log-accordion--open' : ''}`}>
        <button
          type="button"
          className="workview-log-bar"
          onClick={() => {
            setLogOpen((o) => {
              const next = !o;
              try { window.localStorage?.setItem('coupang-supplier:logOpen', String(next)); } catch { /* 무시 */ }
              return next;
            });
          }}
          aria-expanded={logOpen}
        >
          <span>📋 작업 로그 <span className="workview-log-bar__count">({logs.length})</span></span>
          <span className="workview-log-bar__chev">{logOpen ? '▼' : '▲'}</span>
        </button>
        {logOpen && (
          <div className="workview-log-section">
            <LogPanel logs={logs} hideHeader />
          </div>
        )}
      </div>

      {pendingAction && (
        <CountdownModal
          actionName={pendingAction.label}
          onConfirm={confirmPending}
          onCancel={cancelPending}
        />
      )}
    </div>
  );
}

// 테스트용 export
export const __internal = { parseFileName };
