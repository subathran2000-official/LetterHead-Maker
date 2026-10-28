// Encrypted template storage (.blt).
//
// File formats (first 4 bytes):
//   BLT1  older versions: AES-256-GCM with a key built into the app. Still readable, and
//         upgraded to BLT2 the first time the app starts.
//   BLT2  templates stored on this PC: AES-256-GCM with a random key that is unique to this
//         install and protected by Windows (see keyStore in main.js).
//   BLT3  templates shared between PCs: AES-256-GCM with a key derived from a password the
//         person chooses when exporting (scrypt), so the file is useless without it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const M1 = Buffer.from('BLT1');
const M2 = Buffer.from('BLT2');
const M3 = Buffer.from('BLT3');

// Only used to read BLT1 files written by earlier versions. Never used to write.
const LEGACY_SECRET = 'brooklinpub::letterhead-studio::2026::c7f1e94a6b2d';
const LEGACY_KEY = crypto.scryptSync(LEGACY_SECRET, 'brooklinpub-blt-salt', 32);

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const passwordKey = (password, salt) => crypto.scryptSync(String(password), salt, 32, SCRYPT);

function seal(magic, key, obj, salt) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([magic, salt || Buffer.alloc(0), iv, cipher.getAuthTag(), data]);
}

function open(buf, key, offset) {
  const iv = buf.subarray(offset, offset + 12);
  const tag = buf.subarray(offset + 12, offset + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(buf.subarray(offset + 28)), decipher.final()]);
  return JSON.parse(out.toString('utf8'));
}

const kind = (buf) => {
  const m = buf.subarray(0, 4);
  if (m.equals(M1)) return 'legacy';
  if (m.equals(M2)) return 'local';
  if (m.equals(M3)) return 'shared';
  throw new Error('Not a Letterhead Maker template file');
};

// Password-protected copy for moving a template to another PC
function exportShared(template, password) {
  if (String(password || '').length < 6) throw new Error('Choose a password of at least 6 characters');
  const salt = crypto.randomBytes(16);
  return seal(M3, passwordKey(password, salt), template, salt);
}

// Reads a file received from someone else. Returns { template } or { needsPassword: true }.
function importShared(buf, password) {
  const k = kind(buf);
  if (k === 'legacy') return { template: open(buf, LEGACY_KEY, 4), legacy: true };
  if (k === 'local') throw new Error('This file was saved on another PC and cannot be opened here. Ask for a new export with a password.');
  if (!password) return { needsPassword: true };
  try {
    return { template: open(buf, passwordKey(password, buf.subarray(4, 20)), 20) };
  } catch {
    throw new Error('Wrong password, or the file is damaged');
  }
}

// Atomic write: a crash can leave the old file or the new one, never half of one
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

class Vault {
  // keyStore: { protect(Buffer) -> Buffer, unprotect(Buffer) -> Buffer } supplied by the app (Windows DPAPI)
  constructor(dir, keyFile, keyStore) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.key = this.loadKey(keyFile, keyStore);
  }

  loadKey(keyFile, ks) {
    if (fs.existsSync(keyFile)) {
      return ks.unprotect(fs.readFileSync(keyFile));
    }
    const key = crypto.randomBytes(32);
    writeAtomic(keyFile, ks.protect(key));
    return key;
  }

  // BLT2 layout: magic(4) iv(12) tag(16) data
  decryptLocal(buf) {
    if (kind(buf) === 'legacy') return open(buf, LEGACY_KEY, 4);
    if (kind(buf) !== 'local') throw new Error('Unexpected template format');
    return open(buf, this.key, 4);
  }

  // Re-encrypts templates written by older versions with this PC's own key.
  // Each new file is checked by reading it back before it replaces the old one.
  migrate() {
    let moved = 0;
    for (const f of fs.readdirSync(this.dir).filter((n) => n.endsWith('.blt'))) {
      const file = path.join(this.dir, f);
      try {
        const buf = fs.readFileSync(file);
        if (kind(buf) !== 'legacy') continue;
        const t = open(buf, LEGACY_KEY, 4);
        const next = seal(M2, this.key, t);
        if (JSON.stringify(this.decryptLocal(next)) !== JSON.stringify(t)) throw new Error('verify failed');
        writeAtomic(file, next);
        moved++;
      } catch { /* leave the file as it is; it stays readable as a legacy file */ }
    }
    return moved;
  }

  list() {
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.blt'))
      .map((f) => {
        try {
          const t = this.decryptLocal(fs.readFileSync(path.join(this.dir, f)));
          return { id: t.id, name: t.name, updatedAt: t.updatedAt, kind: t.kind };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  load(id) { return this.decryptLocal(fs.readFileSync(this.file(id))); }
  save(t) {
    t.id = t.id || crypto.randomUUID();
    t.updatedAt = new Date().toISOString();
    writeAtomic(this.file(t.id), seal(M2, this.key, t));
    return t;
  }
  has(id) { return fs.existsSync(this.file(id)); }
  remove(id) { fs.rmSync(this.file(id), { force: true }); }
  file(id) { return path.join(this.dir, `${id.replace(/[^\w-]/g, '')}.blt`); }
}

module.exports = { Vault, exportShared, importShared, kind };
