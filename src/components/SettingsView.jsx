import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { SHORTAGE_REASONS } from '../core/confirmationBuilder';

/**
 * 설정 뷰 — 왼쪽 "기본값"(settings.json), 오른쪽 "선택 벤더"(vendors.json 의 vendor)
 *
 * 벤더 값이 비어있으면 기본값이 사용됨 (confirmationBuilder 에 병합해서 전달).
 */

const DATE_RULE_OPTIONS = [
  { value: '',             label: '(미지정)' },
  { value: 'today',        label: '오늘' },
  { value: '-1m',          label: '한 달 전' },
  { value: '-1y',          label: '1년 전' },
  { value: '-6m',          label: '6개월 전' },
  { value: '+6m',          label: '6개월 후' },
];

const TRANSPORT_OPTIONS = [
  { value: '',        label: '(미지정)' },
  { value: '쉽먼트',  label: '쉽먼트' },
  { value: '밀크런',  label: '밀크런' },
];

// 편집 가능한 필드 정의
const FIELDS = [
  { section: '회송 정보', key: 'returnContact',          label: '회송담당자',        type: 'text'        },
  { section: '회송 정보', key: 'returnPhone',            label: '회송담당자 연락처',   type: 'text'        },
  { section: '회송 정보', key: 'returnAddress',          label: '회송지 주소',        type: 'text'        },
  { section: '발주확정서 기본값', key: 'defaultTransport',      label: '기본 입고유형',      type: 'select', options: TRANSPORT_OPTIONS },
  { section: '발주확정서 기본값', key: 'defaultShortageReason', label: '기본 납품부족사유',  type: 'select',
    options: [{ value: '', label: '(미지정)' }, ...SHORTAGE_REASONS.map((r) => ({ value: r, label: r }))] },
  { section: '날짜 규칙',  key: 'manufactureDateRule',    label: '제조일자',           type: 'select', options: DATE_RULE_OPTIONS },
  { section: '날짜 규칙',  key: 'expirationDateRule',     label: '유통(소비)기한',     type: 'select', options: DATE_RULE_OPTIONS },
  { section: '날짜 규칙',  key: 'productionYearRule',     label: '생산연도',           type: 'select', options: DATE_RULE_OPTIONS },
];

export default function SettingsView() {
  const [vendors, setVendors] = useState([]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [defaults, setDefaults] = useState({});
  const [vendorOverrides, setVendorOverrides] = useState({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const reloadAll = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    const [vRes, sRes] = await Promise.all([
      api.loadVendors(),
      api.loadSettings(),
    ]);
    const vs = vRes?.vendors || [];
    setVendors(vs);
    setDefaults(sRes?.settings || {});
    if (!selectedVendorId && vs.length) {
      setSelectedVendorId(vs[0].id);
    }
  }, [selectedVendorId]);

  useEffect(() => { reloadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 선택 벤더 변경 시 overrides 동기화
  useEffect(() => {
    const v = vendors.find((x) => x.id === selectedVendorId);
    setVendorOverrides(v?.settings || {});
  }, [selectedVendorId, vendors]);

  const handleDefaultChange = (key, value) => {
    setDefaults((prev) => ({ ...prev, [key]: value }));
  };
  const handleVendorChange = (key, value) => {
    setVendorOverrides((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const api = window.electronAPI;
    if (!api) return;
    setSaving(true);
    setStatus('');
    try {
      // 전역 기본값 저장
      const saveDef = await api.saveSettings({ schemaVersion: 1, settings: defaults });
      if (!saveDef?.success) throw new Error(saveDef?.error || 'settings save 실패');

      // 선택 벤더의 settings 업데이트
      if (selectedVendorId) {
        const cur = await api.loadVendors();
        const list = cur?.vendors || [];
        const next = list.map((v) =>
          v.id === selectedVendorId ? { ...v, settings: vendorOverrides } : v,
        );
        const saveV = await api.saveVendors({ ...cur, vendors: next });
        if (!saveV?.success) throw new Error(saveV?.error || 'vendors save 실패');
        setVendors(next);
      }
      setStatus('저장됨');
    } catch (err) {
      setStatus(`저장 실패: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const sections = useMemo(() => {
    const map = new Map();
    for (const f of FIELDS) {
      if (!map.has(f.section)) map.set(f.section, []);
      map.get(f.section).push(f);
    }
    return [...map.entries()];
  }, []);

  const renderField = (field, value, onChange) => {
    if (field.type === 'select') {
      return (
        <select
          className="settings-input"
          value={value ?? ''}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type="text"
        className="settings-input"
        value={value ?? ''}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  };

  return (
    <div className="settings-view">
      <div className="settings-view__header">
        <h2>설정</h2>
        <div className="settings-view__vendor-select">
          <label>벤더</label>
          <select
            value={selectedVendorId}
            onChange={(e) => setSelectedVendorId(e.target.value)}
            disabled={!vendors.length}
          >
            {vendors.length === 0 && <option value="">(벤더 없음)</option>}
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name || v.id}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={handleSave}
          disabled={saving}
        >
          💾 {saving ? '저장 중...' : '저장'}
        </button>
        {status && <span className="settings-view__status">{status}</span>}
      </div>

      <div className="settings-table">
        <div className="settings-table__row settings-table__row--header">
          <div className="settings-table__label"></div>
          <div className="settings-table__col">기본값</div>
          <div className="settings-table__col">
            {selectedVendorId ? (vendors.find((v) => v.id === selectedVendorId)?.name || selectedVendorId) : '(벤더 선택)'}
          </div>
        </div>

        {sections.map(([section, fields]) => (
          <React.Fragment key={section}>
            <div className="settings-table__section">{section}</div>
            {fields.map((f) => {
              const def = defaults[f.key];
              const override = vendorOverrides[f.key];
              const effective = override !== undefined && override !== '' ? override : def;
              return (
                <div key={f.key} className="settings-table__row">
                  <div className="settings-table__label">{f.label}</div>
                  <div className="settings-table__col">
                    {renderField(f, def, handleDefaultChange)}
                  </div>
                  <div className="settings-table__col">
                    {renderField(f, override, handleVendorChange)}
                    {(override === undefined || override === '') && def && (
                      <span className="settings-table__fallback">→ 기본값 사용: {String(effective)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
