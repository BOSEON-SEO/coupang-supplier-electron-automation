/**
 * 쿠팡 물류센터 초기 seed.
 *
 * 플러그인 설정에 `coupangWarehouses` 가 비어있을 때 1회 자동 주입되며,
 * 이후에는 플러그인 상세 설정 → "쿠팡 창고 관리" 모달에서 사용자가 CRUD.
 *
 * 필드:
 *   - seq:         원본 DB 의 PK (TBNWS_ADMIN.coupang_warehouse.seq).
 *                  UI 에서 신규 추가 시 현재 max+1 로 자동 부여.
 *   - centerName:  엑셀 '물류센터' 값과 exact match 되는 센터명.
 *                  출고예정 모달이 이 값으로 lookup 해 수취인 연락처/주소를 자동 채움.
 *   - contact:     1차 연락처 → body.user_contact.
 *   - contact2:    2차 연락처 → body.user_phone (없으면 contact fallback).
 *   - address:     주소 → body.user_address.
 */

export const COUPANG_WAREHOUSES_SEED = [
  { seq: 1,  centerName: '고양1',       contact: '070-7730-9778', contact2: null,            address: '경기도 고양시 덕양구 권율대로 570, 쿠팡 고양물류센터 3번 Gate' },
  { seq: 2,  centerName: '곤지암2(RC)', contact: '070-7745-2801', contact2: null,            address: '경기도 광주시 곤지암읍 신대길 134-14' },
  { seq: 3,  centerName: '광주',         contact: '070-4276-5111', contact2: null,            address: '경기도 광주시 도척면 진우리 1006번지 쿠팡 KKW1센터' },
  { seq: 4,  centerName: '전라광주4',    contact: '070-4735-8079', contact2: null,            address: '광주광역시 광산구 연산동 1252' },
  { seq: 5,  centerName: '김해2',        contact: '070-4112-4660', contact2: null,            address: '경상남도 김해시 상동면 대감리 5-8번지(2F), 김해2 물류센터' },
  { seq: 6,  centerName: '대구',         contact: '070-4915-9267', contact2: null,            address: '경상북도 칠곡군 지천면 연화리 700번지 영남복합물류 10동 쿠팡 제3물류센터' },
  { seq: 7,  centerName: '대구2',        contact: '070-4915-9269', contact2: null,            address: '경상북도 칠곡군 지천면 연화리 700번지 영남복함물류 9동 쿠팡 제6물류센터' },
  { seq: 8,  centerName: '대구3',        contact: '070-5161-9378', contact2: null,            address: '대구광역시 달성군 구지면 국가산단대로46길 113' },
  { seq: 9,  centerName: '대구6',        contact: '070-5158-6437', contact2: null,            address: '경상북도 칠곡군 지천면 금호로 272 영남복합물류공사 8동' },
  { seq: 10, centerName: '덕평1',        contact: '031-694-7830',  contact2: null,            address: '경기도 이천시 마장면 덕평리 615 쿠팡 DEO1 센터 (지상1~3층)' },
  { seq: 11, centerName: '동탄1',        contact: '070-7771-6873', contact2: null,            address: '경기도 화성시 신동 703 쿠팡동탄물류센터 3F' },
  { seq: 12, centerName: '마장1',        contact: '070-4449-3617', contact2: null,            address: '경기도 이천시 마장면 청강가창로 309, 켄달스퀘어 A동 2층' },
  { seq: 13, centerName: '목천1',        contact: '070-4236-1438', contact2: null,            address: '충청남도 천안시 동남구 수신면 5산단로 185' },
  { seq: 14, centerName: '부천1',        contact: '070-8898-8565', contact2: null,            address: '경기도 부천시 신흥로 511번길 80 켄달스퀘어 3F B동' },
  { seq: 15, centerName: '서울',         contact: '070-5038-6954', contact2: null,            address: '서울특별시 송파구 장지동 875번지 E동 쿠팡 SEL1센터 10번 Dock' },
  { seq: 16, centerName: '시흥2',        contact: '070-4179-3271', contact2: null,            address: '경기도 시흥시 정왕동 2123-3번지 (3~7F)' },
  { seq: 17, centerName: '안산2',        contact: '070-7730-9776', contact2: null,            address: '경기도 안산시 단원구 성곡동 796 1층' },
  { seq: 18, centerName: '안성4',        contact: '070-4941-7302', contact2: null,            address: '경기도 안성시 죽산면 녹배길 35(장능리 35-4)' },
  { seq: 19, centerName: '안성5',        contact: '070-7732-9446', contact2: null,            address: '경기도 안성시 원곡면 원곡물류단지 1로 61' },
  { seq: 20, centerName: '안성7',        contact: '070-7732-9074', contact2: null,            address: '경기도 안성시 원곡면 원곡물류단지 1로 61' },
  { seq: 21, centerName: '양산1',        contact: '070-4452-8234', contact2: null,            address: '경상남도 양산시 물금읍 제방로 27' },
  { seq: 22, centerName: '여주1',        contact: '070-8894-1284', contact2: null,            address: '경기도 여주시 점봉동 204-3' },
  { seq: 23, centerName: '용인1',        contact: '070-4204-5122', contact2: null,            address: '경기도 용인시 처인구 백암면 백봉리 487-1 2F' },
  { seq: 24, centerName: '용인2',        contact: '070-4204-5121', contact2: null,            address: '경기도 용인시 처인구 남사면 처인성로 1027 (B1F)' },
  { seq: 25, centerName: '용인3',        contact: '070-4204-5122', contact2: null,            address: '경기도 용인시 처인구 남사면 처인성로 1027 (2F)' },
  { seq: 26, centerName: '이천1(RC)',   contact: '070-4112-5205', contact2: null,            address: '경기도 이천시 부발읍 중부대로 1763번길 80-7' },
  { seq: 27, centerName: '이천2',        contact: '070-5158-8142', contact2: null,            address: '경기도 이천시 마장면 이장로 329-38' },
  { seq: 28, centerName: '이천3',        contact: '070-5158-8147', contact2: null,            address: '경기도 이천시 대월면 대장로 190 3층' },
  { seq: 29, centerName: '이천4',        contact: '070-5158-8142', contact2: null,            address: '경기도 이천시 부발읍 송온리 442' },
  { seq: 30, centerName: '인천1',        contact: '032-569-5091',  contact2: null,            address: '인천 서구 오류동 1544-4 쿠팡 인천1물류센터' },
  { seq: 31, centerName: '인천13(RC)',  contact: '032-569-5091',  contact2: null,            address: '인천광역시 서구 원창동 391-21 3F~6F' },
  { seq: 32, centerName: '인천4',        contact: '070-8852-7709', contact2: null,            address: '인천 서구 오류동 1545-2 쿠팡 인천4물류센터' },
  { seq: 33, centerName: '인천5',        contact: '070-4481-8840', contact2: null,            address: '인천 서구 오류동 1544-2 쿠팡 인천5물류센터' },
  { seq: 34, centerName: '인천18',       contact: '070-4788-2590', contact2: null,            address: '인천광역시 중구 영종순환로 900번길 30 1층' },
  { seq: 35, centerName: '창원1',        contact: '070-4420-4468', contact2: null,            address: '경상남도 창원시 진해구 두동 1874 3층' },
  { seq: 36, centerName: '창원4',        contact: '070-5167-2371', contact2: null,            address: '경상남도 창원시 진해구 두동남로 52 2층' },
  { seq: 37, centerName: '천안',         contact: '070-8855-1738', contact2: null,            address: '충청남도 천안시 서북구 입장면 용정리 113-3번지 롯데 주류센터 2층 쿠팡 천안 물류센터' },
  { seq: 38, centerName: '평택1',        contact: '070-4106-8409', contact2: null,            address: '평택시 포승읍 만호리 666 BLK평택 물류센터 4층 408도크' },
  { seq: 39, centerName: '호법',         contact: '070-4234-7009', contact2: null,            address: '경기도 이천시 호법면 매곡리 977-5' },
  { seq: 40, centerName: 'XRC01(RC)',    contact: '070-4398-2863', contact2: null,            address: '경기도 이천시 모가면 공원로 112 2~4F' },
  { seq: 41, centerName: '안성8',        contact: '070-5158-8104', contact2: null,            address: '경기도 안성시 일죽면 능국리 23-10, 836-4 우회전' },
  { seq: 42, centerName: '인천14',       contact: '1670-4132',     contact2: '070-5014-4466', address: '인천광역시 중구 축항대로 165번길 20' },
  { seq: 43, centerName: '금왕1',        contact: '070-4786-7707', contact2: null,            address: '충북 음성군 금왕읍 금왕테크노로 14' },
  { seq: 44, centerName: '인천16',       contact: '070-4754-0751', contact2: null,            address: '인천광역시 중구 서해대로 113' },
  { seq: 45, centerName: '천안2',        contact: '010-5571-1446', contact2: null,            address: '충남 천안시 서북구 새터길 5' },
  { seq: 46, centerName: '경기광주3',    contact: '070-4732-1870', contact2: null,            address: '경기도 광주시 오포로297번길 54 1F' },
  { seq: 47, centerName: '인천28',       contact: '070-4741-9123', contact2: null,            address: '인천광역시 서구 북항로 120번길 55, 7~9F' },
  { seq: 48, centerName: '창원3',        contact: '070-5154-9945', contact2: null,            address: '경상남도 창원시 진해구 두동 1874 5층 쿠팡 창원3센터' },
  { seq: 49, centerName: '이천1',        contact: '070-5154-9462', contact2: null,            address: '경기 이천시 부발읍 중부대로1763번길 80-7 쿠팡 이천1센터' },
  { seq: 50, centerName: '대구8',        contact: '070-4756-9603', contact2: null,            address: '대구광역시 달성군 구지면 국가산단대로46길 113, 1A-04 도크' },
  { seq: 51, centerName: '인천26',       contact: '070-7824-4666', contact2: null,            address: '인천광역시 서구 북항로 120번길 55, 3F' },
  { seq: 52, centerName: '경기광주5',    contact: '070-4786-7034', contact2: null,            address: '경기도 광주시 오포로297번길 35' },
  { seq: 53, centerName: '인천30',       contact: '070-5159-0578', contact2: null,            address: '인천광역시 서구 거북로 13 (5~10F)' },
  { seq: 54, centerName: '경기광주1',    contact: '070-4276-5111', contact2: null,            address: '경기도 광주시 도척면 진우리 1006번지 쿠팡 KKW1센터' },
  { seq: 55, centerName: '양지5',        contact: '070-5014-4466', contact2: null,            address: '경기도 용인시 처인구 양지면 남평로 113' },
  { seq: 56, centerName: '전라광주2',    contact: '070-5150-0951', contact2: null,            address: '광주광역시 광산구 평동산단9번로 43 6F~8F' },
  { seq: 57, centerName: '인천36',       contact: '070-4779-6150', contact2: null,            address: '인천광역시 서구 북항로 120번길 55, A동 6층' },
  { seq: 58, centerName: '전라광주5',    contact: '070-5150-0952', contact2: null,            address: '광주광역시 광산구 평동산단9번로 43 1층, 4층' },
  { seq: 59, centerName: '천안6',        contact: '070-4763-7951', contact2: null,            address: '충청남도 천안시 서북구 입장면 용정리192' },
  { seq: 60, centerName: 'XRC06(RC)',    contact: '041-414-2515',  contact2: null,            address: '충남 천안시 서북구 새터길 5(오목리 106-8), B1F,1F~3F' },
  { seq: 61, centerName: '인천32',       contact: '070-4747-2982', contact2: null,            address: '인천광역시 서구 봉수대로 370 B동 2F~7F' },
  { seq: 62, centerName: 'XRC03(RC)',    contact: '031-8011-9127', contact2: null,            address: '경기 이천시 백사면 이여로 501 1F~4F(MQ)' },
  { seq: 63, centerName: 'XRC07(RC)',    contact: '031-639-5531',  contact2: null,            address: '경기도 이천시 대월면 대월로 627-61 1F/2F' },
  { seq: 64, centerName: '인천42',       contact: '070-4747-2984', contact2: null,            address: '인천광역시 서구 봉수대로 370, 쿠팡42센터(A동) 7층 710' },
  { seq: 65, centerName: 'XRC14(RC)',    contact: '031-990-5020',  contact2: null,            address: '경기도 여주시 가남읍 삼군리 550 B1,1,3,4F' },
  { seq: 66, centerName: '안산3',        contact: '070-4754-8771', contact2: null,            address: '경기도 안산시 단원구 시화호수로 835, 3~4F' },
  { seq: 67, centerName: '인천45',       contact: '070-5172-3290', contact2: null,            address: '인천 미추홀구 도화동 1042, 8층 A7, A8번 도크 앞' },
];

/**
 * centerName → warehouse 객체 Map 생성.
 * exact match lookup 용.
 */
export function buildWarehouseIndex(warehouses) {
  const map = new Map();
  for (const w of Array.isArray(warehouses) ? warehouses : []) {
    if (!w || !w.centerName) continue;
    map.set(String(w.centerName).trim(), w);
  }
  return map;
}
