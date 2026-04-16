import React, { useCallback, useEffect, useState, useRef } from 'react';
import SpreadsheetView from './SpreadsheetView';
import LogPanel from './LogPanel';
import CountdownModal from './CountdownModal';
import { sheetsToXlsx } from '../lib/excelFormats';
import {
  findLatest,
} from '../lib/vendorFiles';

/**
 * 작업 뷰 — FortuneSheet 기반 스프레드시트 편집
 *
 *   - job 폴더의 po.xlsx 를 FortuneSheet 로 렌더링
 *   - 편집 시 debounced 자동 저장 (같은 경로에 덮어쓰기)
 *   - PO 다운로드 완료 시 자동 리로드
 *   - Python subprocess 실행/취소 + 로그 스트리밍
 */

const MAX_LOG_ENTRIES = 500;
const AUTOSAVE_DELAY_MS = 3000;

const SESSION_STATUS = {
  UNKNOWN: 'unknown',
  CHECKING: 'checking',
  VALID: 'valid',
  EXPIRED: 'expired',
  LOGGING_IN: 'logging_in',
  ERROR: 'error',
};

export default function WorkView({ vendor, job }) {
  // ── 스프레드시트 데이터 ──
  const [xlsxBuffer, setXlsxBuffer] = useState(null);
  const [loadedPath, setLoadedPath] = useState(null);
  const [dirty, setDirty] = useState(false);

  const [logs, setLogs] = useState([
    { time: new Date().toISOString(), level: 'info', message: '작업 뷰가 초기화되었습니다.' },
  ]);
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
  const vendorRef = useRef(vendor);
  const loadedPathRef = useRef(loadedPath);
  const jobRef = useRef(job);
  const latestSheetsRef = useRef(null);

  useEffect(() => { vendorRef.current = vendor; }, [vendor]);
  useEffect(() => { loadedPathRef.current = loadedPath; }, [loadedPath]);
  useEffect(() => { jobRef.current = job; }, [job]);

  const appendLog = useCallback((level, message) => {
    setLogs((prev) => {
      const next = [...prev, { time: new Date().toISOString(), level, message }];
      return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
    });
  }, []);

  // ── Job 폴더의 po.xlsx 로드 (raw buffer) ──
  const loadJobPoFile = useCallback(async (j) => {
    if (!j) return false;
    const api = window.electronAPI;
    if (!api) return false;
    const resolved = await api.resolveJobPath(j.date, j.vendor, j.sequence, 'po.xlsx');
    if (!resolved?.success) return false;
    const exists = await api.fileExists(resolved.path);
    if (!exists) {
      appendLog('info', `[${j.vendor} ${j.sequence}차] PO 파일 없음 — 다운로드를 실행하세요.`);
      setXlsxBuffer(null);
      setLoadedPath(null);
      return false;
    }
    const read = await api.readFile(resolved.path);
    if (!read?.success) {
      appendLog('error', `PO 파일 읽기 실패: ${read?.error}`);
      return false;
    }
    setXlsxBuffer(read.data);
    setLoadedPath(resolved.path);
    setDirty(false);
    latestSheetsRef.current = null;
    appendLog('info', `PO 파일 로드: ${j.vendor} ${j.sequence}차`);
    return true;
  }, [appendLog]);

  // ── legacy 평면 파일 로드 (job 없을 때 폴백) ──
  const loadLegacyFile = useCallback(async (fileName) => {
    const api = window.electronAPI;
    if (!api) return false;
    const resolved = await api.resolveVendorPath(fileName);
    if (!resolved?.success) return false;
    const read = await api.readFile(resolved.path);
    if (!read?.success) {
      appendLog('error', `파일 읽기 실패: ${read?.error}`);
      return false;
    }
    setXlsxBuffer(read.data);
    setLoadedPath(resolved.path);
    setDirty(false);
    latestSheetsRef.current = null;
    appendLog('info', `파일 로드: ${fileName}`);
    return true;
  }, [appendLog]);

  // ── FortuneSheet onChange → autosave ──
  const handleSheetChange = useCallback((sheets) => {
    latestSheetsRef.current = sheets;
    setDirty(true);

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      autosaveTimerRef.current = null;
      const target = loadedPathRef.current;
      const data = latestSheetsRef.current;
      if (!target || !data) return;
      try {
        const buf = sheetsToXlsx(data);
        const api = window.electronAPI;
        const w = await api?.writeFile(target, buf);
        if (w?.success) {
          setDirty(false);
          setXlsxBuffer(buf);
          appendLog('info', '[자동 저장] 완료');
        }
      } catch (err) {
        appendLog('error', `자동 저장 실패: ${err.message}`);
      }
    }, AUTOSAVE_DELAY_MS);
  }, [appendLog]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  // ── Python 이벤트 리스너 ──
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const unsubLog = api.onPythonLog?.((data) => {
      const line = data.line || JSON.stringify(data);
      appendLog('info', line);

      if (data.parsed && data.parsed.type === 'result') {
        try {
          const result = JSON.parse(data.parsed.data || data.line);
          if (result.success && jobRef.current) {
            appendLog('info', `[PO 결과 수신] 자동 로드`);
            loadJobPoFile(jobRef.current);
          }
        } catch { /* 무시 */ }
      }

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

      if (
        (data.scriptName === 'scripts/po_download.py' || data.scriptName === 'po_download.py') &&
        data.exitCode === 0 && !data.killed
      ) {
        const j = jobRef.current;
        if (j) loadJobPoFile(j);
      }

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
  }, [appendLog, loadJobPoFile]);

  // ── 세션 확인 (CDP) ──
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
      appendLog('warn', `자격증명 미설정: ${missing.join(', ')}`);
    }
    return result;
  }, [appendLog]);

  // ── 벤더 변경 시 ──
  useEffect(() => {
    setLoginStatus(SESSION_STATUS.UNKNOWN);
    setCredentialStatus(null);
    setDirty(false);

    if (!vendor) {
      setXlsxBuffer(null);
      setLoadedPath(null);
      return;
    }

    checkCredentials(vendor);
    checkSessionStatus(true);

    if (job) return;
    const api = window.electronAPI;
    if (!api) return;
    (async () => {
      const res = await api.listVendorFiles(vendor);
      if (!res?.success) return;
      const latest = findLatest(res.files, vendor);
      if (!latest) {
        setXlsxBuffer(null);
        setLoadedPath(null);
        return;
      }
      await loadLegacyFile(latest);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor]);

  // ── Job 변경 시 ──
  useEffect(() => {
    if (!job) return;
    loadJobPoFile(job);
  }, [job?.date, job?.vendor, job?.sequence, loadJobPoFile]);

  // ── 세션 주기 폴링 ──
  useEffect(() => {
    if (!vendor || loginScriptRunning || pythonRunning) return;
    const id = setInterval(() => checkSessionStatus(true), 60_000);
    return () => clearInterval(id);
  }, [vendor, loginScriptRunning, pythonRunning, checkSessionStatus]);

  // ── 세션 만료 자동 재로그인 ──
  useEffect(() => { autoLoginTriggeredRef.current = false; }, [vendor]);
  useEffect(() => {
    if (
      loginStatus === SESSION_STATUS.EXPIRED &&
      credentialStatus?.hasId && credentialStatus?.hasPassword &&
      !pythonRunning && !loginScriptRunning &&
      !autoLoginTriggeredRef.current
    ) {
      autoLoginTriggeredRef.current = true;
      appendLog('info', '[Auto-Login] 세션 만료 감지 — 자동 재로그인 시도');
      handleLoginInternal(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginStatus, credentialStatus, pythonRunning, loginScriptRunning]);

  // ── 로그인 ──
  const handleLoginInternal = useCallback(async (forceRelogin = false) => {
    if (!vendor) return;
    const api = window.electronAPI;
    if (!api) return;
    const cred = await api.checkCredentials(vendor);
    if (!cred?.hasId || !cred?.hasPassword) {
      setLoginStatus(SESSION_STATUS.ERROR);
      return;
    }
    setLoginStatus(SESSION_STATUS.LOGGING_IN);
    setLoginScriptRunning(true);
    const scriptArgs = ['--vendor', vendor];
    if (forceRelogin) scriptArgs.push('--force');
    const res = await api.runPython('scripts/login.py', scriptArgs);
    if (res.success) {
      setPythonRunning(true);
    } else {
      setLoginStatus(SESSION_STATUS.ERROR);
      setLoginScriptRunning(false);
    }
  }, [vendor]);

  // ── 카운트다운 모달 ↔ WCV 가시성 ──
  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api) return;
    api.setVisible(!pendingAction);
  }, [pendingAction]);

  // ── PO 갱신 ──
  const handlePoRefresh = useCallback(async () => {
    if (!job) return;
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
    } else {
      appendLog('error', `PO 갱신 실행 실패: ${res.error}`);
    }
  }, [job, appendLog]);

  // ── Python 취소 ──
  const handleCancelPython = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    const res = await api.cancelPython();
    if (res.success) {
      appendLog('info', `Kill 신호 전송 (pid=${res.pid})`);
    } else {
      appendLog('error', `취소 실패: ${res.error}`);
    }
  }, [appendLog]);

  // ── 위험 동작 ──
  const requestDangerous = (label, run) => setPendingAction({ label, run });
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
            <button className="btn btn--danger btn--cancel-python" onClick={handleCancelPython} type="button">
              ⏹ 실행 취소
            </button>
            <span className="python-status python-status--running">● 실행 중</span>
          </>
        )}

        {dirty && <span className="workview-dirty-badge">미저장</span>}
        <div className="workview-toolbar__spacer" />
      </div>

      <div className="workview-table-section">
        <SpreadsheetView
          xlsxBuffer={xlsxBuffer}
          fileName="po.xlsx"
          onChange={handleSheetChange}
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
