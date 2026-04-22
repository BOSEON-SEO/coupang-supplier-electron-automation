// FindBar 같은 HTML 오버레이가 WebContentsView 위에 보이게 하려면,
// WCV 자체의 bounds 를 줄여 공간을 확보해야 한다 (native view 는 HTML 을 덮음).
// 이 모듈은 "위에서 몇 px 예약할지" 를 global state 로 공유 —
// FindBar 가 세팅하고 WebView 가 구독해서 setBounds 호출 시 반영.

let reserveTop = 0;
const listeners = new Set();

export function setReserveTop(v) {
  const next = Math.max(0, Number(v) || 0);
  if (next === reserveTop) return;
  reserveTop = next;
  listeners.forEach((l) => {
    try { l(reserveTop); } catch { /* 무시 */ }
  });
}

export function getReserveTop() {
  return reserveTop;
}

export function subscribeReserveTop(fn) {
  listeners.add(fn);
  try { fn(reserveTop); } catch { /* 무시 */ }
  return () => listeners.delete(fn);
}
