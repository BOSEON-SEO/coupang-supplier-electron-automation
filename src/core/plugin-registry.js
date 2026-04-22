/**
 * 플러그인 런타임 — plugin-api.js 에 정의된 계약의 실제 구현.
 *
 * 단일 모듈 싱글톤 패턴 (앱 전체에 하나). 브라우저 전용.
 * 메인 프로세스 측 플러그인 로더는 main.js 에서 별도 처리.
 */

// ═══════════════════════════════════════════════════════════════════
// 내부 상태
// ═══════════════════════════════════════════════════════════════════

/** @type {Map<string, { manifest: any, dispose: () => void }>} */
const loadedPlugins = new Map();

/** @type {Array<{ pluginId: string, cmd: import('./plugin-api').Command }>} */
let commands = [];

/** @type {Array<{ pluginId: string, role: string, view: import('./plugin-api').ViewDescriptor }>} */
let views = [];

/** @type {Array<{ pluginId: string, hookId: string, handler: Function, priority: number }>} */
let hooks = [];

/** @type {Array<{ pluginId: string, phase: import('./plugin-api').Phase }>} */
let phases = [];

/** @type {Map<string, Set<Function>>} */
const eventListeners = new Map();

/** 레지스트리 변경(로드/언로드/등록/해제) 시 호출되는 구독자. useSyncExternalStore 용. */
const registrySubscribers = new Set();
function notifyRegistryChanged() {
  for (const fn of registrySubscribers) {
    try { fn(); } catch (err) { console.error('[plugin registry subscriber]', err); }
  }
}

/**
 * 레지스트리 변경 구독. useSyncExternalStore 에서 사용.
 * @param {() => void} cb
 * @returns {() => void}
 */
export function subscribe(cb) {
  registrySubscribers.add(cb);
  return () => registrySubscribers.delete(cb);
}

// ═══════════════════════════════════════════════════════════════════
// 유틸
// ═══════════════════════════════════════════════════════════════════

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const COMMAND_ID_RE = /^[a-z0-9][a-z0-9.-]{0,59}$/i;

function validatePluginId(id) {
  if (!PLUGIN_ID_RE.test(id)) {
    throw new Error(`invalid plugin id: ${id} (expected lowercase a-z0-9-)`);
  }
}

function hasEntitlement(required, entitlements) {
  if (!required) return true;
  return Array.isArray(entitlements) && entitlements.includes(required);
}

// ═══════════════════════════════════════════════════════════════════
// Plugin 로딩
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {import('./plugin-api').PluginManifest} manifest
 * @param {{ entitlements: string[], currentVendor: string|null, electronAPI: any }} runtime
 * @returns {(() => void)|null}
 */
