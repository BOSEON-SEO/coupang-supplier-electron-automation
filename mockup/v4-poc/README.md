# Coupang Inbound v4 — UI POC

`new_ui/` v4 디자인을 Electron 셸로 띄우는 1차 POC. 데이터·자동화·DB는 전부 mock — 클릭해서 화면 흐름만 확인하는 용도.

## 실행

```bash
npm install
npm start
```

`ELECTRON_RUN_AS_NODE` 가 환경에 박혀있으면 Electron 이 Node 모드로 떨어져 `app is undefined` 에러가 난다. `scripts/launch.js` 가 이걸 제거하고 띄운다.

## 클릭 흐름

1. **달력 윈도우** 좌측 사이드바에서 벤더 선택 → 날짜 클릭
2. **PO 리스트 윈도우** 사이드바에서 차수 클릭 → "작업 창 열기"
3. **Job 윈도우** 좌측 step 사이드바: 검토 → 확정 → 쉽먼트 인박스 → 밀크런 인박스 → 결과
4. 달력 사이드바 "플러그인" → 플러그인 매니저 → tbnws 토글 시 검토 컬럼/admin-sync step 추가
5. 확정 step에서 "발주확정 업로드" → 카운트다운 → 단계 모달

## 다음 단계

- M0: floating webview PoC (BrowserView attach)
- M0: better-sqlite3 빌드 검증
- M1~M7: 본 프로젝트 (`coupang-supplier-electron-automation`) 의 `feat/new-ui-v4` 브랜치에 통합
