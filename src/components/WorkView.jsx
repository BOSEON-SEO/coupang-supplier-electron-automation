import React, { useCallback, useEffect, useState, useRef } from 'react';
import SpreadsheetView from './SpreadsheetView';
import LogPanel from './LogPanel';
import CountdownModal from './CountdownModal';
import { sheetsToXlsx } from '../lib/excelFormats';
import { findLatest } from '../lib/vendorFiles';
import { getPlugin } from '../core/plugins';
import { nextPhase } from './PhaseStepper';
import { buildConfirmationArrayBuffer } from '../core/confirmationBuilder';
import { parsePoSheets } from '../core/poParser';

/**
 * 작업 뷰 — FortuneSheet 기반 스프레드시트 편집
 *
 *   - job 폴더의 po.xlsx 를 FortuneSheet 로 렌더링
 *   - 편집 시 debounced 자동 저장 (같은 경로에 덮어쓰기)
 *   - PO 다운로드 완료 시 자동 리로드
 *   - Python subprocess 실행/취소 + 로그 스트리밍
 */

const MAX_LOG_ENTRIES = 500;

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

  const [logs, setLogs] = useState([
    { time: new Date().toISOString(), level: 'info', message: '작업 뷰가 초기화되었습니다.' },
  ]);
  const [pendingAction, setPendingAction] = useState(null);
  const [pythonRunning, setPythonRunning] = useState(false);
  const [loginStatus, setLoginStatus] = useState(SESSION_STATUS.UNKNOWN);
  const [loginScriptRunning, setLoginScriptRunning] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // ── Refs ──
  const cleanupRef = useRef([]);
  const autoLoginTriggeredRef = useRef(false);
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
    latestSheetsRef.current = null;
    appendLog('info', `파일 로드: ${fileName}`);
    return true;
  }, [appendLog]);

  // ── FortuneSheet onChange → autosave ──
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // 파일 로드/초기화 시 dirty 리셋 (FortuneSheet 마운트 onChange 무시)
  useEffect(() => {
    setDirty(false);
    latestSheetsRef.current = null;
  }, [xlsxBuffer]);

  // FortuneSheet onChange — 편집 내용만 메모리에 보관 (자동 저장 X)
  const handleSheetChange = useCallback((sheets) => {
    latestSheetsRef.current = sheets;
    setDirty(true);
  }, []);

  // 수동 저장
  const handleSaveNow = useCallback(async () => {
    const target = loadedPathRef.current;
    const data = latestSheetsRef.current;
    if (!target || !data) {
      appendLog('warn', '저장할 데이터가 없습니다.');
      return;
    }
    setSaving(true);
    try {
      const buf = sheetsToXlsx(data);
      const api = window.electronAPI;
      const w = await api?.writeFile(target, buf);
      if (w?.success) {
        setDirty(false);
        appendLog('info', '[저장] 완료');
      } else {
        appendLog('error', `저장 실패: ${w?.error ?? 'unknown'}`);
      }
    } catch (err) {
      appendLog('error', `저장 실패: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [appendLog]);

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

  // ── Phase 진행 — 범용 ──
  //   po_downloaded → confirmed: 쿠팡 발주확정서 xlsx 생성 → job 폴더에 저장 → 뷰 교체
  //   그 외        : 플러그인이 있으면 plugin.buildSheet 로 시트 추가
  //                 없으면 manifest.phase 만 업데이트
  const handleAdvancePhase = useCallback(async () => {
    if (!job) return;
    const sheets = latestSheetsRef.current;
    const target = loadedPathRef.current;
    if (!sheets?.length) {
      appendLog('warn', `시트 데이터가 없습니다. (sheets=${sheets?.length ?? 'null'}, target=${target ? 'OK' : 'null'}) — FortuneSheet 마운트 대기 중일 수 있음`);
      return;
    }
    const next = nextPhase(job.phase);
    if (!next) {
      appendLog('info', '이미 마지막 phase 입니다.');
      return;
    }

    const api = window.electronAPI;

    // ── po_downloaded → confirmed: 발주확정서 별도 파일 생성 ──
    if (job.phase === 'po_downloaded' && next === 'confirmed') {
      try {
        appendLog('info', '[확정서] PO 시트 파싱 시작...');
        const masterData = parsePoSheets(sheets);
        if (!masterData.length) {
          appendLog('error', `PO 데이터 파싱 결과가 비어있습니다. 헤더를 확인하세요. (sheets=${sheets.length}, rows=${sheets[0]?.data?.length ?? 0})`);
          return;
        }
        appendLog('info', `[확정서] ${masterData.length}행 변환`);
        // 전역 기본값 + 벤더 override 병합
        const [vendorList, settingsRes] = await Promise.all([
          api.loadVendors(),
          api.loadSettings(),
        ]);
        const defaults = settingsRes?.settings || {};
        const vendorMeta = vendorList?.vendors?.find?.((v) => v.id === job.vendor) || {};
        const override = vendorMeta.settings || {};
        const pick = (k) =>
          (override[k] !== undefined && override[k] !== '') ? override[k] : (defaults[k] ?? '');
        const buf = await buildConfirmationArrayBuffer(masterData, {
          returnContact: pick('returnContact'),
          returnPhone: pick('returnPhone'),
          returnAddress: pick('returnAddress'),
          defaultTransport: pick('defaultTransport') || '쉽먼트',
          defaultShortageReason: pick('defaultShortageReason') || undefined,
          manufactureDateRule: pick('manufactureDateRule'),
          expirationDateRule: pick('expirationDateRule'),
          productionYearRule: pick('productionYearRule'),
        });

        const resolved = await api.resolveJobPath(
          job.date, job.vendor, job.sequence, 'confirmation.xlsx',
        );
        if (!resolved?.success) {
          appendLog('error', `확정서 경로 해석 실패: ${resolved?.error}`);
          return;
        }
        const w = await api.writeFile(resolved.path, buf);
        if (!w?.success) {
          appendLog('error', `확정서 저장 실패: ${w?.error ?? 'unknown'}`);
          return;
        }
        const patchRes = await api.jobs.updateManifest(
          job.date, job.vendor, job.sequence, { phase: next },
        );
        if (!patchRes?.success) {
          appendLog('error', `phase 업데이트 실패: ${patchRes?.error ?? 'unknown'}`);
          return;
        }

        // 뷰 교체
        setXlsxBuffer(buf);
        setLoadedPath(resolved.path);
        latestSheetsRef.current = null;
        appendLog('info', `[confirmed] 발주확정서 생성 — ${resolved.path}`);
      } catch (err) {
        appendLog('error', `확정서 생성 실패: ${err.message}`);
      }
      return;
    }

    // ── 나머지 phase: 플러그인 있으면 시트 추가, 없으면 phase 만 업데이트 ──
    const plugin = getPlugin(job.plugin);
    let finalSheets = sheets;

    if (plugin?.buildSheet) {
      try {
        const newSheet = plugin.buildSheet(next, sheets);
        if (newSheet) {
          const filtered = sheets.filter((s) => s.name !== newSheet.name);
          finalSheets = [...filtered, { ...newSheet, order: filtered.length }];
        }
      } catch (err) {
        appendLog('error', `플러그인 시트 생성 실패: ${err.message}`);
        return;
      }
    }

    try {
      if (finalSheets !== sheets && target) {
        const buf = sheetsToXlsx(finalSheets);
        const w = await api?.writeFile(target, buf);
        if (!w?.success) {
          appendLog('error', `시트 저장 실패: ${w?.error ?? 'unknown'}`);
          return;
        }
        setXlsxBuffer(buf);
      }
      const patchRes = await api.jobs.updateManifest(
        job.date, job.vendor, job.sequence, { phase: next },
      );
      if (!patchRes?.success) {
        appendLog('error', `phase 업데이트 실패: ${patchRes?.error ?? 'unknown'}`);
        return;
      }
      appendLog('info', `[${next}] phase 진행 완료`);
    } catch (err) {
      appendLog('error', `phase 진행 실패: ${err.message}`);
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
      <div className="workview-main">
      <div className="workview-toolbar">
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => requestDangerous('PO 갱신', handlePoRefresh)}
          type="button"
          disabled={!job || pythonRunning}
          title={!job ? '활성 작업 없음' : `${job.date} · ${job.vendor} · ${job.sequence}차 PO 재다운로드`}
        >
          🔄 PO 갱신
        </button>

        {job && (() => {
          const next = nextPhase(job.phase);
          if (!next || job.completed) return null;
          const LABEL = {
            confirmed: '📋 발주확정서 작성',
            uploaded: '⬆ 쿠팡 업로드 표시',
            assigned: '🚚 운송 분배',
            completed: '✓ 완료 표시',
          };
          return (
            <button
              className="btn btn--primary btn--sm"
              type="button"
              onClick={handleAdvancePhase}
              disabled={!xlsxBuffer}
              title={`다음 phase (${next}) 로 진행`}
            >
              {LABEL[next] || `→ ${next}`}
            </button>
          );
        })()}

        {pythonRunning && (
          <>
            <button className="btn btn--danger btn--sm" onClick={handleCancelPython} type="button">
              ⏹ 취소
            </button>
            <span className="python-status python-status--running">● 실행 중</span>
          </>
        )}
        <div className="workview-toolbar__spacer" />
      </div>

      <div className="workview-section-header">
        <div className="workview-file-tabs">
          <button
            type="button"
            className={`workview-file-tab${loadedPath?.endsWith('po.xlsx') ? ' is-active' : ''}`}
            onClick={() => job && loadJobPoFile(job)}
            disabled={!job}
          >
            📄 PO 원본
          </button>
          <button
            type="button"
            className={`workview-file-tab${loadedPath?.endsWith('confirmation.xlsx') ? ' is-active' : ''}`}
            onClick={async () => {
              if (!job) return;
              const api = window.electronAPI;
              const resolved = await api.resolveJobPath(job.date, job.vendor, job.sequence, 'confirmation.xlsx');
              if (!resolved?.success) return;
              const exists = await api.fileExists(resolved.path);
              if (!exists) {
                appendLog('info', '발주확정서가 아직 생성되지 않았습니다.');
                return;
              }
              const read = await api.readFile(resolved.path);
              if (read?.success) {
                setXlsxBuffer(read.data);
                setLoadedPath(resolved.path);
                latestSheetsRef.current = null;
                appendLog('info', '발주확정서 로드');
              }
            }}
            disabled={!job}
          >
            📋 발주확정서
          </button>
          {dirty && <span className="workview-section-header__dirty">· 변경됨</span>}
        </div>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={handleSaveNow}
          disabled={!dirty || saving || !xlsxBuffer}
          title="현재 파일에 덮어쓰기"
        >
          💾 {saving ? '저장 중...' : '저장'}
        </button>
      </div>
      <div className="workview-table-section">
        <SpreadsheetView
          xlsxBuffer={xlsxBuffer}
          fileName="po.xlsx"
          onChange={handleSheetChange}
          onReady={(sheets) => { latestSheetsRef.current = sheets; }}
        />
      </div>

      </div>

      <div className={`workview-log-dock${logOpen ? ' workview-log-dock--open' : ''}`}>
        <button
          type="button"
          className="workview-log-dock__bar"
          onClick={() => setLogOpen((o) => !o)}
          aria-expanded={logOpen}
        >
          <span>📋 작업 로그 <span className="workview-log-dock__count">({logs.length})</span></span>
          <span className="workview-log-dock__chev">{logOpen ? '▼' : '▲'}</span>
        </button>
        <div className="workview-log-dock__body">
          <LogPanel logs={logs} hideHeader />
        </div>
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
