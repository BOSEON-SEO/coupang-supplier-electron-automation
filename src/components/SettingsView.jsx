import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { SHORTAGE_REASONS } from '../core/confirmationBuilder';
import { DELIVERY_COMPANIES } from '../core/deliveryCompanies';
import ListManagerModal from './ListManagerModal';
import { SlotRenderer } from '../core/plugin-host';
import { KNOWN_SCOPES } from '../core/plugin-api';

/**
 * 설정 뷰 — 왼쪽 "기본값"(settings.json), 오른쪽 "선택 벤더"(vendors.json 의 vendor)
 *
 * 벤더 값이 비어있으면 기본값이 사용됨 (confirmationBuilder / 플러그인 창에 병합).
 *
 * 운송 분배 관련:
 *   - transportOriginList / transportRentalList 는 전역 settings 에만 저장 (공용 목록)
 *   - transportOrigin / transportRental 은 선택된 id. 벤더별 override 가능
 *   - 박스/중량/팔레트/팔레트 크기(WHD) 는 숫자, 벤더별 override 가능
 */

const DATE_RULE_OPTIONS = [
  { value: '',             label: '(미지정)' },
  { value: 'today',        label: '오늘' },
  { value: '-1m',          label: '한 달 전' },
  { value: '-1y',          label: '1년 전' },
  { value: '-6m',          label: '6개월 전' },
  { value: '+6m',          label: '6개월 후' },
];

// 쉽먼트 발송일 — 입고일 기준 n일 전/당일 선택. 월·년 단위는 의미 없어 제외.
const SHIPMENT_SEND_DATE_OPTIONS = [
  { value: '',       label: '(미지정)' },
  { value: 'today',  label: '입고일 당일' },
  { value: '-1d',    label: '1일 전' },
  { value: '-2d',    label: '2일 전' },
  { value: '-3d',    label: '3일 전' },
  { value: '-4d',    label: '4일 전' },
  { value: '-5d',    label: '5일 전' },
  { value: '-7d',    label: '7일 전' },
];

const TRANSPORT_OPTIONS = [
  { value: '',        label: '(미지정)' },
  { value: '쉽먼트',  label: '쉽먼트' },
  { value: '밀크런',  label: '밀크런' },
];

