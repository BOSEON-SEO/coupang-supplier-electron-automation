import React, { useEffect, useState } from 'react';

/**
 * 헤더 우측의 수동 로그인 버튼.
 *
 * 동작:
 *   1. 클릭 시 자격증명 확인 → 없으면 안내
 *   2. python/scripts/login.py 실행 (저장된 자격증명 사용)
 *   3. python:done 이벤트 받으면 busy 해제
 *
 * 자동 로그인은 WorkView 가 자체적으로 처리하므로 이 버튼은
 * "사용자가 명시적으로 다시 로그인 시도하고 싶을 때" 사용한다.
 */
export default function LoginButton({ vendor }) {
  const [busy, setBusy] = useState(false);

  // 다른 곳(WorkView 자동 로그인 등)에서 시작된 Python 도 끝나면 busy 해제
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onPythonDone) return;
    const unsub = api.onPythonDone((data) => {
      const name = data?.scriptName || '';
      if (name.includes('login.py')) {
        setBusy(false);
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // 벤더 바뀌면 busy 리셋
  useEffect(() => {
    setBusy(false);
  }, [vendor]);

  const handleClick = async () => {
    if (!vendor) {
      alert('먼저 벤더를 선택하세요.');
      return;
    }
    const api = window.electronAPI;
    if (!api) return;

    const cred = await api.checkCredentials(vendor);
    if (!cred?.hasId || !cred?.hasPassword) {
      alert('자격증명이 설정되지 않았습니다.\n[⚙ 관리]에서 ID/PW를 먼저 저장하세요.');
      return;
    }

    setBusy(true);
    const res = await api.runPython('scripts/login.py', ['--vendor', vendor]);
    if (!res?.success) {
      if (res?.error && res.error.includes('already running')) {
        alert('이미 다른 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');
      } else {
        alert(`로그인 실행 실패: ${res?.error ?? 'unknown'}`);
      }
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="btn btn--secondary login-btn"
      onClick={handleClick}
      disabled={busy || !vendor}
      title="저장된 자격증명으로 쿠팡 서플라이어 로그인을 시도합니다"
    >
      {busy ? '◌ 로그인 중...' : '🔑 로그인'}
    </button>
  );
}
