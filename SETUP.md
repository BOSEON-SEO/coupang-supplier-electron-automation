# 쿠팡 서플라이어 허브 Electron 자동화 앱 — Developer Setup

자동화 Agent 가 처리할 수 없어 **사람이 직접** 해야 하는 작업 목록입니다.
완료하면 체크박스를 켜고 커밋하세요.

## Manual Tasks

- [ ] Chrome을 원격 디버깅 모드로 실행하는 단축아이콘/스크립트 준비 (예: chrome.exe --remote-debugging-port=9222) — CDP attach 전제 조건
- [ ] vendors.json에 basic/canon 벤더 초기값 및 자격증명(COUPANG_ID_BASIC, COUPANG_PW_BASIC, COUPANG_ID_CANON, COUPANG_PW_CANON) 설정 확인
- [ ] Python 3.x 및 Playwright Python 패키지(playwright, asyncio) 로컬 설치 및 경로 확인 — Electron child_process에서 호출할 python 실행파일 경로 필요
- [ ] excel MCP 서버 .mcp.json env 설정 확인 (로컬 xlsx 읽기/쓰기 경로 권한)
- [ ] filesystem MCP 서버 .mcp.json의 호스트 경로를 프로젝트 워크스페이스로 설정
