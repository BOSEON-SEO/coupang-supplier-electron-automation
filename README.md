# 쿠팡 서플라이어 허브 Electron 자동화 앱

Electron + Playwright CDP attach 기반 쿠팡 Supplier Hub 자동화 데스크탑 앱 — PO 다운로드·발주 업로드·밀크런 등록을 웹 뷰(동작 확인)와 작업 뷰(editable table)로 분리 운영

## Stack
- Electron
- React
- Python
- Playwright
- Node.js
- xlsx
- JSON

## Constraints
- Playwright는 Akamai 우회를 위해 반드시 CDP attach 방식만 사용 (직접 launch 절대 금지)
- Keycloak access_token이 JS 메모리에만 존재하므로 새 탭 생성 금지, pages[0] 재사용 필수
- 로컬 저장은 Excel + JSON 파일만 사용 (이 버전에서 외부 DB 연동 없음)
- 벤더-날짜-차수 조합은 유니크 (중복 시 덮어쓰기)
- 위험 동작(Submit/적용 등) 실행 전 반드시 3초 카운트다운 UI 표시 및 취소 가능
- Python 자동화 코드는 Main process와 IPC로만 통신, Renderer에서 직접 subprocess 호출 금지
