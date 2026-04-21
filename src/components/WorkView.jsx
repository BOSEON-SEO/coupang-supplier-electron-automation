import React, { useCallback, useEffect, useState, useRef } from 'react';
import SpreadsheetView from './SpreadsheetView';
import LogPanel from './LogPanel';
import CountdownModal from './CountdownModal';
import { sheetsToXlsx } from '../lib/excelFormats';
import { findLatest } from '../lib/vendorFiles';
import { getPlugin } from '../core/plugins';
import { nextPhase } from './PhaseStepper';
import { buildConfirmationArrayBuffer } from '../core/confirmationBuilder';
import { parsePoSheets, parsePoBuffer } from '../core/poParser';
import { applyPoStyle } from '../core/poStyler';
import ResultView from './ResultView';

/**
 * 작업 뷰 — FortuneSheet 기반 스프레드시트 편집
 *
 *   - job 폴더의 po.xlsx 를 FortuneSheet 로 렌더링
 *   - 편집 시 debounced 자동 저장 (같은 경로에 덮어쓰기)
 *   - PO 다운로드 완료 시 자동 리로드
 *   - Python subprocess 실행/취소 + 로그 스트리밍
 */

const MAX_LOG_ENTRIES = 500;

// Playwright/Chromium/React 개발자 도구 관련 잡음 필터
const NOISE_PATTERNS = [
  /Download the React DevTools/i,
  /DevTools listening on ws:\/\//i,
  /chrome-error:\/\//i,
  /Autofill\.(enable|setAddresses) wasn't found/i,
  /Failed to connect to the bus/i,
  /Gtk-WARNING/i,
  /\[.*(INFO|WARNING)\]:.*libGL|libva/i,
];
function isNoisyLogLine(line) {
  if (!line || !line.trim()) return true;
  return NOISE_PATTERNS.some((re) => re.test(line));
}

const SESSION_STATUS = {
  UNKNOWN: 'unknown',
  CHECKING: 'checking',
  VALID: 'valid',
  EXPIRED: 'expired',
  LOGGING_IN: 'logging_in',
  ERROR: 'error',
};

