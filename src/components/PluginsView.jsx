import React, { useCallback, useEffect, useState } from 'react';
import { useRegistrySnapshot, usePluginRuntime } from '../core/plugin-host';
import { listLoadedPlugins } from '../core/plugin-registry';

/**
 * 플러그인 메뉴 — 현재 로드된 플러그인·등록된 확장 포인트 현황.
 *
 * 현재 제공:
 *   - 시스템 현황 (카운트 5종)
 *   - 런타임 컨텍스트 (벤더·entitlements)
 *   - 로드된 플러그인 목록
 *   - 플러그인별 고유 설정 (manifest.settingsSchema 기반 자동 폼)
 *
 * 플러그인 설정은 글로벌 settings.json 의 `plugins.<id>.<key>` 에 저장.
 * 저장 시 'settings-changed' 이벤트 dispatch 로 앱 전체 재로드.
 */
export default function PluginsView() {
  const counts = useRegistrySnapshot();
  const runtime = usePluginRuntime();
  const loaded = listLoadedPlugins();

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
                  : '(비어있음)'}
              </code>
            </div>
          </div>
        </section>

        <section className="plugins-view__section">
          <h3 className="plugins-view__section-title">로드된 플러그인</h3>
          {loaded.length === 0 ? (
            <p className="plugins-view__empty">활성화된 플러그인이 없습니다.</p>
          ) : (
            <table className="plugins-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>이름</th>
                  <th>버전</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {loaded.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.id}</code></td>
                    <td>{p.name}</td>
                    <td>{p.version}</td>
                    <td><span className="plugins-badge plugins-badge--active">활성</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 플러그인별 고유 설정 — settingsSchema 있는 플러그인만 */}
        {loaded.filter((p) => p.settingsSchema && p.settingsSchema.length > 0).map((p) => (
          <PluginSettingsSection key={p.id} plugin={p} />
        ))}

        <section className="plugins-view__section plugins-view__section--muted">
          <h3 className="plugins-view__section-title">곧 추가될 기능</h3>
          <ul className="plugins-view__todo">
            <li>활성화 가능한 플러그인 목록 (disk 스캔)</li>
            <li>플러그인별 on/off 토글</li>
            <li>라이선스 서버 상태 + 갱신</li>
          </ul>
        </section>
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

/**
 * 한 플러그인의 설정 섹션. manifest.settingsSchema 를 순회해 폼 렌더.
 * 값은 settings.json 의 `plugins.<id>` 하위에 저장.
 */
function PluginSettingsSection({ plugin }) {
  const [values, setValues] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  // 초기 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await window.electronAPI?.loadSettings();
      if (cancelled) return;
      const all = res?.settings || {};
      const mine = (all.plugins && all.plugins[plugin.id]) || {};
      setValues(mine);
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
      const nextPlugins = { ...(curSettings.plugins || {}), [plugin.id]: values };
      const res = await api.saveSettings({
        schemaVersion: cur?.schemaVersion || 1,
        settings: { ...curSettings, plugins: nextPlugins },
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
