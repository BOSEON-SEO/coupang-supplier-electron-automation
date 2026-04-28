/**
 * electron-builder afterPack hook — 패킹된 일렉트론 바이너리에 보안 fuse 를
 * "구워" 넣는다. 카피캣이 ELECTRON_RUN_AS_NODE 로 임의 코드 실행하거나 ASAR
 * 무결성 우회하는 시나리오 차단.
 *
 * 호출 시점: dist-electron/win-unpacked/<app>.exe 가 만들어진 직후, installer
 * 패키징 전. afterPack(context) 의 context.appOutDir 가 unpacked 디렉토리.
 *
 * 적용 fuse (출시용):
 *   - RunAsNode: false           — node CLI 모드 차단 (--inspect 등으로 임의
 *                                    JS 실행 불가)
 *   - EnableNodeCliInspectArguments: false
 *   - EnableNodeOptionsEnvironmentVariable: false
 *   - EnableEmbeddedAsarIntegrityValidation: true
 *                                  — asar 변조 시 앱 실행 거부
 *   - OnlyLoadAppFromAsar: true   — asar 외부의 app 코드 로드 거부
 *   - LoadBrowserProcessSpecificV8Snapshot: false
 *   - GrantFileProtocolExtraPrivileges: false
 *
 * 참고: https://www.electronjs.org/docs/latest/tutorial/fuses
 *
 * 의존성: npm i -D @electron/fuses
 */

const path = require('path');

module.exports = async function afterPack(context) {
  // ESM only 패키지 — dynamic import 로 로드.
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');

  const exeName = context.packager.appInfo.productFilename + '.exe';
  const exePath = path.join(context.appOutDir, exeName);

  console.log(`[fuses] applying to ${exePath}`);

  await flipFuses(exePath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: true,

    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    // electron-builder 24.x 가 asar 무결성 해시를 exe 리소스에 자동 임베드
    // 하지 않아 true 로 두면 부팅 시 FindResource 실패로 앱이 안 뜸.
    // OnlyLoadAppFromAsar 만으로도 외부 코드 로드는 차단되므로 일단 false.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    // GrantFileProtocolExtraPrivileges: false 면 asar 내부 file:// 로드까지
    // 막혀서 dist/index.html 못 띄움. 우리 앱은 file:// 로 로컬 자원 사용 →
    // true 유지 필수.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  });

  console.log('[fuses] done');
};
