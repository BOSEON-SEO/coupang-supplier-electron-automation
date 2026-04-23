import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegistrySnapshot, usePluginRuntime } from '../core/plugin-host';
import { listLoadedPlugins } from '../core/plugin-registry';
import { listInstalledManifests } from '../core/plugin-loader';

/**
 * 플러그인 메뉴 — 설치된 플러그인 전체 목록 + 시스템 현황 + 플러그인별 설정.
 *
 * 플러그인 상태:
 *   - 로드됨   (activated)      : manifest 발견 + entitlement 통과 + 사용자 on
 *   - 비활성   (user-disabled)   : 사용자가 개별 토글로 off
 *   - 권한부족 (entitlement)     : entitlement 없음 (라이선스 미보유)
 *
 * 개별 on/off 는 settings.plugins.<id>.enabled 에 저장됨 (기본 true).
 * 토글 즉시 settings-changed 이벤트 → App/popup 이 plugins 재부트스트랩.
 */
export default function PluginsView() {
  const counts = useRegistrySnapshot();
  const runtime = usePluginRuntime();
  const loaded = listLoadedPlugins();
  const installed = useMemo(() => listInstalledManifests(), []);

  // settings.plugins 전체 맵 (각 플러그인 설정 + enabled 플래그)
  const [pluginsSettings, setPluginsSettings] = useState({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await window.electronAPI?.loadSettings();
    const all = res?.settings || {};
    setPluginsSettings(all.plugins || {});
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    reload();
    const onChanged = () => reload();
    window.addEventListener('settings-changed', onChanged);
    return () => window.removeEventListener('settings-changed', onChanged);
  }, [reload]);

  // 플러그인 상태 계산
  const rowsByState = useMemo(() => {
    const loadedIds = new Set(loaded.map((p) => p.id));
    return installed.map((m) => {
      const userEnabled = pluginsSettings?.[m.id]?.enabled !== false; // 기본 true
      const isLoaded = loadedIds.has(m.id);
      let state;
      if (isLoaded) state = 'loaded';
      else if (!userEnabled) state = 'user-disabled';
      else state = 'entitlement';  // entitlement 없음 (또는 에러)
      return { ...m, userEnabled, state };
    });
  }, [installed, loaded, pluginsSettings]);

  const handleToggle = useCallback(async (pluginId, nextEnabled) => {
    const api = window.electronAPI;
    if (!api) return;
    const cur = await api.loadSettings();
    const curSettings = cur?.settings || {};
    const curPlugins = curSettings.plugins || {};
    const nextPlugins = {
      ...curPlugins,
      [pluginId]: { ...(curPlugins[pluginId] || {}), enabled: nextEnabled },
    };
    const res = await api.saveSettings({
      schemaVersion: cur?.schemaVersion || 1,
      settings: { ...curSettings, plugins: nextPlugins },
    });
    if (res?.success) {
      window.dispatchEvent(new Event('settings-changed'));
    }
  }, []);

  return (
    <div className="plugins-view">
      <div className="plugins-view__header">
        <h2>🔌 플러그인</h2>
      </div>

      <div className="plugins-view__body">
        <section className="plugins-view__section">
          <h3 className="plugins-view__section-title">시스템 현황</h3>
          <div className="plugins-stats">
            <Stat label="로드된 플러그인" value={counts.plugins} />
            <Stat label="등록된 커맨드" value={counts.commands} />
            <Stat label="등록된 뷰" value={counts.views} />
            <Stat label="등록된 훅" value={counts.hooks} />
            <Stat label="등록된 phase" value={counts.phases} />
          </div>
        </section>

        <section className="plugins-view__section">
          <h3 className="plugins-view__section-title">런타임 컨텍스트</h3>
          <div className="plugins-kv">
            <div className="plugins-kv__row">
              <span className="plugins-kv__key">현재 벤더</span>
              <code className="plugins-kv__value">{runtime.currentVendor || '(미선택)'}</code>
            </div>
            <div className="plugins-kv__row">
              <span className="plugins-kv__key">Entitlements</span>
              <code className="plugins-kv__value">
                {runtime.entitlements.length
                  ? runtime.entitlements.join(', ')
                  : '(비어있음 — 마스터 토글 OFF)'}
              </code>
            </div>
          </div>
        </section>

        <section className="plugins-view__section">
          <h3 className="plugins-view__section-title">설치된 플러그인</h3>
          {rowsByState.length === 0 ? (
            <p className="plugins-view__empty">설치된 플러그인이 없습니다.</p>
          ) : (
            <table className="plugins-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>이름</th>
                  <th>버전</th>
                  <th>권한</th>
                  <th>상태</th>
                  <th>활성화</th>
                </tr>
              </thead>
              <tbody>
                {rowsByState.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.id}</code></td>
                    <td>{p.name}</td>
                    <td>{p.version}</td>
                    <td>
                      {p.entitlement
                        ? <code className="plugins-badge plugins-badge--ent">{p.entitlement}</code>
                        : <span className="plugins-muted">–</span>}
                    </td>
                    <td>
                      {p.state === 'loaded' && <span className="plugins-badge plugins-badge--active">로드됨</span>}
                      {p.state === 'user-disabled' && <span className="plugins-badge plugins-badge--off">비활성</span>}
                      {p.state === 'entitlement' && <span className="plugins-badge plugins-badge--locked">권한 부족</span>}
                    </td>
                    <td>
                      <label className="plugins-toggle" title={p.userEnabled ? '클릭하여 비활성화' : '클릭하여 활성화'}>
                        <input
                          type="checkbox"
                          checked={p.userEnabled}
                          disabled={!settingsLoaded}
                          onChange={(e) => handleToggle(p.id, e.target.checked)}
                        />
                        <span className="plugins-toggle__slider" />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 플러그인별 고유 설정 — 로드된 플러그인 중 settingsSchema 있는 것만 */}
        {loaded.filter((p) => p.settingsSchema && p.settingsSchema.length > 0).map((p) => (
          <PluginSettingsSection key={p.id} plugin={p} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="plugins-stat">
      <div className="plugins-stat__value">{value}</div>
      <div className="plugins-stat__label">{label}</div>
    </div>
  );
}

function PluginSettingsSection({ plugin }) {
  const [values, setValues] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await window.electronAPI?.loadSettings();
      if (cancelled) return;
      const all = res?.settings || {};
      const mine = (all.plugins && all.plugins[plugin.id]) || {};
      // 'enabled' 는 토글이 관리하므로 폼 값에서 제외
      const { enabled, ...rest } = mine;
      setValues(rest);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [plugin.id]);

  const handleChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    setSaving(true);
    setStatus('');
    try {
      const cur = await api.loadSettings();
      const curSettings = cur?.settings || {};
      const curPlugins = curSettings.plugins || {};
      const existing = curPlugins[plugin.id] || {};
      // 기존 enabled 보존 + 나머지 필드 갱신
      const nextForPlugin = { ...existing, ...values };
      const res = await api.saveSettings({
        schemaVersion: cur?.schemaVersion || 1,
        settings: { ...curSettings, plugins: { ...curPlugins, [plugin.id]: nextForPlugin } },
      });
      if (!res?.success) throw new Error(res?.error || 'settings save 실패');
      setStatus('저장됨');
      window.dispatchEvent(new Event('settings-changed'));
    } catch (err) {
      setStatus(`저장 실패: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(''), 3000);
    }
  }, [plugin.id, values]);

  if (!loaded) return null;

  return (
    <section className="plugins-view__section">
      <h3 className="plugins-view__section-title">{plugin.name} 설정</h3>
      <div className="plugin-settings">
        {plugin.settingsSchema.map((field) => (
          <PluginSettingField
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={handleChange}
          />
        ))}
        <div className="plugin-settings__actions">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={handleSave}
            disabled={saving}
          >
            💾 {saving ? '저장 중...' : '저장'}
          </button>
          {status && <span className="plugin-settings__status">{status}</span>}
        </div>
      </div>
    </section>
  );
}

function PluginSettingField({ field, value, onChange }) {
  const effective = value !== undefined ? value : field.default;

  if (field.type === 'boolean') {
    return (
      <label className="plugin-settings__row plugin-settings__row--toggle">
        <input
          type="checkbox"
          checked={!!effective}
          onChange={(e) => onChange(field.key, e.target.checked)}
        />
        <div>
          <div className="plugin-settings__label">{field.label}</div>
          {field.description && <div className="plugin-settings__hint">{field.description}</div>}
        </div>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="plugin-settings__row">
        <label className="plugin-settings__label">{field.label}</label>
        <textarea
          className="plugin-settings__input plugin-settings__input--textarea"
          placeholder={field.placeholder || ''}
          value={effective ?? ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          rows={4}
        />
        {field.description && <div className="plugin-settings__hint">{field.description}</div>}
      </div>
    );
  }

  const inputType = field.type === 'password' ? 'password'
    : field.type === 'number' ? 'number'
      : field.type === 'url' ? 'url'
        : 'text';

  return (
    <div className="plugin-settings__row">
      <label className="plugin-settings__label">{field.label}</label>
      <input
        type={inputType}
        className="plugin-settings__input"
        placeholder={field.placeholder || ''}
        value={effective ?? ''}
        onChange={(e) => onChange(field.key, field.type === 'number'
          ? (e.target.value === '' ? '' : Number(e.target.value))
          : e.target.value)}
      />
      {field.description && <div className="plugin-settings__hint">{field.description}</div>}
    </div>
  );
}