// 일반 scalar 필드 — 각 항목은 기본값/벤더 override 를 받음
const FIELDS = [
  { section: '회송 정보', key: 'returnContact',          label: '회송담당자',        type: 'text'        },
  { section: '회송 정보', key: 'returnPhone',            label: '회송담당자 연락처',   type: 'text'        },
  { section: '회송 정보', key: 'returnAddress',          label: '회송지 주소',        type: 'text'        },
  { section: '발주확정서 기본값', key: 'defaultTransport',      label: '기본 입고유형',      type: 'select', options: TRANSPORT_OPTIONS },
  { section: '발주확정서 기본값', key: 'defaultShortageReason', label: '기본 납품부족사유',  type: 'select',
    options: [{ value: '', label: '(미지정)' }, ...SHORTAGE_REASONS.map((r) => ({ value: r, label: r }))] },
  { section: '발주확정서 기본값', key: 'manufactureDateRule',   label: '제조일자',           type: 'select', options: DATE_RULE_OPTIONS },
  { section: '발주확정서 기본값', key: 'expirationDateRule',    label: '유통(소비)기한',     type: 'select', options: DATE_RULE_OPTIONS },
  { section: '발주확정서 기본값', key: 'productionYearRule',    label: '생산연도',           type: 'select', options: DATE_RULE_OPTIONS },

  // 운송 분배 — selector 필드들은 별도 처리 (아래 renderTransportRow)
  { section: '운송 분배 기본값', key: 'transportOrigin',        label: '밀크런 기본 출고지', type: 'list-select', listKey: 'transportOriginList', modalTitle: '출고지 관리',
    listFields: [
      { key: 'location_seq',     label: '출고지 ID',  required: true, placeholder: '쿠팡이 부여한 출고지 seq' },
      { key: 'location_name',    label: '표시명',     placeholder: '목록에 표시할 이름' },
      { key: 'location_address', label: '주소',       placeholder: '참고용 주소' },
    ],
    idField: 'location_seq',
    primaryField: 'location_name',
    secondaryField: 'location_address',
  },
  { section: '운송 분배 기본값', key: 'shipmentOrigin',         label: '쉽먼트 기본 출고지', type: 'list-select', listKey: 'shipmentOriginList', modalTitle: '쉽먼트 출고지 관리',
    listFields: [
      { key: 'location_seq',     label: '출고지 ID',  required: true, placeholder: '쿠팡이 부여한 출고지 seq' },
      { key: 'location_name',    label: '표시명',     placeholder: '목록에 표시할 이름' },
      { key: 'location_address', label: '주소',       placeholder: '참고용 주소' },
    ],
    idField: 'location_seq',
    primaryField: 'location_name',
    secondaryField: 'location_address',
  },
  { section: '운송 분배 기본값', key: 'transportRental',        label: '팔레트 렌탈사',     type: 'list-select', listKey: 'transportRentalList', modalTitle: '팔레트 렌탈사 관리',
    listFields: [
      { key: 'id', label: '렌탈사 이름', required: true, placeholder: '렌탈사 이름' },
    ],
  },
  { section: '운송 분배 기본값', key: 'transportBoxes',         label: '기본 박스 수',      type: 'text' },
  { section: '운송 분배 기본값', key: 'transportWeight',        label: '기본 중량(kg)',     type: 'text' },
  { section: '운송 분배 기본값', key: 'transportPallets',       label: '기본 팔레트 수',    type: 'text' },
  { section: '운송 분배 기본값', key: 'transportPalletWidth',   label: '팔레트 가로(cm)',   type: 'text' },
  { section: '운송 분배 기본값', key: 'transportPalletHeight',  label: '팔레트 세로(cm)',   type: 'text' },
  { section: '운송 분배 기본값', key: 'transportPalletDepth',   label: '팔레트 높이(cm)',   type: 'text' },
  { section: '운송 분배 기본값', key: 'milkrunProductType',    label: '밀크런 상품종류',    type: 'text' },

  // ── 쉽먼트 생성 기본값 ──
  { section: '쉽먼트 생성 기본값', key: 'shipmentDeliveryCompany', label: '택배사',         type: 'select', options: DELIVERY_COMPANIES },
  { section: '쉽먼트 생성 기본값', key: 'shipmentSendDateRule',    label: '발송일 (입고일 기준)', type: 'select', options: SHIPMENT_SEND_DATE_OPTIONS },
  { section: '쉽먼트 생성 기본값', key: 'shipmentSendTime',        label: '발송 시각 (HH:MM, 5분 단위)', type: 'text',  placeholder: '예: 14:30' },
  { section: '쉽먼트 생성 기본값', key: 'shipmentFakeInvoices',    label: '가송장번호 (박스별 1줄, 최대 9줄)', type: 'textarea', rows: 9, placeholder: '1박스 송장번호\n2박스 송장번호\n...' },
];

