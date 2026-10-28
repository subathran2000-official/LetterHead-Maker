// Windows build configuration with code signing. Used only by `npm run dist:signed`.
// No secrets live here: the signing identity and credentials come from environment variables
// (see SIGNING.md), normally loaded from a file outside this project folder.
const base = require('./package.json').build;

const need = (names) => {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Code signing is not configured. Missing: ${missing.join(', ')}. See SIGNING.md.`);
};

const publisher = (need(['AKV_SIGN_PUBLISHER']), process.env.AKV_SIGN_PUBLISHER);
const provider = (process.env.AKV_SIGN_PROVIDER || 'azure').toLowerCase();

let signing;
if (provider === 'azure') {
  // Microsoft Artifact Signing (formerly Trusted Signing); credentials come from AZURE_* variables or `az login`
  need(['AKV_SIGN_ENDPOINT', 'AKV_SIGN_ACCOUNT', 'AKV_SIGN_PROFILE']);
  signing = {
    azureSignOptions: {
      publisherName: publisher,
      endpoint: process.env.AKV_SIGN_ENDPOINT,
      codeSigningAccountName: process.env.AKV_SIGN_ACCOUNT,
      certificateProfileName: process.env.AKV_SIGN_PROFILE,
    },
  };
} else if (provider === 'cert') {
  // A certificate from a commercial CA whose private key sits in a hardware token or cloud HSM that
  // exposes it to Windows (certificate store). It is picked by thumbprint, so no key file is needed.
  need(['AKV_SIGN_CERT_SHA1']);
  signing = {
    signtoolOptions: {
      certificateSha1: process.env.AKV_SIGN_CERT_SHA1,
      publisherName: [publisher],
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: process.env.AKV_SIGN_TIMESTAMP_URL || 'http://timestamp.digicert.com',
    },
  };
} else {
  throw new Error(`AKV_SIGN_PROVIDER must be "azure" or "cert" (got "${provider}")`);
}

module.exports = {
  ...base,
  win: {
    ...base.win,
    target: ['nsis', 'portable'], // installer and portable EXE
    forceCodeSigning: true, // the build fails instead of silently producing an unsigned app
    signExts: ['.dll'], // Electron's own DLLs are mostly unsigned; sign them too
    ...signing,
  },
};
