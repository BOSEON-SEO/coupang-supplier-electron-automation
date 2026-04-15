/**
 * 벤더 파일명 규칙 및 최신 파일 탐색 헬퍼
 *
 * 파일명 스키마: `{vendor}-{YYYYMMDD}-{차수:02d}.xlsx`
 *   e.g.  basic-20260414-01.xlsx
 *
 * 유니크 키: (vendor, date, sequence) — 중복 시 덮어쓰기
 */

const FILENAME_RE = /^([a-z0-9_]+)-(\d{8})-(\d{2})\.xlsx$/i;

/**
 * 파일명 생성
 * @param {string} vendor
 * @param {Date|string} date  Date 객체 또는 'YYYYMMDD' 문자열
 * @param {number} sequence   1-99
 */
export function buildFileName(vendor, date, sequence) {
  if (!vendor) throw new Error('vendor required');
  if (!Number.isFinite(sequence) || sequence < 1 || sequence > 99) {
    throw new Error('sequence must be 1..99');
  }
  const ymd = typeof date === 'string' ? date : formatYmd(date);
  const seq = String(sequence).padStart(2, '0');
  return `${vendor}-${ymd}-${seq}.xlsx`;
}

export function formatYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function todayYmd() {
  return formatYmd(new Date());
}

/**
 * 파일명 파싱
 * @returns {{vendor: string, date: string, sequence: number} | null}
 */
export function parseFileName(name) {
  const m = FILENAME_RE.exec(name);
  if (!m) return null;
  return { vendor: m[1], date: m[2], sequence: Number(m[3]) };
}

/**
 * 파일 리스트에서 특정 벤더의 최신 항목 찾기 (date desc, sequence desc)
 * @param {string[]} fileNames
 * @param {string} vendor
 */
export function findLatest(fileNames, vendor) {
  const matches = fileNames
    .map((n) => ({ name: n, parsed: parseFileName(n) }))
    .filter((x) => x.parsed && x.parsed.vendor.toLowerCase() === vendor.toLowerCase())
    .sort((a, b) => {
      if (a.parsed.date !== b.parsed.date) {
        return a.parsed.date < b.parsed.date ? 1 : -1;
      }
      return b.parsed.sequence - a.parsed.sequence;
    });
  return matches[0]?.name ?? null;
}

/**
 * 특정 벤더/날짜에 대한 다음 차수 번호 계산
 */
export function nextSequence(fileNames, vendor, ymd) {
  const used = fileNames
    .map(parseFileName)
    .filter((p) => p && p.vendor.toLowerCase() === vendor.toLowerCase() && p.date === ymd)
    .map((p) => p.sequence);
  if (used.length === 0) return 1;
  return Math.min(99, Math.max(...used) + 1);
}
