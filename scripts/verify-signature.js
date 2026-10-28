// Fails unless every EXE/DLL/node file in the Windows build has a valid, timestamped signature,
// and the application and installers are signed by the expected publisher.
//   node scripts/verify-signature.js [publisher name]    (default: env AKV_SIGN_PUBLISHER, else "AK Vision Systems")
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dist = path.join(__dirname, '..', 'dist');
const publisher = process.argv[2] || process.env.AKV_SIGN_PUBLISHER || 'AK Vision Systems';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const isPe = (f) => /\.(exe|dll|node)$/i.test(f);

if (!fs.existsSync(dist)) { console.error('No dist folder. Build first.'); process.exit(1); }
const top = fs.readdirSync(dist).filter((f) => /\.exe$/i.test(f)).map((f) => path.join(dist, f));
const unpacked = path.join(dist, 'win-unpacked');
const inner = fs.existsSync(unpacked) ? walk(unpacked).filter(isPe) : [];
const files = [...top, ...inner];
if (!top.length) { console.error('No installer or portable EXE found in dist.'); process.exit(1); }

const list = path.join(os.tmpdir(), `akv-verify-${process.pid}.txt`);
fs.writeFileSync(list, files.join('\n'), 'utf8');
const ps = `Get-Content -LiteralPath '${list}' -Encoding UTF8 | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; [pscustomobject]@{ Path = [string]$_; Status = [string]$s.Status; Subject = $s.SignerCertificate.Subject; Thumbprint = $s.SignerCertificate.Thumbprint; Timestamped = ($null -ne $s.TimeStamperCertificate) } } | ConvertTo-Json -Compress`;
const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.rmSync(list, { force: true });
const rows = [].concat(JSON.parse(out));

const problems = [];
for (const r of rows) {
  const name = path.relative(dist, r.Path);
  if (r.Status !== 'Valid') { problems.push(`${name}: ${r.Status}`); continue; }
  if (!r.Timestamped) problems.push(`${name}: signed without a timestamp`);
  const mustBeOurs = top.includes(r.Path) || /Letterhead Maker\.exe$/i.test(r.Path);
  if (mustBeOurs && !String(r.Subject).toLowerCase().includes(publisher.toLowerCase())) problems.push(`${name}: signed by "${r.Subject}", expected "${publisher}"`);
}

const valid = rows.filter((r) => r.Status === 'Valid').length;
console.log(`Checked ${rows.length} files: ${valid} valid, ${rows.length - valid} not valid.`);
for (const r of rows.filter((x) => top.includes(x.Path))) console.log(`  ${path.basename(r.Path)}  ${r.Status}  ${r.Subject || '(no signature)'}  ${r.Thumbprint || ''}`);
if (problems.length) {
  console.error(`\nSIGNATURE CHECK FAILED (${problems.length}):`);
  problems.slice(0, 25).forEach((p) => console.error('  - ' + p));
  if (problems.length > 25) console.error(`  ... and ${problems.length - 25} more`);
  process.exit(1);
}
console.log(`\nAll signatures are valid and the application is signed by "${publisher}".`);
