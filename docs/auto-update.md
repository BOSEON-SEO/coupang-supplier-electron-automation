# 자동 업데이트 가이드

`electron-updater` + Supabase Storage(generic provider) 조합. 빌드 산출물을 public bucket 에 올리면 클라이언트가 5초 후 부팅 시 자동 감지 → 모달로 사용자에게 알림 → 동의 시 다운로드/재시작.

## 한 번만 — GitHub Release 저장소 준비

1. GitHub 에 **public** 저장소 새로 생성: `BOSEON-SEO/coupang-supplier-releases`
   - 코드는 없음 — Releases 탭만 사용
   - public 이라야 클라이언트가 토큰 없이 다운로드 가능
2. (선택) 코드 저장소와 분리한 이유: 릴리즈는 누구나 다운로드 가능해도
   라이선스 검증이 부팅 시 막아주니까 OK. private 으로 가려면 토큰 필요.

---

## 릴리즈 배포 절차

### 1) 버전 올리기

```bash
# 패치/마이너/메이저 중 골라
npm version patch        # 0.1.0 → 0.1.1
```

`package.json` 의 `version` 이 올라가고 git tag 도 자동 생성.

### 2) 릴리즈 노트 작성

`release-notes/<version>.md` 만들고 주요 변경점 작성:

```markdown
- 재고조정 모달 sku_id 매칭 버그 수정
- 파렛트 적재리스트에서 확정수량 0 행 제외
- 라이선스 만료 임박 배너 추가
```

`package.json` 의 `build.releaseInfo.releaseNotesFile` 가 `release-notes/${version}.md` 로 설정돼 있어 빌드 시 자동으로 `latest.yml` 에 inline.

### 3) 빌드

```bash
npm run build
```

산출물 (`dist-electron/`):
- `쿠팡 서플라이어 자동화 Setup x.x.x.exe`
- `latest.yml` (버전·sha512·릴리즈노트 메타)
- `*.blockmap` (델타 업데이트 최적화)

### 4) GitHub Release 로 업로드

옵션 A — **GitHub 웹 UI**:
1. https://github.com/BOSEON-SEO/coupang-supplier-releases/releases/new
2. Tag: `v1.0.1` (또는 현재 버전)
3. Title: `v1.0.1` (자유)
4. Description: 릴리즈 노트 붙여넣기 (선택)
5. Attach binaries 영역에 3개 파일 드래그:
   - `coupang-supplier-automation-Setup-x.x.x.exe`
   - `coupang-supplier-automation-Setup-x.x.x.exe.blockmap`
   - `latest.yml`
6. **Publish release**

옵션 B — **CLI 자동화** (`gh` 설치돼있으면):
```bash
cd dist-electron
gh release create v$(node -p "require('../package.json').version") \
  -R BOSEON-SEO/coupang-supplier-releases \
  --title "v$(node -p "require('../package.json').version")" \
  --notes-file ../release-notes/latest.md \
  *.exe *.blockmap latest.yml
```

### 5) 검증

설치된 구버전 앱 실행 → 5초 후 콘솔 로그 `[update] Found version x.x.x` → 모달이 자동으로 뜨면 성공.

---

## 동작 흐름

| 상태          | 트리거                          | UI                            |
|---------------|--------------------------------|-------------------------------|
| `checking`    | 부팅 5초 후 / 수동 "확인" 클릭 | 설정 카드 라벨만 갱신         |
| `available`   | 신규 버전 발견                  | 모달 — 노트 + [다운로드/나중에] |
| `downloading` | 사용자가 다운로드 동의           | 모달 — 진행률 바              |
| `downloaded`  | 다운 완료                        | 모달 — [재시작/나중에]         |
| `up-to-date`  | 동일 또는 더 낮은 버전           | 설정 카드 라벨만 갱신         |
| `error`       | 네트워크/서명/해시 오류          | 모달 — 메시지 + 닫기          |

`autoDownload: false` — 무조건 사용자 동의 후 다운로드.
`autoInstallOnAppQuit: false` — 종료 시 몰래 설치 안 함, 명시적 `quitAndInstall` 만.

## 보안

- electron-updater 가 `latest.yml` 의 sha512 로 변조 검증 (자동).
- EV 코드서명 도입 후 `package.json` 의 `build.win.verifyUpdateCodeSignature` 를 `true` 로 — 서명 검증까지 강제.
- Supabase Storage 는 HTTPS 만 — 중간자 공격 방어는 TLS 가 담당.

## 라이선스 만료자 차단 (추후)

부팅 자동 체크 직전에 `license:reverify` 강제 → expired 면 업데이트 채널 막기. 별도 PR 로 적용 예정.
