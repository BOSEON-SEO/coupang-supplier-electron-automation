import React from 'react';
import { useRegistrySnapshot, usePluginRuntime } from '../core/plugin-host';
import { listLoadedPlugins } from '../core/plugin-registry';

/**
 * 플러그인 메뉴 — 현재 로드된 플러그인·등록된 확장 포인트 현황.
 *
 * 향후:
 *   - 활성화 가능한 플러그인 목록 (disk/registry scan)
 *   - 플러그인별 개별 on/off (entitlement 과 별도로 사용자 토글)
 *   - 플러그인 설정 (각 플러그인이 기여한 settings.section 을 여기로 이동)
 *   - 라이선스 서버 연동 상태, 갱신 버튼
 *
 * 현재는 현황 대시보드만.
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

        <section className="plugins-view__section plugins-view__section--muted">
          <h3 className="plugins-view__section-title">곧 추가될 기능</h3>
          <ul className="plugins-view__todo">
            <li>활성화 가능한 플러그인 목록 (disk 스캔)</li>
            <li>플러그인별 on/off 토글</li>
            <li>플러그인 고유 설정 영역</li>
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
