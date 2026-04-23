import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import SpreadsheetView from './SpreadsheetView';
import LogPanel from './LogPanel';
import CountdownModal from './CountdownModal';
import { sheetsToXlsx } from '../lib/excelFormats';
import { findLatest } from '../lib/vendorFiles';
import { getPlugin } from '../core/plugins';
import { SlotRenderer, usePluginRuntime } from '../core/plugin-host';
import { getCommandsForScope } from '../core/plugin-registry';
import { KNOWN_SCOPES } from '../core/plugin-api';
import { nextPhase } from './PhaseStepper';
import { buildConfirmationArrayBuffer, applyDateRule } from '../core/confirmationBuilder';
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

  // ── 활성 탭 ('po' | 'confirmation' | 'result' | 'plugin:<id>') ──
  const [activeTab, setActiveTab] = useState('po');

  // ── 플러그인 탭 기여 (scope=work.tab.extra) ──
  // command.fileName 으로 표시할 파일을 지정하는 규약.
  const pluginRuntime = usePluginRuntime();
  const pluginTabs = useMemo(() => {
    return getCommandsForScope(KNOWN_SCOPES.WORK_TAB_EXTRA, {
      currentVendor: pluginRuntime.currentVendor,
      entitlements: pluginRuntime.entitlements,
      job, phase: job?.phase,
    });
  }, [pluginRuntime.currentVendor, pluginRuntime.entitlements, job]);

  // 활성 탭이 플러그인 탭일 때 그 command 반환
  const activePluginTab = useMemo(() => {
    if (!activeTab.startsWith('plugin:')) return null;
    const id = activeTab.slice('plugin:'.length);
    return pluginTabs.find((c) => c.id === id) || null;
  }, [activeTab, pluginTabs]);

  // 플러그인 탭을 after='po' 와 나머지로 분리 (나머지는 끝에)
  const pluginTabsAfterPo = useMemo(
    () => pluginTabs.filter((c) => c.after === 'po'),
    [pluginTabs],
  );
  const pluginTabsAtEnd = useMemo(
    () => pluginTabs.filter((c) => c.after !== 'po'),
    [pluginTabs],
  );

  /**
   * 플러그인 탭 클릭 핸들러 — fileName 으로 파일 로드.
   * 파일 없으면 (= 플러그인 후처리 전) 안내만.
   */
  const handlePluginTabClick = useCallback(async (cmd) => {
    if (!job) return;
    setActiveTab(`plugin:${cmd.id}`);
    if (!cmd.fileName) return;
    const api = window.electronAPI;
    const resolved = await api.resolveJobPath(job.date, job.vendor, job.sequence, cmd.fileName);
    if (!resolved?.success) return;
    const exists = await api.fileExists(resolved.path);
    if (!exists) {
      appendLog('info', `${cmd.title}: 파일이 아직 생성되지 않았습니다 (${cmd.fileName}).`);
      setXlsxBuffer(null);
      setLoadedPath(null);
      return;
    }
    if (loadedPath === resolved.path) return;
    const read = await api.readFile(resolved.path);
    if (read?.success) {
      setXlsxBuffer(read.data);
      setLoadedPath(resolved.path);
      latestSheetsRef.current = null;
      appendLog('info', `${cmd.title} 로드 (${cmd.fileName})`);
    }
  }, [job, loadedPath, appendLog]);

  // ── 업로드 준비 스크립트가 끝나면 "업로드하셨나요?" 확인 오버레이 ──
  const [askUploadConfirm, setAskUploadConfirm] = useState(false);
  // ── 밀크런 등록 스크립트가 끝나면 "저장하셨나요?" 확인 오버레이 ──
  const [askMilkrunConfirm, setAskMilkrunConfirm] = useState(false);
  // ── 쉽먼트 등록 스크립트가 끝나면 "생성하셨나요?" 확인 오버레이 ──
  // 센터 단위로 처리되므로 직전 처리한 센터명을 같이 보관.
  const [askShipmentConfirm, setAskShipmentConfirm] = useState(null); // null | { center }

  // 오버레이는 toast 스타일(position: fixed, 우상단) 이라 패널 상태와 무관하게
  // 항상 뷰포트 위에 떠 있다. 웹뷰를 가리지 않으려 dim 없음 + 카드만 pointer-events.

  // ── Refs ──
  const cleanupRef = useRef([]);
  const autoLoginTriggeredRef = useRef(false);
  const vendorRef = useRef(vendor);
  const loadedPathRef = useRef(loadedPath);
  const jobRef = useRef(job);
  const latestSheetsRef = useRef(null);
  const lastShipmentResultRef = useRef(null); // 마지막 쉽먼트 스크립트의 result payload
  const lastMilkrunDocsResultRef = useRef(null); // 마지막 밀크런 서류 다운 스크립트의 result payload
  const lastShipmentDocsResultRef = useRef(null); // 마지막 쉽먼트 서류 다운 스크립트의 result payload

  useEffect(() => { vendorRef.current = vendor; }, [vendor]);
  useEffect(() => { loadedPathRef.current = loadedPath; }, [loadedPath]);
  useEffect(() => { jobRef.current = job; }, [job]);
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // 다른 프로세스/플러그인이 파일을 갱신했을 때 자동 재로드.
  // 현재 표시 중인 탭의 파일이 방금 갱신된 것과 일치하면 메모리 버퍼 무효화.
  // 사용자가 편집 중(dirty=true) 이면 손실 방지 위해 건너뜀.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onJobFileUpdated) return undefined;
    const off = api.onJobFileUpdated(async (data) => {
      const j = jobRef.current;
      if (!j) return;
      if (data.date !== j.date || data.vendor !== j.vendor || data.sequence !== j.sequence) return;
      const cur = loadedPathRef.current || '';
      if (!cur.endsWith(data.file)) return;
      if (dirtyRef.current) return;
      const read = await api.readFile(cur);
      if (read?.success) {
        setXlsxBuffer(read.data);
        latestSheetsRef.current = null;
        appendLog('info', `[자동갱신] ${data.file} 재로드${typeof data.patched === 'number' ? ` (${data.patched}행)` : ''}`);
      }
    });
    return off;
  }, [appendLog]);

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

  // 플러그인 탭 저장 — command.onSave 가 있으면 그걸 호출 (파일 덮어쓰기 대신).
  const handlePluginSave = useCallback(async () => {
    const cmd = activePluginTab;
    if (!cmd?.onSave) return;
    const data = latestSheetsRef.current;
    if (!data || !job) {
      appendLog('warn', '저장할 데이터가 없습니다.');
      return;
    }
    setSaving(true);
    try {
      const buf = sheetsToXlsx(data);
      await cmd.onSave(buf, { job, electronAPI: window.electronAPI });
      setDirty(false);
      appendLog('info', `[${cmd.title}] 저장 완료`);
    } catch (err) {
      appendLog('error', `[${cmd.title}] 저장 실패: ${err.message}`);
      alert(`저장 실패: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [activePluginTab, job, appendLog]);

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
            const sn = data.scriptName || '';
            if (sn.endsWith('po_download.py')) {
              appendLog('info', `[PO 결과 수신] 자동 로드`);
              loadJobPoFile(jobRef.current);
            } else if (sn.endsWith('shipment_register.py')) {
              // done 이벤트가 오버레이 띄울 때 center 쓰도록 ref 에 보관
              lastShipmentResultRef.current = result;
            } else if (sn.endsWith('milkrun_docs_download.py')) {
              // done 이벤트가 manifest.downloadHistory 쌓을 때 사용하도록 ref 에 보관
              lastMilkrunDocsResultRef.current = result;
            } else if (sn.endsWith('shipment_docs_download.py')) {
              lastShipmentDocsResultRef.current = result;
            }
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

      // 오버레이는 실행 시작 시점(handleXxxRegister)에 이미 띄워뒀다.
      // 여기서는 결과 메타(쉽먼트 center/boxCount/sku 등)만 덮어쓰고,
      // 스크립트가 실패(exit!=0)하거나 kill 됐으면 오버레이 자동 dismiss.
      const isUploadScript = data.scriptName === 'scripts/po_upload.py' || data.scriptName === 'po_upload.py';
      const isMilkrunScript = data.scriptName === 'scripts/milkrun_register.py' || data.scriptName === 'milkrun_register.py';
      const isShipmentScript = data.scriptName === 'scripts/shipment_register.py' || data.scriptName === 'shipment_register.py';

      if (isUploadScript || isMilkrunScript || isShipmentScript) {
        if (data.killed || data.exitCode !== 0) {
          if (isUploadScript) setAskUploadConfirm(false);
          if (isMilkrunScript) setAskMilkrunConfirm(false);
          if (isShipmentScript) setAskShipmentConfirm(null);
        } else if (isShipmentScript) {
          // 쉽먼트: 결과 메타로 오버레이 내용 보강
          const r = lastShipmentResultRef.current;
          lastShipmentResultRef.current = null;
          if (r) {
            setAskShipmentConfirm((prev) => (prev ? {
              ...prev,
              center: r.center ?? prev.center ?? null,
              boxCount: r.boxCount ?? prev.boxCount ?? null,
              skuFilled: r.skuFilled ?? prev.skuFilled ?? null,
              skuTotal: r.skuTotal ?? prev.skuTotal ?? null,
            } : {
              center: r.center ?? null,
              boxCount: r.boxCount ?? null,
              skuFilled: r.skuFilled ?? null,
              skuTotal: r.skuTotal ?? null,
            }));
          }
        }
      }

      // 밀크런/쉽먼트 서류 일괄 다운로드가 성공하면 manifest.downloadHistory 에 기록
      const docsDoneMap = [
        { suffix: 'milkrun_docs_download.py',  type: 'milkrun-docs',  ref: lastMilkrunDocsResultRef,  label: '밀크런 서류' },
        { suffix: 'shipment_docs_download.py', type: 'shipment-docs', ref: lastShipmentDocsResultRef, label: '쉽먼트 서류' },
      ];
      const docsDone = docsDoneMap.find((e) =>
        data.scriptName === `scripts/${e.suffix}` || data.scriptName === e.suffix,
      );
      if (docsDone && data.exitCode === 0 && !data.killed) {
        const r = docsDone.ref.current;
        docsDone.ref.current = null;
        const j = jobRef.current;
        const api = window.electronAPI;
        if (j && api?.jobs?.loadManifest && api?.jobs?.updateManifest && r?.folder) {
          (async () => {
            try {
              const mres = await api.jobs.loadManifest(j.date, j.vendor, j.sequence);
              const manifest = mres?.success ? (mres.manifest || {}) : {};
              const prev = Array.isArray(manifest.downloadHistory) ? manifest.downloadHistory : [];
              const entry = {
                timestamp: new Date().toISOString(),
                type: docsDone.type,
                folder: r.folder,
                files: Array.isArray(r.files) ? r.files : [],
              };
              const patch = { downloadHistory: [...prev, entry] };
              const resU = await api.jobs.updateManifest(j.date, j.vendor, j.sequence, patch);
              if (!resU?.success) {
                appendLog('error', `다운로드 이력 기록 실패: ${resU?.error ?? 'unknown'}`);
                return;
              }
              appendLog('event', `[📥 ${docsDone.label} 다운] ${entry.files.length}개 파일 · ${r.folder}`);
              if (resU.manifest) onJobUpdated?.(resU.manifest);
            } catch (err) {
              appendLog('error', `다운로드 이력 기록 실패: ${err.message}`);
            }
          })();
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
          baseDate: job.date, // 입고예정일 기준으로 날짜 규칙 적용
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

  // ── PO 편집 중이면 먼저 디스크에 저장 ──
  const saveDirtyPoIfAny = useCallback(async () => {
    if (!dirty) return true;
    if (!loadedPathRef.current?.endsWith('po.xlsx') || !latestSheetsRef.current) return true;
    const api = window.electronAPI;
    try {
      const buf = sheetsToXlsx(latestSheetsRef.current);
      const w = await api.writeFile(loadedPathRef.current, buf);
      if (!w?.success) {
        appendLog('error', `PO 저장 실패: ${w?.error ?? 'unknown'}`);
        return false;
      }
      setDirty(false);
      appendLog('info', '[확정서] 편집된 PO 먼저 저장');
      return true;
    } catch (err) {
      appendLog('error', `PO 저장 실패: ${err.message}`);
      return false;
    }
  }, [dirty, appendLog]);

  // ── 발주확정서 생성 (PO + 설정으로 새 파일 빌드) ──
  // confirm UI 없음. 기존 파일이 있으면 덮어씀.
  // handleApplyConfirmation 이 "없을 때만" 호출. 있을 때는 patch 로 I/M 만 갱신.
  const generateConfirmationFresh = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;

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
        baseDate: job.date, // 입고예정일 기준으로 날짜 규칙 적용
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
  }, [job, appendLog]);

  // ── 발주확정서 반영/생성 (통합) ──
  // 기존 "확정수량 반영" + "확정서 생성/재생성" 3갈래를 하나로. 복합키 기반 patch.
  //   - confirmation 없으면 → generateConfirmationFresh (신규 생성)
  //   - 있으면 → patchConfirmationFromPo (I·M 만 patch, 다른 편집 보존)
  //   - 복합키: 발주번호|물류센터|상품바코드 (patchConfirmationFromPo 내부)
  const handleApplyConfirmation = useCallback(async () => {
    if (!job) return;
    if (!(await saveDirtyPoIfAny())) return;
    if (!confirmationExists) {
      await generateConfirmationFresh();
      return;
    }
    const res = await patchConfirmationFromPo();
    if (res?.skipped) return;
    if (!res?.success) {
      appendLog('error', `확정서 반영 실패: ${res?.error ?? 'unknown'}`);
      return;
    }
    appendLog('info', `[확정서 반영] ${res.patched}행 갱신${res.unmatched?.length ? ` (미매칭 ${res.unmatched.length}행)` : ''}`);
    setActiveTab('confirmation');
  }, [job, saveDirtyPoIfAny, confirmationExists, generateConfirmationFresh, patchConfirmationFromPo, appendLog]);

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
      // 스크립트가 폼 채움을 완료하기 전에 사용자가 다음 단계를 예상할 수 있도록
      // 실행 시작 시점(카운트다운 직후)에 바로 오버레이를 띄움.
      setAskUploadConfirm(true);
    } else {
      appendLog('error', `업로드 준비 실행 실패: ${res.error}`);
    }
  }, [job, dirty, appendLog]);

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

  // ── 밀크런 대량 접수 (저장 직전 dry-run) ──
  // transport.json 의 '밀크런' assignment 들을 사이트 폼에 채우고 저장은 수동.
  const handleMilkrunRegister = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;

    // transport.json 존재 확인 — 없으면 운송 분배부터 하라고 안내
    const tpath = await api.resolveJobPath(job.date, job.vendor, job.sequence, 'transport.json');
    if (!tpath?.success) {
      appendLog('error', `경로 해석 실패: ${tpath?.error}`);
      return;
    }
    const texists = await api.fileExists(tpath.path);
    if (!texists) {
      appendLog('warn', 'transport.json 이 없습니다 — 먼저 🚚 운송 분배에서 밀크런 지정을 저장하세요.');
      return;
    }

    // 벤더 override + 전역 기본값 병합 → 밀크런 상품종류
    let productType = '';
    try {
      const [vendorList, settingsRes] = await Promise.all([
        api.loadVendors(),
        api.loadSettings(),
      ]);
      const defaults = settingsRes?.settings || {};
      const vendorMeta = vendorList?.vendors?.find?.((v) => v.id === job.vendor) || {};
      const override = vendorMeta.settings || {};
      const pick = (k) =>
        (override[k] !== undefined && override[k] !== '') ? override[k] : (defaults[k] ?? '');
      productType = String(pick('milkrunProductType') || '').trim();
    } catch { /* pick 실패하면 스크립트 기본값(DEFAULT_PRODUCT_TYPE) 사용 */ }

    appendLog('info', `밀크런 접수 시작: ${job.vendor} · ${job.date} · ${job.sequence}차${productType ? ` · 상품종류='${productType}'` : ''}`);
    const args = [
      '--vendor', job.vendor,
      '--date', job.date,
      '--sequence', String(job.sequence),
    ];
    if (productType) args.push('--product-type', productType);
    const res = await api.runPython('scripts/milkrun_register.py', args);
    if (res.success) {
      setPythonRunning(true);
      // 실행 시작과 동시에 오버레이 — 스크립트가 폼을 채우는 동안
      // 사용자는 웹뷰 확인 준비 + 저장 후 '예, 기록합니다'.
      setAskMilkrunConfirm(true);
    } else {
      appendLog('error', `밀크런 접수 실행 실패: ${res.error}`);
    }
  }, [job, appendLog]);

  // ── 밀크런 등록 버튼 onClick — 이력 있으면 카운트다운 전에 확인 ──
  // 재등록 불가 + 사이트 리스트에서 사라지는 특성이라 이중 등록 방지 용도.
  const handleMilkrunClickStart = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;
    try {
      const mres = await api.jobs.loadManifest(job.date, job.vendor, job.sequence);
      const hist = mres?.success ? mres.manifest?.milkrunHistory : null;
      const prevCount = Array.isArray(hist) ? hist.length : 0;
      if (prevCount > 0) {
        const proceed = window.confirm(
          `이 작업에 밀크런 등록 기록이 이미 ${prevCount}회 존재합니다.\n`
          + `밀크런은 재등록 불가 — 사이트 리스트에서 사라진 항목은 다시 채울 수 없습니다.\n\n`
          + `그래도 계속 진행하시겠습니까?`
        );
        if (!proceed) return;
      }
    } catch { /* 조회 실패해도 진행 */ }
    setPendingAction({ label: '밀크런 대량 접수', run: handleMilkrunRegister });
  }, [job, handleMilkrunRegister]);

  // ── 쉽먼트 등록 (생성 직전 dry-run, 센터 단위) ──
  // transport.json 의 '쉽먼트' assignment 첫 번째 센터를 처리.
  // 여러 센터가 있으면 사용자가 반복 실행 → 생성 → 다음 센터 순으로 진행.
  const handleShipmentRegister = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;

    const tpath = await api.resolveJobPath(job.date, job.vendor, job.sequence, 'transport.json');
    if (!tpath?.success) {
      appendLog('error', `경로 해석 실패: ${tpath?.error}`);
      return;
    }
    const texists = await api.fileExists(tpath.path);
    if (!texists) {
      appendLog('warn', 'transport.json 이 없습니다 — 먼저 🚚 운송 분배에서 쉽먼트 지정을 저장하세요.');
      return;
    }

    // ── 쉽먼트 생성 기본값 pick (전역 settings + 벤더 override) ──
    // 발송일 규칙 → 입고일(job.date) 기준 오프셋을 계산해 YYYY-MM-DD 로 변환
    let deliveryCompany = '';
    let sendDate = '';
    let sendTime = '';
    let invoices = '';
    try {
      const [vendorList, settingsRes] = await Promise.all([
        api.loadVendors(),
        api.loadSettings(),
      ]);
      const defaults = settingsRes?.settings || {};
      const vendorMeta = vendorList?.vendors?.find?.((v) => v.id === job.vendor) || {};
      const override = vendorMeta.settings || {};
      const pick = (k) =>
        (override[k] !== undefined && override[k] !== '') ? override[k] : (defaults[k] ?? '');
      deliveryCompany = String(pick('shipmentDeliveryCompany') || '').trim();
      const sendDateRule = String(pick('shipmentSendDateRule') || '').trim();
      if (sendDateRule) {
        const ymd = applyDateRule(sendDateRule, job.date); // "20260426"
        if (ymd && ymd.length >= 8) {
          sendDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
        }
      }
      sendTime = String(pick('shipmentSendTime') || '').trim();
      invoices = String(pick('shipmentFakeInvoices') || '');
    } catch { /* pick 실패하면 STEP5 생략 */ }

    appendLog(
      'info',
      `쉽먼트 접수 시작: ${job.vendor} · ${job.date} · ${job.sequence}차`
      + (deliveryCompany ? ` · 택배사=${deliveryCompany}` : '')
      + (sendDate ? ` · 발송일=${sendDate}` : '')
      + (sendTime ? ` · 발송시각=${sendTime}` : '')
      + (invoices ? ` · 송장${invoices.split(/[\n,]/).filter((s) => s.trim()).length}건` : '')
    );
    const argsList = [
      '--vendor', job.vendor,
      '--date', job.date,
      '--sequence', String(job.sequence),
    ];
    if (deliveryCompany) argsList.push('--delivery-company', deliveryCompany);
    if (sendDate)        argsList.push('--send-date', sendDate);
    if (sendTime)        argsList.push('--send-time', sendTime);
    if (invoices)        argsList.push('--invoices', invoices);

    const res = await api.runPython('scripts/shipment_register.py', argsList);
    if (res.success) {
      setPythonRunning(true);
      // 실행 시작과 동시에 오버레이 — 스크립트 종료 시 center/skuFilled 등
      // 결과 메타가 오면 done 이벤트에서 덮어씌워짐.
      setAskShipmentConfirm({
        center: null, boxCount: null, skuFilled: null, skuTotal: null,
      });
    } else {
      appendLog('error', `쉽먼트 접수 실행 실패: ${res.error}`);
    }
  }, [job, appendLog]);

  // ── 쉽먼트 등록 버튼 onClick — 이력 있으면 카운트다운 전에 확인 ──
  // 쉽먼트는 센터 단위로 여러 번 실행될 수 있음 — 경고는 띄우되 반복 허용.
  const handleShipmentClickStart = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;
    try {
      const mres = await api.jobs.loadManifest(job.date, job.vendor, job.sequence);
      const hist = mres?.success ? mres.manifest?.shipmentHistory : null;
      const prevCount = Array.isArray(hist) ? hist.length : 0;
      if (prevCount > 0) {
        const centers = Array.isArray(hist)
          ? hist.map((h) => h.center).filter(Boolean).join(', ')
          : '';
        const proceed = window.confirm(
          `이 작업에 쉽먼트 등록 기록이 이미 ${prevCount}회 존재합니다.`
          + (centers ? `\n(센터: ${centers})` : '')
          + `\n\n쉽먼트는 센터마다 1회씩 — 이미 생성한 센터는 재생성 불가합니다.`
          + `\n계속 진행하시겠습니까?`
        );
        if (!proceed) return;
      }
    } catch { /* 조회 실패해도 진행 */ }
    setPendingAction({ label: '쉽먼트 생성', run: handleShipmentRegister });
  }, [job, handleShipmentRegister]);

  // ── 쉽먼트 등록 기록 (사이트에서 생성 완료 후 수동 체크) ──
  // manifest.shipmentHistory 에 { timestamp, center } 누적.
  const handleRecordShipment = useCallback(async (center) => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api?.jobs?.loadManifest || !api?.jobs?.updateManifest) return;
    try {
      const mres = await api.jobs.loadManifest(job.date, job.vendor, job.sequence);
      const manifest = mres?.success ? (mres.manifest || {}) : {};
      const prev = Array.isArray(manifest.shipmentHistory) ? manifest.shipmentHistory : [];
      const entry = { timestamp: new Date().toISOString() };
      if (center) entry.center = center;
      const patch = { shipmentHistory: [...prev, entry] };
      const res = await api.jobs.updateManifest(job.date, job.vendor, job.sequence, patch);
      if (!res?.success) {
        appendLog('error', `쉽먼트 기록 실패: ${res?.error ?? 'unknown'}`);
        return;
      }
      appendLog('event', `[📦 쉽먼트 등록 기록] ${center || '(센터 미지정)'} · ${entry.timestamp}`);
      if (res.manifest) onJobUpdated?.(res.manifest);
    } catch (err) {
      appendLog('error', `쉽먼트 기록 실패: ${err.message}`);
    }
  }, [job, appendLog, onJobUpdated]);

  // ── 밀크런 등록 기록 (사이트에서 저장 완료 후 수동 체크) ──
  // 파일 스냅샷 없이 timestamp 만 manifest.milkrunHistory 에 누적.
  // 재등록 불가 + 목록에서 사라지는 특성상, 언제 등록했는지 추적 용도.
  const handleRecordMilkrun = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api?.jobs?.loadManifest || !api?.jobs?.updateManifest) return;
    try {
      const mres = await api.jobs.loadManifest(job.date, job.vendor, job.sequence);
      const manifest = mres?.success ? (mres.manifest || {}) : {};
      const prev = Array.isArray(manifest.milkrunHistory) ? manifest.milkrunHistory : [];
      const entry = { timestamp: new Date().toISOString() };
      const patch = { milkrunHistory: [...prev, entry] };
      const res = await api.jobs.updateManifest(job.date, job.vendor, job.sequence, patch);
      if (!res?.success) {
        appendLog('error', `밀크런 기록 실패: ${res?.error ?? 'unknown'}`);
        return;
      }
      appendLog('event', `[🚛 밀크런 등록 기록] ${entry.timestamp}`);
      if (res.manifest) onJobUpdated?.(res.manifest);
    } catch (err) {
      appendLog('error', `밀크런 기록 실패: ${err.message}`);
    }
  }, [job, appendLog, onJobUpdated]);

  // ── 밀크런 서류 일괄 다운로드 ──
  // /milkrun/milkrunList 에서 날짜 조회 → 각 행의 프린트/팔레트 부착 리스트 버튼 연속 클릭.
  // 파일은 job/downloads/milkrun-{ts}/ 에 저장되고, manifest.downloadHistory 에 기록됨.
  const handleMilkrunDocsDownload = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;
    appendLog('info', `밀크런 서류 일괄 다운로드 시작: ${job.vendor} · ${job.date} · ${job.sequence}차`);
    const res = await api.runPython('scripts/milkrun_docs_download.py', [
      '--vendor', job.vendor,
      '--date', job.date,
      '--sequence', String(job.sequence),
    ]);
    if (res.success) {
      setPythonRunning(true);
    } else {
      appendLog('error', `밀크런 서류 다운로드 실행 실패: ${res.error}`);
    }
  }, [job, appendLog]);

  // ── 쉽먼트 서류 일괄 다운로드 ──
  // /ibs/asn/active 에서 입고예정일(edd) 필터 → 각 행의 Label/내역서 버튼 순차 클릭.
  // 파일은 job/downloads/shipment-{ts}/ 에 저장되고, manifest.downloadHistory 에 기록됨.
  const handleShipmentDocsDownload = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api) return;
    appendLog('info', `쉽먼트 서류 일괄 다운로드 시작: ${job.vendor} · ${job.date} · ${job.sequence}차`);
    const res = await api.runPython('scripts/shipment_docs_download.py', [
      '--vendor', job.vendor,
      '--date', job.date,
      '--sequence', String(job.sequence),
    ]);
    if (res.success) {
      setPythonRunning(true);
    } else {
      appendLog('error', `쉽먼트 서류 다운로드 실행 실패: ${res.error}`);
    }
  }, [job, appendLog]);

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
          {/* 플러그인 탭 — after='po' 인 것들 PO 바로 뒤에 */}
          {pluginTabsAfterPo.map((cmd) => {
            const tabKey = `plugin:${cmd.id}`;
            return (
              <button
                key={cmd.id}
                type="button"
                className={`workview-file-tab${activeTab === tabKey ? ' is-active' : ''}`}
                onClick={() => handlePluginTabClick(cmd)}
                disabled={!job}
                title={cmd.title}
              >
                {cmd.icon ? `${cmd.icon} ` : ''}{cmd.title}
              </button>
            );
          })}
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
          {/* 플러그인 기여 탭 — after 미지정은 끝에 */}
          {pluginTabsAtEnd.map((cmd) => {
            const tabKey = `plugin:${cmd.id}`;
            return (
              <button
                key={cmd.id}
                type="button"
                className={`workview-file-tab${activeTab === tabKey ? ' is-active' : ''}`}
                onClick={() => handlePluginTabClick(cmd)}
                disabled={!job}
                title={cmd.title}
              >
                {cmd.icon ? `${cmd.icon} ` : ''}{cmd.title}
              </button>
            );
          })}
          {dirty && activeTab !== 'result' && !activePluginTab && <span className="workview-section-header__dirty">· 변경됨</span>}
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
        {(activeTab === 'po' || activePluginTab?.hasPoActions) && (
          <>
            <button
              type="button"
              className="btn btn--phase-adjust btn--sm"
              onClick={() => job && window.electronAPI?.stockAdjust?.open(
                job.date, job.vendor, job.sequence,
                { variant: activePluginTab?.tabVariant || null },
              )}
              disabled={!job || !poExists || pythonRunning || jobLocked}
              title={
                !poExists ? 'po.xlsx 가 아직 없습니다'
                  : pythonRunning ? '자동화 진행 중입니다'
                  : jobLocked ? '이미 플러그인 창이 열려있습니다'
                  : 'SKU 별로 그룹핑해서 각 발주별 출고수량을 지정'
              }
            >
              📦 재고조정
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleApplyConfirmation}
              disabled={!job || !poExists || pythonRunning || jobLocked}
              title={
                !poExists ? 'po.xlsx 가 아직 없습니다'
                  : jobLocked ? '플러그인 창이 열려있습니다'
                  : confirmationExists
                    ? 'PO 의 확정수량·부족사유(I·M) 를 복합키(발주번호·물류센터·상품바코드) 로 매칭해 확정서에 반영'
                    : 'PO 로부터 발주확정서 최초 생성'
              }
            >
              📋 {confirmationExists ? '확정서 반영' : '확정서 생성'}
            </button>
          </>
        )}
        {activeTab === 'confirmation' && (
          <>
            <button
              type="button"
              className="btn btn--phase-transport btn--sm"
              onClick={() => job && window.electronAPI?.transport?.open(job.date, job.vendor, job.sequence)}
              disabled={!job || !confirmationExists || pythonRunning || jobLocked}
              title={
                !confirmationExists ? '확정서가 아직 없습니다'
                  : pythonRunning ? '자동화 진행 중입니다'
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
              onClick={handleMilkrunClickStart}
              disabled={!job || !confirmationExists || pythonRunning || jobLocked}
              title={
                !confirmationExists ? '확정서가 아직 없습니다'
                  : jobLocked ? '플러그인 창이 열려있습니다'
                  : 'transport.json 의 밀크런 지정을 /milkrun/batchRegister 폼에 자동 채움 — 저장은 수동'
              }
            >
              🚛 밀크런 등록
            </button>
            <button
              type="button"
              className="btn btn--phase-shipment btn--sm"
              onClick={handleShipmentClickStart}
              disabled={!job || !confirmationExists || pythonRunning || jobLocked}
              title={
                !confirmationExists ? '확정서가 아직 없습니다'
                  : jobLocked ? '플러그인 창이 열려있습니다'
                  : 'transport.json 의 쉽먼트 지정 중 첫 번째 센터를 사이트 폼에 자동 채움 — 생성은 수동'
              }
            >
              📦 쉽먼트 등록
            </button>
          </>
        )}

        <div className="workview-actions-bar__spacer" />

        <SlotRenderer
          scope={KNOWN_SCOPES.WORK_TOOLBAR}
          ctx={{ job, phase: job?.phase, activeTab }}
          args={{ job, activeTab }}
        />

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
            {/* 플러그인 readonly 탭에선 저장 버튼 숨김 */}
            {!activePluginTab?.readOnly && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={activePluginTab?.onSave ? handlePluginSave : handleSaveNow}
                disabled={!dirty || saving || !xlsxBuffer || jobLocked}
                title={
                  jobLocked ? '플러그인 창이 열려있습니다'
                    : activePluginTab?.onSave ? '확정수량을 발주확정서에 반영'
                    : '현재 파일에 덮어쓰기'
                }
              >
                💾 {saving ? '저장 중...' : '저장'}
              </button>
            )}
          </>
        )}
      </div>
      )}

      {activeTab === 'result' ? (
        <div className="workview-table-section workview-table-section--result">
          <ResultView
            job={job}
            appendLog={appendLog}
            onJobUpdated={onJobUpdated}
            pythonRunning={pythonRunning}
            jobLocked={jobLocked}
            onDownloadMilkrunDocs={handleMilkrunDocsDownload}
            onDownloadShipmentDocs={handleShipmentDocsDownload}
          />
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

      {askMilkrunConfirm && (
        <div className="workview-overlay" role="dialog" aria-modal="true">
          <div className="workview-overlay__card">
            <h3 className="workview-overlay__title">🚛 밀크런 저장을 완료하셨나요?</h3>
            <p className="workview-overlay__desc">
              웹 뷰에서 <b>저장</b> 버튼을 눌러 정상 접수되었다면,
              지금 등록 이력을 기록해 두세요.
              <br />
              저장된 건은 <b>재등록 불가</b> — 리스트에서 사라지므로,
              언제 접수했는지 추적 목적의 timestamp 만 <code>manifest.milkrunHistory</code> 에 남깁니다.
            </p>
            <div className="workview-overlay__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setAskMilkrunConfirm(false)}
              >
                아니오 / 닫기
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={async () => {
                  await handleRecordMilkrun();
                  setAskMilkrunConfirm(false);
                }}
              >
                ✅ 예, 기록합니다
              </button>
            </div>
          </div>
        </div>
      )}

      {askShipmentConfirm && (
        <div className="workview-overlay" role="dialog" aria-modal="true">
          <div className="workview-overlay__card">
            <h3 className="workview-overlay__title">📦 쉽먼트 생성을 완료하셨나요?</h3>
            <p className="workview-overlay__desc">
              웹 뷰에서 <b>생성</b> 버튼을 눌러 정상 생성되었다면, 지금 기록해두세요.
              {askShipmentConfirm.center && (
                <>
                  <br />
                  대상 센터: <b>{askShipmentConfirm.center}</b>
                  {askShipmentConfirm.boxCount != null && <> · 박스 {askShipmentConfirm.boxCount}</>}
                  {askShipmentConfirm.skuFilled != null && askShipmentConfirm.skuTotal != null && (
                    <> · SKU {askShipmentConfirm.skuFilled}/{askShipmentConfirm.skuTotal}</>
                  )}
                </>
              )}
              <br />
              쉽먼트는 센터마다 1회 — 기록은 <code>manifest.shipmentHistory</code> 에 timestamp·center 로 누적됩니다.
            </p>
            <div className="workview-overlay__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setAskShipmentConfirm(null)}
              >
                아니오 / 닫기
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={async () => {
                  await handleRecordShipment(askShipmentConfirm?.center || null);
                  setAskShipmentConfirm(null);
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
