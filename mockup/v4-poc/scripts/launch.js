// Electron launcher that scrubs ELECTRON_RUN_AS_NODE before spawning the binary.
// Some shells (incl. parts of the Claude Code harness) set this var, which
// forces Electron to run in plain Node mode and breaks `require('electron')`.
const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBin = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const projectRoot = path.resolve(__dirname, '..');
const child = spawn(electronBin, [projectRoot, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('close', (code, signal) => {
  if (code === null) {
    console.error('electron exited with signal', signal);
    process.exit(1);
  }
  process.exit(code);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { if (!child.killed) child.kill(sig); });
}
