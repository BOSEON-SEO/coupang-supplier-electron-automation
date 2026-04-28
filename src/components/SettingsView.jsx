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
  { section: '운송 분배 기본값', key: 'transportBoxes',         label: '기본 박스 수',      type: 'text' },
  { section: '운송 분배 기본값', key: 'transportWeight',        label: '기본 중량(kg)',     type: 'text' },
  // 팔레트 프리셋 — 밀크런 팔레트 블록의 '프리셋' 드롭다운에 노출됨.
  { section: '운송 분배 기본값', key: 'palletPreset',           label: '팔레트 프리셋',     type: 'list-select',
    listKey: 'palletPresetList', modalTitle: '팔레트 프리셋 관리',
    listFields: [
      { key: 'name',     label: '팔레트명', required: true, placeholder: '한국팔레트 대' },
      { key: 'width',    label: '가로(cm)', required: true, placeholder: '1100' },
      { key: 'height',   label: '세로(cm)', required: true, placeholder: '1100' },
      { key: 'depth',    label: '높이(cm)', required: true, placeholder: '1500' },
      { key: 'rentalId', label: '렌탈사', placeholder: '한국팔레트' },
    ],
    idField: 'name',
    primaryField: 'name',
  },
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
      // App 등 상위 컴포넌트가 설정 재로드하도록 신호
      window.dispatchEvent(new Event('settings-changed'));
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

      {/* 고급 — 전체 플러그인 on/off */}
      <div className="settings-advanced">
        <div className="settings-advanced__title">고급</div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={defaults.pluginsEnabled !== false}
            onChange={(e) => handleDefaultChange('pluginsEnabled', e.target.checked)}
          />
          <span className="settings-toggle__label">플러그인 활성화</span>
          <span className="settings-toggle__hint">
            모든 플러그인을 한꺼번에 on/off 합니다. 끄면 플러그인이 기여한 UI(탭·모달·
            체크박스 등) 가 전부 사라지고 순정 코어만 동작. 사이드바의 🔌 플러그인
            메뉴도 함께 숨겨집니다. 개별 토글은 🔌 플러그인 메뉴에서.
          </span>
        </label>
      </div>

      {/* 라이선스 — 캐시된 license dto 표시 + 재인증/지우기 */}
      <LicenseCard />

      {/* 업데이트 — 현재 버전 + 수동 체크 */}
      <UpdateCard />

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

/**
 * 라이선스 카드 — 캐시된 license dto 표시 + 재인증/지우기.
 * 자체 fetch 하므로 부모가 prop 으로 안 내려줘도 됨. license-changed 이벤트
 * 구독해 activate/reverify/clear 시 자동 갱신.
 */
function LicenseCard() {
  const [license, setLicense] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.electronAPI?.license?.get?.();
        if (!cancelled && res?.success) setLicense(res.license || null);
      } catch (_) { /* 무시 */ }
    })();
    const off = window.electronAPI?.license?.onChanged?.((dto) => setLicense(dto || null));
    return () => {
      cancelled = true;
      if (typeof off === 'function') off();
    };
  }, []);

  const handleReverify = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await window.electronAPI?.license?.reverify();
      setMsg(res?.success ? '재검증 완료' : `실패: ${res?.error || ''}`);
    } catch (err) {
      setMsg(`오류: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('저장된 라이선스를 지웁니다. 다음 실행 시 시리얼을 다시 입력해야 합니다. 진행할까요?')) return;
    setBusy(true); setMsg('');
    try {
      const res = await window.electronAPI?.license?.clear();
      setMsg(res?.success ? '라이선스 삭제됨' : `실패: ${res?.error || ''}`);
    } catch (err) {
      setMsg(`오류: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) { return iso; }
  };

  const status = license?.status || 'unlicensed';
  const statusLabel = {
    valid:        { text: '정상',         tone: 'ok' },
    'near-expiry': { text: '만료 임박',   tone: 'warn' },
    expired:      { text: '만료됨',       tone: 'danger' },
    invalid:      { text: '검증 실패',    tone: 'danger' },
    unlicensed:   { text: '인증되지 않음', tone: 'danger' },
  }[status] || { text: status, tone: 'warn' };

  return (
    <div className="license-card">
      <div className="license-card__head">
        <span className="license-card__title">🔐 라이선스</span>
        <span className={`license-card__status license-card__status--${statusLabel.tone}`}>
          {statusLabel.text}
        </span>
      </div>
      <dl className="license-card__grid">
        <dt>발급 ID</dt>      <dd>{license?.id || '—'}</dd>
        <dt>시리얼</dt>       <dd>{license?.serial || '—'}</dd>
        <dt>만료일</dt>       <dd>{formatDate(license?.expiredAt)}</dd>
        <dt>마지막 검증</dt>  <dd>{formatDate(license?.lastVerifiedAt)}</dd>
        <dt>권한</dt>         <dd>{(license?.entitlements || []).join(', ') || '—'}</dd>
      </dl>
      {msg && <div className="license-card__msg">{msg}</div>}
      <div className="license-card__actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={handleReverify}
          disabled={busy || !license?.id}
        >⟳ 재검증</button>
        <button
          type="button"
          className="btn btn--secondary license-card__danger"
          onClick={handleClear}
          disabled={busy || !license?.id}
        >라이선스 지우기</button>
      </div>
    </div>
  );
}

/**
 * 업데이트 카드 — 현재 버전 + 수동 체크. update:status 이벤트 구독해 상태 표시.
 * 실제 모달(다운로드/재시작 안내) 은 App.jsx 의 <UpdateModal /> 이 담당.
 */
function UpdateCard() {
  const [status, setStatus] = useState({ state: 'idle' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cur = await window.electronAPI?.update?.get?.();
        if (!cancelled && cur) setStatus(cur);
      } catch (_) { /* 무시 */ }
    })();
    const off = window.electronAPI?.update?.onStatus?.((s) => setStatus(s || { state: 'idle' }));
    return () => {
      cancelled = true;
      if (typeof off === 'function') off();
    };
  }, []);

  const handleCheck = async () => {
    setBusy(true);
    try { await window.electronAPI?.update?.check?.(); }
    finally { setBusy(false); }
  };

  const labelOf = {
    idle:        '대기',
    checking:    '확인 중…',
    available:   `새 버전 있음 (v${status.version || '?'})`,
    downloading: `다운로드 중 ${status.percent || 0}%`,
    downloaded:  `다운로드 완료 (v${status.version || '?'}) — 재시작 시 설치`,
    'up-to-date': '최신 버전입니다',
    dev:         '개발 모드 (자동 업데이트 비활성)',
    error:       `오류: ${status.error || ''}`,
    unavailable: '업데이트 모듈 미설치',
  }[status.state] || status.state;

  return (
    <div className="license-card update-card">
      <div className="license-card__head">
        <span className="license-card__title">⬇ 업데이트</span>
        <span className="license-card__status">{labelOf}</span>
      </div>
      <dl className="license-card__grid">
        <dt>현재 버전</dt>
        <dd>{__APP_VERSION__ || '—'}</dd>
      </dl>
      <div className="license-card__actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={handleCheck}
          disabled={busy || status.state === 'checking' || status.state === 'downloading'}
        >⟳ 업데이트 확인</button>
      </div>
    </div>
  );
}