export default function WorkView({ vendor, job, onCloseWork, onJobUpdated }) {
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

  // ── 플러그인 창으로 인한 잠금 상태 ──
  // 어떤 종류의 창이 열렸는지도 함께 — 배지 라벨링에 활용.
  const [lockedJobKeys, setLockedJobKeys] = useState([]);
  const [locks, setLocks] = useState({}); // { jobKey: { stockAdjust, transport } }
  const currentJobKey = job
    ? `${job.date}/${job.vendor}/${String(job.sequence).padStart(2, '0')}`
    : null;
  const jobLocked = !!currentJobKey && lockedJobKeys.includes(currentJobKey);
  const currentLockTypes = (currentJobKey && locks[currentJobKey]) || {};

  // ── job 폴더 파일 존재 여부 (phase 액션 버튼 enable/disable 판단용) ──
  const [poExists, setPoExists] = useState(false);
  const [confirmationExists, setConfirmationExists] = useState(false);

  // ── 활성 탭 ('po' | 'confirmation' | 'result') ──
  const [activeTab, setActiveTab] = useState('po');

  // ── 업로드 준비 스크립트가 끝나면 "업로드하셨나요?" 확인 오버레이 ──
  const [askUploadConfirm, setAskUploadConfirm] = useState(false);

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

  // ── 플러그인 창 lock 구독 ──
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.stockAdjust) return undefined;
    let alive = true;
    api.stockAdjust.getLocks().then((res) => {
      if (!alive) return;
      if (Array.isArray(res?.lockedJobKeys)) setLockedJobKeys(res.lockedJobKeys);
      if (res?.locks && typeof res.locks === 'object') setLocks(res.locks);
    });
    const unsub = api.stockAdjust.onLocksChanged((data) => {
      setLockedJobKeys(Array.isArray(data?.lockedJobKeys) ? data.lockedJobKeys : []);
      setLocks(data?.locks && typeof data.locks === 'object' ? data.locks : {});
    });
    return () => {
      alive = false;
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // ── 현재 job 의 플러그인 창 open/close 를 이벤트 로그로 ──
  const prevLockTypesRef = useRef({});
  useEffect(() => {
    if (!currentJobKey) return;
    const prev = prevLockTypesRef.current;
    const cur = locks[currentJobKey] || {};
    if (!prev.stockAdjust && cur.stockAdjust) appendLog('event', '📦 재고조정 창 열림');
    if (prev.stockAdjust && !cur.stockAdjust) appendLog('event', '📦 재고조정 창 닫힘 — 저장된 변경사항 반영');
    if (!prev.transport && cur.transport) appendLog('event', '🚚 운송분배 창 열림');
    if (prev.transport && !cur.transport) appendLog('event', '🚚 운송분배 창 닫힘 — 발주확정서 입고유형 갱신');
    prevLockTypesRef.current = cur;
  }, [locks, currentJobKey, appendLog]);

  // ── Python 실행 시작 시 작업 패널 자동 접기 (웹뷰 노출) ──
  const prevPythonRunningRef = useRef(false);
  useEffect(() => {
    if (!prevPythonRunningRef.current && pythonRunning) {
      onCloseWork?.();
    }
    prevPythonRunningRef.current = pythonRunning;
  }, [pythonRunning, onCloseWork]);

  // 플러그인 창이 닫히며 lock 이 풀리는 순간, 해당 변경 결과를 뷰에 자동 반영.
  //   재고조정 닫힘 → po.xlsx 보고 있으면 리로드 (확정수량 변경)
  //   운송분배 닫힘 → confirmation.xlsx 보고 있으면 리로드 (입고유형 패치 반영)
  const prevLockTypesReloadRef = useRef({});
  useEffect(() => {
    const prev = prevLockTypesReloadRef.current;
    const cur = currentLockTypes;
    prevLockTypesReloadRef.current = { ...cur };
    const j = jobRef.current;
    const p = loadedPathRef.current || '';
    if (!j) return;
    if (prev.stockAdjust && !cur.stockAdjust && p.endsWith('po.xlsx')) {
      loadJobPoFile(j);
    }
    if (prev.transport && !cur.transport && p.endsWith('confirmation.xlsx')) {
      (async () => {
        const api = window.electronAPI;
        if (!api) return;
        const resolved = await api.resolveJobPath(j.date, j.vendor, j.sequence, 'confirmation.xlsx');
        if (!resolved?.success) return;
        const read = await api.readFile(resolved.path);
        if (read?.success) {
          setXlsxBuffer(read.data);
          setLoadedPath(resolved.path);
          latestSheetsRef.current = null;
        }
      })();
    }
  }, [currentLockTypes.stockAdjust, currentLockTypes.transport]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── job 파일 존재 여부 프로브 (action bar 버튼 enable/disable 용) ──
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!job) {
        if (alive) { setPoExists(false); setConfirmationExists(false); }
        return;
      }
      const api = window.electronAPI;
      if (!api) return;
      const [poRes, confRes] = await Promise.all([
        api.resolveJobPath(job.date, job.vendor, job.sequence, 'po.xlsx'),
        api.resolveJobPath(job.date, job.vendor, job.sequence, 'confirmation.xlsx'),
      ]);
      const [poE, confE] = await Promise.all([
        poRes?.success ? api.fileExists(poRes.path) : Promise.resolve(false),
        confRes?.success ? api.fileExists(confRes.path) : Promise.resolve(false),
      ]);
      if (alive) {
        setPoExists(!!poE);
        setConfirmationExists(!!confE);
      }
    })();
    return () => { alive = false; };
  }, [job, jobLocked]);

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
    // 표시용으로만 스타일 입힘 (디스크 파일은 그대로)
    const styled = await applyPoStyle(read.data);
    setXlsxBuffer(styled);
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

  // ── PO → confirmation 확정수량/부족사유 부분 패치 (I, M 컬럼만) ──
  // 입고유형(C) 과 사용자 직접 편집은 보존. confirmation.xlsx 없으면 skipped.
  const patchConfirmationFromPo = useCallback(async () => {
    const j = jobRef.current;
    if (!j) return { success: false, skipped: true };
    const api = window.electronAPI;
    if (!api?.confirmation?.patchQuantities) return { success: false, skipped: true };

    const confPath = await api.resolveJobPath(j.date, j.vendor, j.sequence, 'confirmation.xlsx');
    if (!confPath?.success) return { success: false, error: confPath?.error };
    const confExists = await api.fileExists(confPath.path);
    if (!confExists) return { success: false, skipped: true };

    const poPath = await api.resolveJobPath(j.date, j.vendor, j.sequence, 'po.xlsx');
    if (!poPath?.success) return { success: false, error: poPath?.error };
    const poRead = await api.readFile(poPath.path);
    if (!poRead?.success) return { success: false, error: poRead?.error };

    const masterData = parsePoBuffer(poRead.data);
    if (!masterData.length) return { success: false, error: 'PO 데이터 비어있음' };

    const [vendorList, settingsRes] = await Promise.all([
      api.loadVendors(),
      api.loadSettings(),
    ]);
    const defaults = settingsRes?.settings || {};
    const vendorMeta = vendorList?.vendors?.find?.((v) => v.id === j.vendor) || {};
    const override = vendorMeta.settings || {};
    const pick = (k) =>
      (override[k] !== undefined && override[k] !== '') ? override[k] : (defaults[k] ?? '');
    const defaultShortageReason = pick('defaultShortageReason')
      || '협력사 재고부족 - 수입상품 입고지연 (선적/통관지연)';

    const patches = masterData.map((row) => {
      const confirmedQty = row.export_yn === 'N'
        ? '0'
        : String(row.confirmed_qty ?? row.order_quantity ?? 0);
      const confirmedNum = Number(confirmedQty) || 0;
      const orderNum = Number(row.order_quantity) || 0;
      const shortageReason = (confirmedNum < orderNum) ? defaultShortageReason : '';
      return {
        key: `${row.coupang_order_seq}|${row.departure_warehouse}|${row.sku_barcode}`,
        confirmedQty,
        shortageReason,
      };
    });

    const res = await api.confirmation.patchQuantities(j.date, j.vendor, j.sequence, patches);
    if (!res?.success) return res || { success: false };

    // 현재 확정서를 보고 있으면 즉시 리로드
    if (loadedPathRef.current?.endsWith('confirmation.xlsx')) {
      const read = await api.readFile(confPath.path);
      if (read?.success) {
        setXlsxBuffer(read.data);
        setLoadedPath(confPath.path);
        latestSheetsRef.current = null;
      }
    }
    return res;
  }, []);

  // 수동 저장 — PO 저장이면 confirmation.xlsx 의 I/M 도 자동 패치
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

        // PO 저장 후 자동으로 확정서의 확정수량·부족사유 갱신
        if (target.endsWith('po.xlsx')) {
          const res = await patchConfirmationFromPo();
          if (res?.success) {
            appendLog('event', `[확정서 자동갱신] ${res.patched}행 반영${res.unmatched?.length ? ` (미매칭 ${res.unmatched.length}행)` : ''}`);
          } else if (!res?.skipped && res?.error) {
            appendLog('warn', `[확정서 자동갱신] 실패: ${res.error}`);
          }
        }
      } else {
        appendLog('error', `저장 실패: ${w?.error ?? 'unknown'}`);
      }
    } catch (err) {
      appendLog('error', `저장 실패: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [appendLog, patchConfirmationFromPo]);

  // ── Python 이벤트 리스너 ──
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const unsubLog = api.onPythonLog?.((data) => {
      const line = data.line || JSON.stringify(data);
      if (isNoisyLogLine(line)) return;
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
      const line = data.line || JSON.stringify(data);
      if (isNoisyLogLine(line)) return;
      appendLog('error', line);
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

      // 업로드 준비 스크립트가 성공적으로 끝나면 "업로드하셨나요?" 오버레이 띄움
      if (
        (data.scriptName === 'scripts/po_upload.py' || data.scriptName === 'po_upload.py') &&
        data.exitCode === 0 && !data.killed
      ) {
        setAskUploadConfirm(true);
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
      // 실제 동작 관찰을 위해 작업 패널 닫고 웹뷰 노출
      onCloseWork?.();
    } else {
      appendLog('error', `PO 갱신 실행 실패: ${res.error}`);
    }
  }, [job, appendLog, onCloseWork]);

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
          const first = sheets[0] || {};
          appendLog('error', `PO 데이터 파싱 결과가 비어있습니다. 헤더를 확인하세요. (sheets=${sheets.length}, data=${first.data?.length ?? 0}, celldata=${first.celldata?.length ?? 0})`);
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

  // ── 발주확정서 제작/부분갱신 ──
  //   없을 때: PO 에서 전체 생성 (초기 1회)
  //   있을 때: I(확정수량) · M(납품부족사유) 만 in-place 패치 — 다른 편집 전부 보존
  // PO 편집 중이었다면 먼저 저장한 뒤 진행.
  const handleBuildConfirmation = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;

    // 현재 보고 있는 게 PO 이고 변경사항 있으면 먼저 저장
    if (dirty && loadedPathRef.current?.endsWith('po.xlsx') && latestSheetsRef.current) {
      try {
        const buf = sheetsToXlsx(latestSheetsRef.current);
        const w = await api.writeFile(loadedPathRef.current, buf);
        if (!w?.success) {
          appendLog('error', `PO 저장 실패: ${w?.error ?? 'unknown'}`);
          return;
        }
        setDirty(false);
        appendLog('info', '[확정서] 편집된 PO 먼저 저장');
      } catch (err) {
        appendLog('error', `PO 저장 실패: ${err.message}`);
        return;
      }
    }

    // confirmation.xlsx 가 이미 있으면 부분 갱신 경로
    if (confirmationExists) {
      const res = await patchConfirmationFromPo();
      if (res?.skipped) return;
      if (!res?.success) {
        appendLog('error', `확정수량 반영 실패: ${res?.error ?? 'unknown'}`);
        return;
      }
      appendLog('info', `[확정수량 반영] ${res.patched}행 갱신${res.unmatched?.length ? ` (미매칭 ${res.unmatched.length}행)` : ''}`);
      setActiveTab('confirmation');
      return;
    }

    try {
      const poPath = await api.resolveJobPath(job.date, job.vendor, job.sequence, 'po.xlsx');
      if (!poPath?.success) {
        appendLog('error', `po.xlsx 경로 해석 실패: ${poPath?.error}`);
        return;
      }
      const exists = await api.fileExists(poPath.path);
      if (!exists) {
        appendLog('warn', 'po.xlsx 가 없습니다. 먼저 PO 를 다운로드하세요.');
        return;
      }
      const poRead = await api.readFile(poPath.path);
      if (!poRead?.success) {
        appendLog('error', `po.xlsx 읽기 실패: ${poRead?.error}`);
        return;
      }

      appendLog('info', '[확정서] PO 파일 파싱 중...');
      const masterData = parsePoBuffer(poRead.data);
      if (!masterData.length) {
        appendLog('error', 'PO 데이터 파싱 결과가 비어있습니다.');
        return;
      }
      appendLog('info', `[확정서] ${masterData.length}행 변환`);

      // 벤더 설정 + 전역 기본값 병합
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

      const confirmPath = await api.resolveJobPath(
        job.date, job.vendor, job.sequence, 'confirmation.xlsx',
      );
      if (!confirmPath?.success) {
        appendLog('error', `확정서 경로 해석 실패: ${confirmPath?.error}`);
        return;
      }
      const w = await api.writeFile(confirmPath.path, buf);
      if (!w?.success) {
        appendLog('error', `확정서 저장 실패: ${w?.error ?? 'unknown'}`);
        return;
      }

      // phase 가 po_downloaded 였다면 confirmed 로 전환
      if (job.phase === 'po_downloaded') {
        await api.jobs.updateManifest(
          job.date, job.vendor, job.sequence, { phase: 'confirmed' },
        );
      }

      setXlsxBuffer(buf);
      setLoadedPath(confirmPath.path);
      latestSheetsRef.current = null;
      setConfirmationExists(true);
      setActiveTab('confirmation');
      appendLog('info', `[확정서] 생성 완료 — ${confirmPath.path}`);
    } catch (err) {
      appendLog('error', `확정서 생성 실패: ${err.message}`);
    }
  }, [job, dirty, confirmationExists, patchConfirmationFromPo, appendLog]);

  // ── 현재 탭 파일을 사용자 지정 위치로 다운로드 ──
  const handleDownload = useCallback(async (kind) => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;

    // 편집 중이면 먼저 저장 (PO 변경사항 손실 방지)
    if (dirty && latestSheetsRef.current && loadedPathRef.current?.endsWith(`${kind}.xlsx`)) {
      try {
        const buf = sheetsToXlsx(latestSheetsRef.current);
        const w = await api.writeFile(loadedPathRef.current, buf);
        if (!w?.success) {
          appendLog('error', `저장 실패: ${w?.error ?? 'unknown'}`);
          return;
        }
        setDirty(false);
        appendLog('info', '[다운로드] 편집 내용 먼저 저장');
      } catch (err) {
        appendLog('error', `저장 실패: ${err.message}`);
        return;
      }
    }

    const fileName = kind === 'po' ? 'po.xlsx' : 'confirmation.xlsx';
    const resolved = await api.resolveJobPath(job.date, job.vendor, job.sequence, fileName);
    if (!resolved?.success) {
      appendLog('error', `경로 해석 실패: ${resolved?.error}`);
      return;
    }
    const exists = await api.fileExists(resolved.path);
    if (!exists) {
      appendLog('warn', `${fileName} 이 아직 없습니다.`);
      return;
    }
    const dateCompact = String(job.date).replace(/-/g, '');
    const seq = String(job.sequence).padStart(2, '0');
    const defaultName = `${job.vendor}-${dateCompact}-${seq}-${kind === 'po' ? 'PO' : '발주확정서'}.xlsx`;
    const res = await api.saveFileAs(resolved.path, defaultName);
    if (res?.canceled) return;
    if (!res?.success) {
      appendLog('error', `다운로드 실패: ${res?.error ?? 'unknown'}`);
      return;
    }
    appendLog('info', `[다운로드] ${res.path}`);
  }, [job, dirty, appendLog]);

  // ── 발주확정 업로드 준비 (업로드 직전 정지) ──
  // 주의: 업로드 이력 확인은 handleUploadClickStart 에서 카운트다운 전에 수행.
  const handleUploadPrepare = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;

    // 현재 탭이 확정서면 dirty 내용 먼저 디스크에 저장
    if (dirty && latestSheetsRef.current && loadedPathRef.current?.endsWith('confirmation.xlsx')) {
      try {
        const buf = sheetsToXlsx(latestSheetsRef.current);
        const w = await api.writeFile(loadedPathRef.current, buf);
        if (!w?.success) {
          appendLog('error', `저장 실패: ${w?.error ?? 'unknown'}`);
          return;
        }
        setDirty(false);
        appendLog('info', '[업로드 준비] 편집 내용 먼저 저장');
      } catch (err) {
        appendLog('error', `저장 실패: ${err.message}`);
        return;
      }
    }

    // 파일 존재 확인
    const resolved = await api.resolveJobPath(job.date, job.vendor, job.sequence, 'confirmation.xlsx');
    if (!resolved?.success) {
      appendLog('error', `경로 해석 실패: ${resolved?.error}`);
      return;
    }
    const exists = await api.fileExists(resolved.path);
    if (!exists) {
      appendLog('warn', '확정서(confirmation.xlsx) 가 아직 생성되지 않았습니다.');
      return;
    }

    appendLog('info', `업로드 준비 시작: ${job.vendor} · ${job.date} · ${job.sequence}차`);
    const res = await api.runPython('scripts/po_upload.py', [
      '--vendor', job.vendor,
      '--date', job.date,
      '--sequence', String(job.sequence),
    ]);
    if (res.success) {
      setPythonRunning(true);
      // 웹뷰에 쿠팡 업로드 폼을 보여주기 위해 작업 패널 닫음
      onCloseWork?.();
    } else {
      appendLog('error', `업로드 준비 실행 실패: ${res.error}`);
    }
  }, [job, dirty, appendLog, onCloseWork]);

  // ── 업로드 준비 버튼 onClick — 이력 있으면 카운트다운 전에 확인 ──
  const handleUploadClickStart = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;
    try {
      const mres = await api.jobs.loadManifest(job.date, job.vendor, job.sequence);
      const hist = mres?.success ? mres.manifest?.uploadHistory : null;
      const prevCount = Array.isArray(hist) ? hist.length : 0;
      if (prevCount > 0) {
        const proceed = window.confirm(
          `이 작업에 업로드 기록이 이미 ${prevCount}회 존재합니다.\n계속 진행하시겠습니까?`
        );
        if (!proceed) return;
      }
    } catch { /* 조회 실패해도 진행 */ }
    setPendingAction({ label: '발주확정 업로드 준비', run: handleUploadPrepare });
  }, [job, handleUploadPrepare]);

  // ── 업로드 기록 (쿠팡 업로드 완료 후 수동 체크) ──
  const handleRecordUpload = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api?.jobs?.recordUpload) return;
    const res = await api.jobs.recordUpload(job.date, job.vendor, job.sequence);
    if (!res?.success) {
      appendLog('error', `업로드 기록 실패: ${res?.error ?? 'unknown'}`);
      return;
    }
    appendLog('event', `[업로드 기록] 스냅샷 저장: ${res.entry.fileName}`);
    if (res.manifest) onJobUpdated?.(res.manifest);
  }, [job, appendLog, onJobUpdated]);

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
      {/* Row 1: 파일 탭 (왼쪽) + PO 갱신 (오른쪽) */}
      <div className="workview-section-header">
        <div className="workview-file-tabs">
          <button
            type="button"
            className={`workview-file-tab${activeTab === 'po' ? ' is-active' : ''}`}
            onClick={() => {
              if (!job) return;
              setActiveTab('po');
              if (!loadedPath?.endsWith('po.xlsx')) loadJobPoFile(job);
            }}
            disabled={!job}
          >
            📄 PO 원본
          </button>
          <button
            type="button"
            className={`workview-file-tab${activeTab === 'confirmation' ? ' is-active' : ''}`}
            onClick={async () => {
              if (!job) return;
              setActiveTab('confirmation');
              const api = window.electronAPI;
              const resolved = await api.resolveJobPath(job.date, job.vendor, job.sequence, 'confirmation.xlsx');
              if (!resolved?.success) return;
              const exists = await api.fileExists(resolved.path);
              if (!exists) {
                appendLog('info', '발주확정서가 아직 생성되지 않았습니다. 📋 확정서 생성 버튼을 누르세요.');
                return;
              }
              if (loadedPath === resolved.path) return; // 이미 로드됨
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
          <button
            type="button"
            className={`workview-file-tab${activeTab === 'result' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('result')}
            disabled={!job}
          >
            📊 결과/출력
          </button>
          {dirty && activeTab !== 'result' && <span className="workview-section-header__dirty">· 변경됨</span>}
          {jobLocked && (
            <span
              className="workview-lock-badge"
              title="해당 창이 열려있는 동안 원본 PO / 발주확정서는 편집 잠금"
            >
              {currentLockTypes.stockAdjust && currentLockTypes.transport
                ? '🔒 재고 조정 · 운송 분배 작업중'
                : currentLockTypes.stockAdjust
                ? '🔒 재고 조정 작업중'
                : currentLockTypes.transport
                ? '🔒 운송 분배 작업중'
                : '🔒 작업중'}
            </span>
          )}
        </div>

        <div className="workview-section-header__spacer" />

        {pythonRunning && (
          <>
            <button className="btn btn--danger btn--sm" onClick={handleCancelPython} type="button">
              ⏹ 취소
            </button>
            <span className="python-status python-status--running">● 실행 중</span>
          </>
        )}

        <button
          className="btn btn--caution btn--sm"
          onClick={() => requestDangerous('PO 갱신', handlePoRefresh)}
          type="button"
          disabled={!job || pythonRunning}
          title={!job ? '활성 작업 없음' : `${job.date} · ${job.vendor} · ${job.sequence}차 PO 재다운로드 — 파이프라인 초기화`}
        >
          🔄 PO 갱신
        </button>
      </div>

      {/* Row 2: 탭 컨텍스트 액션 (왼쪽) + 다운로드/저장 (오른쪽) — 결과 탭에서는 생략 */}
      {activeTab !== 'result' && (
      <div className="workview-actions-bar">
        {activeTab === 'po' && (
          <>
            <button
              type="button"
              className="btn btn--phase-adjust btn--sm"
              onClick={() => job && window.electronAPI?.stockAdjust?.open(job.date, job.vendor, job.sequence)}
              disabled={!job || !poExists || jobLocked}
              title={
                !poExists ? 'po.xlsx 가 아직 없습니다'
                  : jobLocked ? '이미 플러그인 창이 열려있습니다'
                  : 'SKU 별로 그룹핑해서 각 발주별 출고수량을 지정'
              }
            >
              📦 재고조정
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleBuildConfirmation}
              disabled={!job || !poExists || pythonRunning || jobLocked}
              title={
                !poExists ? 'po.xlsx 가 아직 없습니다'
                  : jobLocked ? '플러그인 창이 열려있습니다'
                  : confirmationExists
                    ? 'PO 의 확정수량·부족사유만 확정서에 반영 (입고유형·사용자 편집 보존)'
                    : 'PO 로부터 발주확정서 최초 생성'
              }
            >
              {confirmationExists ? '🔄 확정수량 반영' : '📋 확정서 생성'}
            </button>
          </>
        )}
        {activeTab === 'confirmation' && (
          <>
            <button
              type="button"
              className="btn btn--phase-transport btn--sm"
              onClick={() => job && window.electronAPI?.transport?.open(job.date, job.vendor, job.sequence)}
              disabled={!job || !confirmationExists || jobLocked}
              title={
                !confirmationExists ? '확정서가 아직 없습니다'
                  : jobLocked ? '이미 플러그인 창이 열려있습니다'
                  : '창고별 쉽먼트/밀크런 결정 · 박스/팔레트 배정'
              }
            >
              🚚 운송 분배
            </button>
            <button
              type="button"
              className="btn btn--phase-upload btn--sm"
              onClick={handleUploadClickStart}
              disabled={!job || !confirmationExists || pythonRunning || jobLocked}
              title={
                !confirmationExists ? '확정서가 아직 없습니다'
                  : jobLocked ? '플러그인 창이 열려있습니다'
                  : '업로드 폼·약관 동의·파일 주입까지 자동 — 업로드 실행 버튼은 수동'
              }
            >
              📤 발주확정
            </button>
            <button
              type="button"
              className="btn btn--phase-milkrun btn--sm"
              onClick={() => appendLog('warn', '🚛 밀크런 등록 — 추후 구현 예정')}
              disabled={!job || !confirmationExists || pythonRunning || jobLocked}
              title="밀크런 배치등록 (추후 구현)"
            >
              🚛 밀크런 등록
            </button>
            <button
              type="button"
              className="btn btn--phase-shipment btn--sm"
              onClick={() => appendLog('warn', '📦 쉽먼트 등록 — 추후 구현 예정')}
              disabled={!job || !confirmationExists || pythonRunning || jobLocked}
              title="쉽먼트 등록 (추후 구현)"
            >
              📦 쉽먼트 등록
            </button>
          </>
        )}

        <div className="workview-actions-bar__spacer" />

        {activeTab !== 'result' && (
          <>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => handleDownload(activeTab === 'confirmation' ? 'confirmation' : 'po')}
              disabled={!job || !xlsxBuffer}
              title="현재 탭 파일을 xlsx 로 다운로드"
            >
              📥 다운로드
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={handleSaveNow}
              disabled={!dirty || saving || !xlsxBuffer || jobLocked}
              title={jobLocked ? '플러그인 창이 열려있습니다' : '현재 파일에 덮어쓰기'}
            >
              💾 {saving ? '저장 중...' : '저장'}
            </button>
          </>
        )}
      </div>
      )}

      {activeTab === 'result' ? (
        <div className="workview-table-section">
          <ResultView job={job} appendLog={appendLog} onJobUpdated={onJobUpdated} />
        </div>
      ) : (
        <div className="workview-table-section">
          <SpreadsheetView
            xlsxBuffer={xlsxBuffer}
            fileName="po.xlsx"
            onChange={handleSheetChange}
            onReady={(sheets) => { latestSheetsRef.current = sheets; }}
          />
        </div>
      )}

      {askUploadConfirm && (
        <div className="workview-overlay" role="dialog" aria-modal="true">
          <div className="workview-overlay__card">
            <h3 className="workview-overlay__title">📤 쿠팡에 업로드를 완료하셨나요?</h3>
            <p className="workview-overlay__desc">
              웹 뷰에서 <b>업로드 실행</b> 버튼을 눌러 정상적으로 제출되었다면,
              지금 스냅샷을 업로드 이력으로 기록할 수 있습니다.
              <br />
              기록하면 현재 <code>confirmation.xlsx</code> 가 <code>history/</code> 폴더에 복사되고,
              phase 가 <code>uploaded</code> 로 전환됩니다.
            </p>
            <div className="workview-overlay__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setAskUploadConfirm(false)}
              >
                아니오 / 닫기
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={async () => {
                  await handleRecordUpload();
                  setAskUploadConfirm(false);
                }}
              >
                ✅ 예, 기록합니다
              </button>
            </div>
          </div>
        </div>
      )}

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
