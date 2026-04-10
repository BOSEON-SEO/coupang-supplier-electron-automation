## Phase 1: 앱 스켈레톤 + PO 다운로드 + 작업 뷰 editable table

### 목표
Electron 앱 뼈대 구축, 벤더 선택 UI, PO SKU 자동 다운로드, 다운로드 결과를 작업 뷰 editable table로 표시, 로컬 Excel 저장/불러오기 동기화

### 주요 산출물
- Electron Main + Renderer 프로젝트 초기화
- 웹 뷰(BrowserView) + 작업 뷰(React editable table) 탭 UI
- 벤더 선택 드롭다운 + `vendors.json` 추가/수정 UI
- Python subprocess 브릿지 (IPC ↔ Playwright)
- PO SKU 다운로드 자동화 (CDP attach → 파일 polling)
- 다운로드 결과 editable table 렌더링
- 로컬 Excel 저장 (`{vendor}-{YYYYMMDD}-{차수}.xlsx`) 및 재시작 시 불러오기

### DoD
- 앱 실행 → 벤더 선택 → PO 다운로드 실행 → 작업 뷰에 데이터 표시 → Excel 저장 → 재시작 후 동일 데이터 복원 가능
- 위험 동작 3초 카운트다운 UI 작동 확인

---

## Phase 2: 납품여부 선택 + 발주확정 업로드 자동화

### 목표
작업 뷰에서 상품별 납품여부(보냄/반려) 수동 선택 → 선택 완료 후 발주확정 업로드 자동화 연동

### 주요 산출물
- 납품여부 선택 컬럼 (드롭다운/토글) editable table에 추가
- 선택 상태 Excel 자동 저장 (중간 저장 포함)
- 발주확정 업로드 자동화 (약관동의 JS 조작, display:none 체크박스 처리)
- 업로드 결과 작업 뷰 로그 스트리밍
- 쿠팡 양식 다운로드 버튼

### DoD
- 납품여부 선택 → 저장 → 업로드 실행 → 결과 로그 확인 전체 사이클 완료

---

## Phase 3: 밀크런 배치등록 + 통합 양식 다운로드

### 목표
밀크런 배치등록 자동화 및 내부 통합 양식(현황 Excel) 다운로드 기능 완성

### 주요 산출물
- 밀크런 배치등록 자동화 (enabled 행 순회, 출고지/박스/중량/팔레트 자동입력)
- 작업 뷰: 밀크런 데이터 editable table
- 통합 양식 다운로드 (내부 현황 포맷)
- 벤더별 출고지 seq 설정 `vendors.json` 반영

### DoD
- 3가지 자동화(PO, 발주, 밀크런) 전체 사이클 작동
- 쿠팡 양식 / 통합 양식 각각 다운로드 가능

---

## Phase 4: 멀티 벤더 세션 격리 + 안정화

### 목표
basic/canon 등 복수 벤더 동시 운영, 세션 격리, 오류 복구, UX 다듬기

### 주요 산출물
- Electron partition 기반 벤더별 세션 격리
- 세션 만료 자동 감지 + 재로그인 흐름
- 비밀번호 만료 모달 자동 dismiss
- 오류 발생 시 작업 뷰 알림 + 재시도 UI
- 앱 자동 업데이트 기반 구조 (electron-updater)

### DoD
- 벤더 전환 시 세션 충돌 없음
- 네트워크 오류/세션 만료 상황에서 앱 크래시 없이 복구 가능