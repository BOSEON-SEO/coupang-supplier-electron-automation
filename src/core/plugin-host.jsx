/**
 * 플러그인 소비 컴포넌트 — 코어 뷰가 import 해서 사용.
 *
 *   <PluginProvider entitlements={...} currentVendor={...}>
 *     ...
 *     <SlotRenderer scope="work.toolbar" ctx={{ job, phase }} />
 *     <ViewOutlet role="home" fallback={<CalendarView/>} />
 *   </PluginProvider>
 */

import React, { createContext, useContext, useMemo, useSyncExternalStore, useState, useCallback } from 'react';
import {
  getCommandsForScope,
  resolveView,
  subscribe as subscribeRegistry,
  __internal,
} from './plugin-registry';

// ═══════════════════════════════════════════════════════════════════
// Context — 런타임 메타(entitlements/currentVendor) 를 하위에 전파
// ═══════════════════════════════════════════════════════════════════

const PluginRuntimeContext = createContext({
  entitlements: [],
  currentVendor: null,
});

export function PluginProvider({ entitlements, currentVendor, children }) {
  const value = useMemo(
    () => ({ entitlements: entitlements || [], currentVendor: currentVendor || null }),
    [entitlements, currentVendor],
  );
  return (
    <PluginRuntimeContext.Provider value={value}>
      {children}
    </PluginRuntimeContext.Provider>
  );
}

export function usePluginRuntime() {
  return useContext(PluginRuntimeContext);
}

// ═══════════════════════════════════════════════════════════════════
// 내부 헬퍼 — getSnapshot 은 같은 입력에 같은 참조를 유지해야 루프 방지
// ═══════════════════════════════════════════════════════════════════

function useStableCommands(scope, mergedCtx) {
  const getSnapshot = useCallback(
    () => getCommandsForScope(scope, mergedCtx),
    [scope, mergedCtx],
  );
  const snap = useSyncExternalStore(subscribeRegistry, getSnapshot, getSnapshot);
  // fingerprint 기반 동일성 체크로 재렌더 줄임
  const [prev, setPrev] = useState(snap);
  const fp = snap.map((c) => c.id).join('|');
  const prevFp = prev.map((c) => c.id).join('|');
  if (fp !== prevFp) setPrev(snap);
  return fp === prevFp ? prev : snap;
}

// ═══════════════════════════════════════════════════════════════════
// SlotRenderer — scope 기반 Command 버튼 렌더
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {import('./plugin-api').SlotRendererProps} props
 */
export function SlotRenderer({ scope, ctx, args, className }) {
  const runtime = usePluginRuntime();
  const mergedCtx = useMemo(
    () => ({
      currentVendor: runtime.currentVendor,
      entitlements: runtime.entitlements,
      ...ctx,
    }),
    [runtime.currentVendor, runtime.entitlements, ctx],
  );

  const cmds = useStableCommands(scope, mergedCtx);
  if (!cmds.length) return null;

  return (
    <>
      {cmds.map((cmd) => (
        <SlotButton
          key={cmd.id}
          cmd={cmd}
          args={args}
          ctx={mergedCtx}
          className={className}
        />
      ))}
    </>
  );
}

function SlotButton({ cmd, args, ctx, className }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cmd.handler(args, ctx);
    } catch (err) {
      console.error(`[cmd '${cmd.id}'] handler threw`, err);
      alert(`명령 실행 실패: ${cmd.title}\n${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };
  const variant = cmd.variant || 'secondary';
  const classes = [
    'btn',
    `btn--${variant}`,
    'slot-btn',
    busy ? 'is-busy' : '',
    className || '',
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} onClick={onClick} disabled={busy} title={cmd.title}>
      {cmd.icon ? <span className="slot-btn__icon">{cmd.icon}</span> : null}
      <span className="slot-btn__label">{cmd.title}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ViewOutlet — role 에 맞는 ViewDescriptor 렌더, 없으면 fallback
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {import('./plugin-api').ViewOutletProps} props
 */
export function ViewOutlet({ role, ctx, fallback, viewProps }) {
  const runtime = usePluginRuntime();
  const mergedCtx = useMemo(
    () => ({
      currentVendor: runtime.currentVendor,
      entitlements: runtime.entitlements,
      ...ctx,
    }),
    [runtime.currentVendor, runtime.entitlements, ctx],
  );

  const getSnapshot = useCallback(
    () => resolveView(role, mergedCtx),
    [role, mergedCtx],
  );
  const view = useSyncExternalStore(subscribeRegistry, getSnapshot, getSnapshot);

  if (!view) return fallback || null;
  const Comp = view.component;
  return <Comp {...(viewProps || {})} />;
}

// ═══════════════════════════════════════════════════════════════════
// 디버그 — 개발 중 "플러그인이 뭐 등록됐나" 확인용
// ═══════════════════════════════════════════════════════════════════

export function useRegistrySnapshot() {
  return useSyncExternalStore(
    subscribeRegistry,
    () => __internal.counts(),
    () => __internal.counts(),
  );
}
