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
  runHook,
  subscribe as subscribeRegistry,
  getRegistryVersion,
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
// 레지스트리 버전 구독 — useSyncExternalStore 는 stable scalar 를 받음.
// 실제 데이터는 version 을 dep 로 useMemo 로 계산 → 루프 없음.
// ═══════════════════════════════════════════════════════════════════

function useRegistryVersion() {
  return useSyncExternalStore(subscribeRegistry, getRegistryVersion, getRegistryVersion);
}

// ═══════════════════════════════════════════════════════════════════
// SlotRenderer — scope 기반 Command 버튼 렌더
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {import('./plugin-api').SlotRendererProps} props
 */
export function SlotRenderer({ scope, ctx, args, className }) {
  const runtime = usePluginRuntime();
  const version = useRegistryVersion();
  const mergedCtx = useMemo(
    () => ({
      currentVendor: runtime.currentVendor,
      entitlements: runtime.entitlements,
      ...ctx,
    }),
    [runtime.currentVendor, runtime.entitlements, ctx],
  );

  const cmds = useMemo(
    () => getCommandsForScope(scope, mergedCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, scope, mergedCtx],
  );
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
  // 기본 사이즈 sm (툴바·탭 액션 대부분). command 에 size: 'md' 로 오버라이드 가능.
  const size = cmd.size || 'sm';
  const classes = [
    'btn',
    `btn--${variant}`,
    size ? `btn--${size}` : '',
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
  const version = useRegistryVersion();
  const mergedCtx = useMemo(
    () => ({
      currentVendor: runtime.currentVendor,
      entitlements: runtime.entitlements,
      ...ctx,
    }),
    [runtime.currentVendor, runtime.entitlements, ctx],
  );

  const view = useMemo(
    () => resolveView(role, mergedCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, role, mergedCtx],
  );

  if (!view) return fallback || null;
  const Comp = view.component;
  return <Comp {...(viewProps || {})} />;
}

// ═══════════════════════════════════════════════════════════════════
// useRunHook — 현재 런타임 컨텍스트를 자동 주입하는 runHook wrapper
// ═══════════════════════════════════════════════════════════════════

/**
 * @returns {(hookId: string, payload: any, extra?: object) => Promise<any>}
 *   컴포넌트 내에서 훅 실행 시 entitlements / currentVendor / electronAPI 자동 주입.
 */
export function useRunHook() {
  const runtime = usePluginRuntime();
  return useCallback((hookId, payload, extra) => {
    return runHook(hookId, payload, {
      currentVendor: runtime.currentVendor,
      entitlements: runtime.entitlements,
      electronAPI: typeof window !== 'undefined' ? window.electronAPI : null,
      ...(extra || {}),
    });
  }, [runtime.currentVendor, runtime.entitlements]);
}

// ═══════════════════════════════════════════════════════════════════
// 디버그 — 개발 중 "플러그인이 뭐 등록됐나" 확인용
// ═══════════════════════════════════════════════════════════════════

export function useRegistrySnapshot() {
  const version = useRegistryVersion();
  return useMemo(
    () => __internal.counts(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}