export function loadPlugin(manifest, runtime) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('loadPlugin: manifest required');
  }
  validatePluginId(manifest.id);

  if (loadedPlugins.has(manifest.id)) {
    // eslint-disable-next-line no-console
    console.warn(`[plugin] '${manifest.id}' already loaded; skipping.`);
    return null;
  }
  if (!hasEntitlement(manifest.entitlement, runtime.entitlements)) {
    return null;
  }

  const pluginId = manifest.id;
  const disposables = [];

  const ctx = {
    pluginId,
    entitlements: runtime.entitlements,
    currentVendor: runtime.currentVendor,
    electronAPI: runtime.electronAPI,

    registerCommand(cmd) {
      if (!cmd || !cmd.id || !cmd.scope || typeof cmd.handler !== 'function') {
        throw new Error(`[${pluginId}] registerCommand: id/scope/handler required`);
      }
      if (!COMMAND_ID_RE.test(cmd.id)) {
        throw new Error(`[${pluginId}] invalid command id: ${cmd.id}`);
      }
      const entry = { pluginId, cmd };
      commands.push(entry);
      notifyRegistryChanged();
      const d = () => {
        commands = commands.filter((e) => e !== entry);
        notifyRegistryChanged();
      };
      disposables.push(d);
      return d;
    },

    registerView(role, view) {
      if (!role || !view || typeof view.component !== 'function') {
        throw new Error(`[${pluginId}] registerView: role/view.component required`);
      }
      const entry = { pluginId, role, view };
      views.push(entry);
      notifyRegistryChanged();
      const d = () => {
        views = views.filter((e) => e !== entry);
        notifyRegistryChanged();
      };
      disposables.push(d);
      return d;
    },

    registerHook(hookId, handler, opts) {
      if (!hookId || typeof handler !== 'function') {
        throw new Error(`[${pluginId}] registerHook: id/handler required`);
      }
      const priority = (opts && Number.isFinite(opts.priority)) ? opts.priority : 0;
      const entry = { pluginId, hookId, handler, priority };
      hooks.push(entry);
      notifyRegistryChanged();
      const d = () => {
        hooks = hooks.filter((e) => e !== entry);
        notifyRegistryChanged();
      };
      disposables.push(d);
      return d;
    },

    registerPhase(phase) {
      if (!phase || !phase.id || typeof phase.component !== 'function') {
        throw new Error(`[${pluginId}] registerPhase: id/component required`);
      }
      const entry = { pluginId, phase };
      phases.push(entry);
      notifyRegistryChanged();
      const d = () => {
        phases = phases.filter((e) => e !== entry);
        notifyRegistryChanged();
      };
      disposables.push(d);
      return d;
    },

    emit(event, payload) {
      const set = eventListeners.get(event);
      if (!set) return;
      for (const fn of set) {
        try { fn(payload); } catch (err) { console.error(`[plugin event '${event}']`, err); }
      }
    },

    on(event, handler) {
      let set = eventListeners.get(event);
      if (!set) { set = new Set(); eventListeners.set(event, set); }
      set.add(handler);
      const d = () => { set.delete(handler); };
      disposables.push(d);
      return d;
    },

    storage: makeStorage(pluginId, runtime.electronAPI),

    async ipcInvoke(channel, ...args) {
      if (!runtime.electronAPI?.invokePluginChannel) {
        throw new Error(`[${pluginId}] ipcInvoke: electronAPI.invokePluginChannel not exposed`);
      }
      return runtime.electronAPI.invokePluginChannel(pluginId, channel, ...args);
    },
  };

  let userDispose;
  try {
    userDispose = manifest.activate(ctx);
  } catch (err) {
    console.error(`[plugin '${pluginId}'] activate failed`, err);
    disposables.forEach((d) => { try { d(); } catch {} });
    return null;
  }

  const dispose = () => {
    try { if (typeof userDispose === 'function') userDispose(); } catch (err) {
      console.error(`[plugin '${pluginId}'] user dispose failed`, err);
    }
    disposables.forEach((d) => { try { d(); } catch {} });
    loadedPlugins.delete(pluginId);
  };

  loadedPlugins.set(pluginId, { manifest, dispose });
  return dispose;
}

/**
 * 모든 로드된 플러그인 해제. 벤더 전환·재로딩 시 사용.
 */
export function unloadAllPlugins() {
  const ids = Array.from(loadedPlugins.keys());
  for (const id of ids) {
    const entry = loadedPlugins.get(id);
    if (entry) entry.dispose();
  }
}

