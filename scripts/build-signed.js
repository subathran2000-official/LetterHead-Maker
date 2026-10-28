// Builds the signed Windows installer + portable EXE, then verifies every signature.
// Credentials are read from the environment or from a file OUTSIDE the project:
//   %USERPROFILE%\.akvision\signing.env   (or the path in AKV_SIGNING_ENV)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const envFile = process.env.AKV_SIGNING_ENV || path.join(os.homedir(), '.akvision', 'signing.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
  console.log(`Loaded signing settings from ${envFile}`);
}

const root = path.join(__dirname, '..');
const run = (args) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env }).status;

const cli = require.resolve('electron-builder/cli.js', { paths: [root] });
if (run([cli, '--win', '--config', 'electron-builder.signed.js']) !== 0) {
  console.error('\nBuild failed. No signed build was produced.');
  process.exit(1);
}
process.exit(run([path.join(__dirname, 'verify-signature.js')]));
