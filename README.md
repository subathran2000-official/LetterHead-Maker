# Letterhead Maker

Desktop app (Electron) to design letterheads and export **locked, image-only PDFs**.

## Run
```
npm install
npm start          # development
npm run dist       # Windows installer in dist/
```

## Features
- PIN lock on launch (4–8 digits), auto-lock after 15 min idle, change PIN
- Templates stored **AES-256-GCM encrypted** (`.blt`) with a random key unique to each install, protected by Windows (DPAPI), so they only open in this app for this Windows user
- Export / import `.blt` to move templates between PCs; exported files are **password protected** (you choose the password; share it separately)
- 4 layouts (Classic, Centered, Banner, Sidebar), brand colours, fonts, logo
- Contact block, tagline, reference/date line, footer, logo/text watermark
- Optional letter body, font size, alignment, multi-page (`[page]` on its own line)
- Signature block (closing, signature image, name, title)
- Live preview (US Letter 8.5 × 11 in) with page navigation; Duplicate; Ctrl+S
- **Locked PDF export**
  - every page is a flattened 288-dpi image — no text layer to edit, copy or convert
  - US Letter 612 × 792 pt
  - AES-256 encryption, random discarded owner password; only printing allowed
  - unique Doc ID stamped on each page
- **Verify PDF**: checks a file's SHA-256 against the issued-documents register
  (any modification → "Not recognised")

## About
Created by AK Vision Systems — https://www.akvisionsystems.com/. The credit and website link appear in the app sidebar and the About box only; they are never added to exported letters.

## Data location
`%APPDATA%/Brooklin Letterhead Studio/` (folder name kept from earlier versions so saved templates still load) — `templates/*.blt`, `issued-documents.json`, `settings.json` (PIN hash).

## Template security
- Saved templates (`BLT2`) are encrypted with a random 256-bit key created on first run and stored in `vault.key`, wrapped by Windows DPAPI. Copying the data folder to another PC or Windows account will **not** open them; use Export / Import with a password.
- Exported templates (`BLT3`) use a key derived from your password (scrypt), at least 6 characters.
- Templates saved by older versions (`BLT1`, built-in key) are upgraded automatically on first start, and old shared `.blt` files can still be imported. After the upgrade, older versions of the app can no longer open the upgraded templates.
- Keep a backup: if the Windows account is deleted or reset, the key cannot be recovered and the saved templates cannot be opened. Export important templates with a password and store them somewhere safe.

## Limits (by nature of PDF)
Anyone can still screenshot or re-print a page, and permission flags can be stripped
by special tools. Image-only pages + Doc IDs + the Verify register make edits hard
and detectable, not impossible.