export default function SettingsView({ activeVendor }) {
  const [vendors, setVendors] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [vendorOverrides, setVendorOverrides] = useState({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  // ListManagerModal 을 열 때 대상 list 의 key 저장 ('transportOriginList' | 'transportRentalList')
  const [modalListKey, setModalListKey] = useState(null);

  const reloadAll = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    const [vRes, sRes] = await Promise.all([
      api.loadVendors(),
      api.loadSettings(),
    ]);
    setVendors(vRes?.vendors || []);
    setDefaults(sRes?.settings || {});
  }, []);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  useEffect(() => {
    const v = vendors.find((x) => x.id === activeVendor);
    setVendorOverrides(v?.settings || {});
  }, [activeVendor, vendors]);

  const activeVendorMeta = vendors.find((v) => v.id === activeVendor);

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
      const saveDef = await api.saveSettings({ schemaVersion: 1, settings: defaults });
      if (!saveDef?.success) throw new Error(saveDef?.error || 'settings save 실패');

      if (activeVendor) {
        const cur = await api.loadVendors();
        const list = cur?.vendors || [];
        const next = list.map((v) =>
          v.id === activeVendor ? { ...v, settings: vendorOverrides } : v,
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

  // 목록 관리 모달에서 저장 완료 시 — 전역 settings 의 해당 list 만 즉시 디스크 저장
  const handleListSave = async (listKey, items) => {
    const api = window.electronAPI;
    if (!api) return;
    const nextDefaults = { ...defaults, [listKey]: items };
    const res = await api.saveSettings({ schemaVersion: 1, settings: nextDefaults });
    if (!res?.success) throw new Error(res?.error || 'settings save 실패');
    setDefaults(nextDefaults);
  };

  const sections = useMemo(() => {
    const map = new Map();
    for (const f of FIELDS) {
      if (!map.has(f.section)) map.set(f.section, []);
      map.get(f.section).push(f);
    }
    return [...map.entries()];
  }, []);

  // 일반 필드 렌더
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
    if (field.type === 'list-select') {
      const list = defaults[field.listKey] || [];
      const idKey = field.idField || 'id';
      const primaryKey = field.primaryField || idKey;
      const label = (it) => {
        const main = it[primaryKey];
        const id = it[idKey];
        if (main && id && main !== id) return `${main} (${id})`;
        return main || id || '';
      };
      return (
        <div className="settings-list-select">
          <select
            className="settings-input"
            value={value ?? ''}
            onChange={(e) => onChange(field.key, e.target.value)}
          >
            <option value="">(미지정)</option>
            {list.map((it) => (
              <option key={it[idKey]} value={it[idKey]}>{label(it)}</option>
            ))}
          </select>
        </div>
      );
    }
    if (field.type === 'textarea') {
      return (
        <textarea
          className="settings-input settings-input--textarea"
          rows={field.rows || 5}
          placeholder={field.placeholder || ''}
          value={value ?? ''}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
    }
    return (
      <input
        type="text"
        className="settings-input"
        placeholder={field.placeholder || ''}
        value={value ?? ''}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  };

  // 활성 모달 필드 찾기
  const activeModalField = modalListKey
    ? FIELDS.find((f) => f.listKey === modalListKey)
    : null;

  return (
    <div className="settings-view">
      <div className="settings-view__header">
        <h2>설정</h2>
        <div className="settings-view__spacer" />
        <SlotRenderer scope={KNOWN_SCOPES.SETTINGS_SECTION} />
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={handleSave}
          disabled={saving || !activeVendor}
          title={!activeVendor ? '헤더에서 벤더를 먼저 선택하세요' : ''}
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
            {activeVendor
              ? `현재 벤더 (${activeVendorMeta?.name || activeVendor})`
              : '현재 벤더 (미선택)'}
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
                  <div className="settings-table__label">
                    {f.label}
                    {f.type === 'list-select' && !f.noManage && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--xs settings-manage-btn"
                        onClick={() => setModalListKey(f.listKey)}
                        title={f.modalTitle}
                      >⚙ 관리</button>
                    )}
                  </div>
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

      {activeModalField && (
        <ListManagerModal
          title={activeModalField.modalTitle}
          items={defaults[activeModalField.listKey] || []}
          fields={activeModalField.listFields}
          idField={activeModalField.idField}
          primaryField={activeModalField.primaryField}
          secondaryField={activeModalField.secondaryField}
          onSave={(items) => handleListSave(activeModalField.listKey, items)}
          onClose={() => setModalListKey(null)}
        />
      )}
    </div>
  );
}
