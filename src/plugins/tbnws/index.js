/**
 * tbnws 플러그인 — 사내(TBN Works) 커스텀 로직
 *
 * PO 원본을 기반으로:
 *   - 재고매칭 시트: SKU별 출고여부/신청수량/반출수량 입력
 *   - 물류작업 시트: 창고별 그룹 + 쉽먼트/밀크런 + 박스/팔레트 분배
 *
 * 시트 데이터 형식은 FortuneSheet celldata 배열.
 */

import { buildMatchingSheet } from './sheets/matching';
import { buildLogisticsSheet } from './sheets/logistics';

export default {
  id: 'tbnws',
  name: 'TBN Works',

  sheetLabels: {
    data: 'PO 원본',
    matching: '재고매칭',
    logistics: '물류작업',
  },

  buildMatchingSheet,
  buildLogisticsSheet,

  // TODO: 쿠팡 양식 export, validate
};
