# 빌드 플레이버 (Phase 1)

플러그인을 **빌드 시점에** 선별해 비구매자 바이너리에는 코드가 들어가지 않게 한다. 동일 코드베이스에서 다른 산출물을 만들고, 각 산출물은 별도의 GitHub Release 채널을 사용해 자동 업데이트도 격리.

## 현재 flavor

| flavor | 포함 플러그인 | publish 채널 (BOSEON-SEO/) |
|---|---|---|
| `basic` | (없음 — 코어만) | `coupang-supplier-releases-basic` |
| `tbnws` | tbnws | `coupang-supplier-releases` |

새 flavor 추가:
1. [scripts/prepare-flavor.js](../scripts/prepare-flavor.js) `FLAVORS` 맵에 `acme: ['acme']` 추가
2. [scripts/build.js](../scripts/build.js) `PUBLISH_REPOS` 맵에 `acme: 'coupang-supplier-releases-acme'` 추가
3. GitHub 에 해당 public release repo 생성

## 빌드

```bash
npm run build         # = build:tbnws (기본)
npm run build:tbnws
npm run build:basic
```

각 flavor 의 `dist-electron/` 안 산출물의 `latest.yml` / NSIS 설치파일 안에 publish.repo 가 박혀있어 사용자는 자기 채널의 새 버전만 자동 업데이트로 받음.

## Phase 2 — 플러그인 별도 repo

각 플러그인은 별도 private GitHub repo 로 분리되어 있고, 코어의 `package.json` 에 git URL dependency 로 등록.

| 플러그인 | repo |
|---|---|
| tbnws | https://github.com/BOSEON-SEO/coupang-supplier-plugin-tbnws (private) |

플러그인 패키지 구조:
```
src/
  index.js   # renderer half (manifest export)
  main.js    # main process half (ipcMain.handle 등록)
  *.jsx      # 컴포넌트
package.json # peerDependencies: react, xlsx
```

코어가 webpack alias 로 `@core/*`, `@components/*` 를 노출하므로 플러그인 코드는 절대경로로 코어 모듈 참조. babel-loader 는 `node_modules/coupang-supplier-plugin-*` 패턴은 transpile 대상 포함.

## TODO (Phase 2.5)

- [ ] global.css 의 플러그인 prefix 클래스(`tbnws-*`)도 플러그인 패키지로 이전 — 현재 basic 번들에 CSS 이름만 남음
- [ ] basic 빌드 시 `node_modules/coupang-supplier-plugin-tbnws` 자체를 빼기 — 현재 package.json 에 항상 dep 으로 들어가 있어 asar 에 포함됨. flavor 별 package.json 관리 필요.

## 동작 원리

1. `scripts/prepare-flavor.js <flavor>` 가 `src/plugins/_generated.js` 를 새로 씀
   - basic: `export const MANIFESTS = [];`
   - tbnws: `import m0 from './tbnws'; export const MANIFESTS = [m0];`
2. `src/plugins/index.js` 가 `_generated.js` 를 그대로 re-export
3. webpack 이 정적 분석으로 import 안 된 모듈은 번들에 포함 X → tbnws 폴더 통째로 빠짐
4. electron-builder 의 `--config.publish.repo=<repo>` 로 GitHub Release 채널 override

## 검증

```bash
node scripts/prepare-flavor.js basic
npx webpack --mode production
grep -c "EflexOutboundModal\|StockAdjustView" dist/bundle.js   # → 0
```

## 배포 운영

각 flavor 빌드 후 별개 release 에 업로드:

```bash
# tbnws
npm run build:tbnws
gh release create v$(node -p "require('./package.json').version") \
  -R BOSEON-SEO/coupang-supplier-releases \
  --title "v$(node -p "require('./package.json').version")" \
  --notes-file release-notes/latest.md \
  dist-electron/coupang-supplier-automation-Setup-*.exe \
  dist-electron/coupang-supplier-automation-Setup-*.exe.blockmap \
  dist-electron/latest.yml

# basic
npm run build:basic
gh release create v$(node -p "require('./package.json').version") \
  -R BOSEON-SEO/coupang-supplier-releases-basic \
  ... (동일)
```

## dev 모드

`npm run dev` 는 `predev` hook 으로 `tbnws` flavor 자동 선택 — 모든 플러그인 포함된 채로 개발.