export function listLoadedPlugins() {
  return Array.from(loadedPlugins.values()).map(({ manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// Storage 경로 계산
// ═══════════════════════════════════════════════════════════════════

function makeStorage(pluginId, electronAPI) {
  const join = (...parts) => parts.filter(Boolean).join('/');
  const seq = (n) => String(n).padStart(2, '0');
  return {
    jobScoped(fileName, jobKey) {
      if (!jobKey) throw new Error('jobScoped: jobKey required');
      return join(jobKey.date, jobKey.vendor, seq(jobKey.sequence), 'plugins', pluginId, fileName);
    },
    vendorScoped(fileName, vendor) {
      return join('vendors', vendor, 'plugins', pluginId, fileName);
    },
    global(fileName) {
      return join('plugins', pluginId, fileName);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 조회 API
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {string} scope
 * @param {object} ctx
 * @returns {import('./plugin-api').Command[]}
 */
export function getCommandsForScope(scope, ctx) {
  const result = [];
  for (const entry of commands) {
    if (entry.cmd.scope !== scope) continue;
    if (typeof entry.cmd.when === 'function') {
      let ok;
      try { ok = entry.cmd.when(ctx); } catch (err) {
        console.error(`[cmd '${entry.cmd.id}'] when() threw`, err);
        continue;
      }
      if (!ok) continue;
    }
    result.push(entry.cmd);
  }
  // order 낮을수록 앞 (기본 100)
  result.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return result;
}

/**
 * @param {string} role
 * @param {object} ctx
 * @returns {import('./plugin-api').ViewDescriptor|null}
 */
export function resolveView(role, ctx) {
  const candidates = views
    .filter((e) => e.role === role)
    .slice()
    .sort((a, b) => (b.view.priority ?? 0) - (a.view.priority ?? 0));
  for (const entry of candidates) {
    if (typeof entry.view.when === 'function') {
      try { if (!entry.view.when(ctx)) continue; } catch { continue; }
    }
    return entry.view;
  }
  return null;
}

/**
 * 훅 체인 실행 (Koa middleware 스타일).
 *
 *   priority 내림차순으로 정렬된 핸들러 배열에 대해:
 *     handler(payload, ctx, next) 호출
 *     handler 가 next() 호출 시 → 다음 핸들러 실행
 *     handler 가 next() 호출 안 하면 → 거기서 체인 종료 (= "대체")
 *     마지막까지 next() 가 호출되면 → undefined 반환 (기본 구현 없음)
 *
 *   반환값: 체인의 outermost handler 의 반환값.
 *
 * @param {string} hookId
 * @param {any} payload
 * @param {object} ctx
 * @returns {Promise<any>}
 */
export async function runHook(hookId, payload, ctx) {
  const chain = hooks
    .filter((e) => e.hookId === hookId)
    .slice()
    .sort((a, b) => b.priority - a.priority);

  let index = 0;
  async function next() {
    if (index >= chain.length) return undefined;
    const entry = chain[index];
    index += 1;
    try {
      return await entry.handler(payload, ctx, next);
    } catch (err) {
      console.error(`[hook '${hookId}' / plugin '${entry.pluginId}'] threw`, err);
      throw err;
    }
  }
  return next();
}

/**
 * 활성 phase 목록. after/before 위상 정렬 + when 필터.
 *
 * 알고리즘 (단순 삽입 정렬):
 *   1. when() 통과한 phase 만 대상
 *   2. after/before 힌트 순서로 삽입 — after='X' 면 'X' 바로 뒤에, before='X' 면 앞에
 *   3. 해석 불가 (지정 id 없음) 시 order (기본 100) 로 폴백
 *
 * @param {object} ctx
 * @returns {import('./plugin-api').Phase[]}
 */
export function getActivePhases(ctx) {
  const active = phases
    .filter((e) => {
      if (typeof e.phase.when !== 'function') return true;
      try { return !!e.phase.when(ctx); } catch { return false; }
    })
    .map((e) => e.phase);

  // after/before 없는 것부터 order 로 정렬
  const anchored = [];
  const floating = [];
  for (const p of active) {
    if (p.after || p.before) floating.push(p);
    else anchored.push(p);
  }
  anchored.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

  // floating 를 anchored 에 삽입
  const result = anchored.slice();
  let remaining = floating.slice();
  let safety = 100;
  while (remaining.length && safety > 0) {
    safety -= 1;
    const stillRemaining = [];
    for (const p of remaining) {
      const idx = result.findIndex((x) => x.id === (p.after || p.before));
      if (idx < 0) { stillRemaining.push(p); continue; }
      const insertAt = p.after ? idx + 1 : idx;
      result.splice(insertAt, 0, p);
    }
    if (stillRemaining.length === remaining.length) {
      // 더 이상 진전 없음 — order 로 폴백 삽입
      stillRemaining.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
      result.push(...stillRemaining);
      break;
    }
    remaining = stillRemaining;
  }
  return result;
}

// 디버깅/테스트용
export const __internal = {
  resetAll() {
    unloadAllPlugins();
    commands = [];
    views = [];
    hooks = [];
    phases = [];
    eventListeners.clear();
  },
  counts() {
    return {
      plugins: loadedPlugins.size,
      commands: commands.length,
      views: views.length,
      hooks: hooks.length,
      phases: phases.length,
    };
  },
};
