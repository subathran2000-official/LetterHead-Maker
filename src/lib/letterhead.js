// Renders a template to a self-contained US Letter or A4 HTML page.
// Shared by the live preview (renderer) and the PDF exporter (main process).
(function (root) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = (s) => esc(s).replace(/\n/g, '<br>');

  const color = (c, d) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : d);
  const FONTS = ['Georgia, serif', "'Times New Roman', serif", "'Segoe UI', Arial, sans-serif", "'Trebuchet MS', sans-serif"];
  // Any installed font is allowed; only plain font-family text is accepted so it can't break out of the CSS
  const FONT_OK = /^[\p{L}\p{N}\s,'"().\-_]{1,200}$/u;
  const imgSrc = (s) => (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s || '') ? s : '');
  // Paper sizes: CSS mm for the page, px at 96 dpi for the preview, pt for the PDF
  const PAGE_SIZES = {
    letter: { label: 'US Letter (8.5 × 11 in)', css: '8.5in 11in', mmW: 215.9, mmH: 279.4, pxW: 816, pxH: 1056, ptW: 612, ptH: 792 },
    a4: { label: 'A4 (210 × 297 mm)', css: 'A4', mmW: 210, mmH: 297, pxW: 794, pxH: 1123, ptW: 595.28, ptH: 841.89 },
  };
  const sizeOf = (t) => PAGE_SIZES[Object.prototype.hasOwnProperty.call(PAGE_SIZES, t && t.pageSize) ? t.pageSize : 'letter'];
  const SLATE = '#475569'; // secondary text: dark enough to stay readable on a printed page

  // Text colour that stays readable on top of a given background colour
  const lum = (hex) => {
    let h = String(hex).replace('#', '');
    if (h.length < 6) h = h.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const onColor = (hex) => (lum(hex) > 0.4 ? '#0B1B3A' : '#FFFFFF');

  function contactBits(t) {
    return [t.address, t.phone, t.email, t.website].filter(Boolean).map(esc);
  }

  // Shared building blocks for the layouts
  const logoOf = (t) => (t.logo ? `<img class="logo" src="${t.logo}">` : '');
  // Light backing for a logo that sits on a coloured panel, so a dark logo never disappears
  const chipOf = (t) => (t.logo ? `<span class="chip">${logoOf(t)}</span>` : '');
  const nameOf = (t) => `<div class="name">${esc(t.company)}</div>${t.tagline ? `<div class="tag">${esc(t.tagline)}</div>` : ''}`;
  const inline = (t, sep = ' &nbsp;|&nbsp; ') => contactBits(t).join(sep);
  const stacked = (t) => contactBits(t).join('<br>');
  const initials = (t) => {
    const w = String(t.company || '').split(/\s+/).filter(Boolean);
    return esc((w.length > 1 ? w[0][0] + w[1][0] : (w[0] || 'LM').slice(0, 2)).toUpperCase());
  };

  // Layouts. "legacy" ones keep their original structure so saved templates look the same.
  // Every other layout supplies header(), optional footer(), optional deco() (absolute
  // decoration drawn only inside space the layout reserves) and css(primary, accent, textOnPrimary).
  const LAYOUTS = {
    classic: { label: 'Classic', legacy: true },
    centered: { label: 'Centered', legacy: true },
    banner: { label: 'Banner', legacy: true },
    sidebar: { label: 'Sidebar', legacy: true },

    'classic-pro': {
      label: 'Classic Professional',
      header: (t) => `<header class="hd"><div class="lft">${logoOf(t)}<div>${nameOf(t)}</div></div><div class="contact">${stacked(t)}</div></header>`,
      css: (p, a) => `.hd { display: flex; align-items: center; justify-content: space-between; gap: 8mm; margin: 14mm 18mm 0; padding-bottom: 5mm; border-bottom: .35mm solid ${p}; }
.lft { display: flex; align-items: center; gap: 5mm; } .hd .contact { border-left: .5mm solid ${a}; padding-left: 5mm; }`,
    },
    minimal: {
      label: 'Modern Minimal',
      header: (t) => `<header class="hd">${logoOf(t)}<div class="name">${esc(t.company)}</div>${t.tagline ? `<div class="tag">${esc(t.tagline)}</div>` : ''}<div class="contact">${inline(t, ' &nbsp;·&nbsp; ')}</div></header>`,
      css: () => `.hd { padding: 20mm 18mm 4mm; } .hd .logo { margin-bottom: 6mm; display: block; }
.hd .name { font-size: 12pt; letter-spacing: 3px; text-transform: uppercase; font-weight: 600; } .hd .tag { font-style: normal; }
.hd .contact { margin-top: 2mm; } .n footer { border: 0; text-align: left; margin: 0; padding-left: 18mm; padding-right: 18mm; }`,
    },
    bold: {
      label: 'Bold Header',
      header: (t) => `<header class="hd"><div class="row"><div>${nameOf(t)}</div>${chipOf(t)}</div><div class="contact">${inline(t)}</div></header>`,
      css: (p, a, ink) => `.hd { background: ${p}; padding: 11mm 18mm 7mm; border-bottom: 2.5mm solid ${a}; }
.hd .row { display: flex; align-items: center; justify-content: space-between; gap: 8mm; }
.hd .name, .hd .tag, .hd .contact { color: ${ink}; } .hd .name { font-size: 22pt; } .hd .tag { font-style: normal; }
.hd .contact { margin-top: 5mm; padding-top: 3mm; border-top: .2mm solid ${ink}; }`,
    },
    elegant: {
      label: 'Elegant Centre',
      header: (t) => `<header class="hd">${logoOf(t)}<div class="name">${esc(t.company)}</div>${t.tagline ? `<div class="tag">${esc(t.tagline)}</div>` : ''}<div class="rule"><i></i><b></b><i></i></div><div class="contact">${inline(t, ' &nbsp;•&nbsp; ')}</div></header>`,
      css: (p, a) => `.hd { text-align: center; padding: 13mm 18mm 0; } .hd .logo { display: block; margin: 0 auto 3mm; }
.hd .name { letter-spacing: 3px; text-transform: uppercase; font-size: 17pt; }
.rule { display: flex; align-items: center; justify-content: center; gap: 3mm; margin: 4mm auto 3mm; width: 90mm; }
.rule i { flex: 1; height: .25mm; background: ${a}; } .rule b { width: 2mm; height: 2mm; background: ${a}; transform: rotate(45deg); }`,
    },
    corporate: {
      label: 'Corporate Blue',
      header: (t) => `<div class="bar"></div><header class="hd">${logoOf(t)}<div>${nameOf(t)}</div></header>`,
      footer: (t) => `<footer class="band"><div class="c">${inline(t)}</div>${t.footer ? `<div class="sub">${lines(t.footer)}</div>` : ''}</footer>`,
      css: (p, a, ink) => `.bar { height: 5mm; background: ${p}; border-bottom: 1.2mm solid ${a}; }
.hd { display: flex; align-items: center; gap: 6mm; padding: 9mm 18mm 4mm; }
.n footer.band { background: ${p}; color: ${ink}; border: 0; margin: 0; padding: 5mm 18mm 8mm; text-align: center; }
footer.band .c { font-size: 9pt; } footer.band .sub { margin-top: 1mm; font-size: 8pt; }`,
    },
    stripe: {
      label: 'Side Stripe',
      pad: 'padding-left: 11mm;',
      deco: () => '<div class="stripe"></div>',
      header: (t) => `<header class="hd">${logoOf(t)}${nameOf(t)}<div class="contact">${inline(t, ' &nbsp;·&nbsp; ')}</div></header>`,
      css: (p, a) => `.stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 11mm; background: ${p}; border-right: 1.5mm solid ${a}; }
.hd { margin: 0 18mm; padding: 14mm 0 4mm; } .hd .logo { display: block; margin-bottom: 4mm; } .hd .contact { margin-top: 3mm; } .pno { left: 14mm; }`,
    },
    corner: {
      label: 'Corner Accent',
      deco: () => '<div class="c1"></div><div class="c2"></div>',
      header: (t) => `<header class="hd"><div class="top">${logoOf(t)}<div>${nameOf(t)}</div></div><div class="contact">${inline(t)}</div></header>`,
      css: (p, a) => `.c1 { position: absolute; top: -42mm; right: -42mm; width: 84mm; height: 84mm; border-radius: 50%; background: ${a}; }
.c2 { position: absolute; top: -28mm; right: -28mm; width: 56mm; height: 56mm; border-radius: 50%; background: ${p}; }
.hd { padding: 14mm 18mm 5mm; } .hd .top { display: flex; align-items: center; gap: 6mm; padding-right: 36mm; min-height: 24mm; }
.hd .contact { margin-top: 4mm; padding-top: 3mm; border-top: .3mm solid ${a}; }`,
    },
    double: {
      label: 'Double Line',
      header: (t) => `<header class="hd"><div class="row"><div>${nameOf(t)}</div>${logoOf(t)}</div><div class="contact">${inline(t)}</div></header><div class="dl"><i></i><b></b></div>`,
      css: (p, a) => `.hd { padding: 14mm 18mm 4mm; } .hd .row { display: flex; align-items: center; justify-content: space-between; gap: 8mm; } .hd .contact { margin-top: 3mm; }
.dl { margin: 0 18mm; } .dl i { display: block; height: .7mm; background: ${p}; } .dl b { display: block; height: .25mm; background: ${a}; margin-top: 1mm; }`,
    },
    monogram: {
      label: 'Monogram',
      header: (t) => `<header class="hd"><div class="row"><div class="mono">${initials(t)}</div><div class="grow">${nameOf(t)}</div>${logoOf(t)}</div><div class="contact">${inline(t)}</div></header>`,
      css: (p, a, ink) => `.hd { padding: 13mm 18mm 5mm; } .hd .row { display: flex; align-items: center; gap: 6mm; } .grow { flex: 1; }
.mono { width: 24mm; height: 24mm; background: ${p}; color: ${ink}; font-size: 26pt; font-weight: 700; display: flex; align-items: center; justify-content: center; border-bottom: 1.5mm solid ${a}; letter-spacing: 1px; }
.hd .contact { margin-top: 5mm; padding-top: 3mm; border-top: .3mm solid ${a}; }`,
    },
    cleanfooter: {
      label: 'Clean Footer',
      header: (t) => `<header class="hd">${logoOf(t)}<div>${nameOf(t)}</div></header>`,
      footer: (t) => `<footer class="cf"><div class="contact">${inline(t)}</div>${t.footer ? `<div class="sub">${lines(t.footer)}</div>` : ''}</footer>`,
      css: (p, a) => `.hd { display: flex; align-items: center; gap: 6mm; padding: 14mm 18mm 4mm; }
.n footer.cf { border-top: .6mm solid ${a}; } footer.cf .contact { color: ${p}; font-size: 9pt; } footer.cf .sub { margin-top: 1mm; }`,
    },
    executive: {
      label: 'Executive',
      header: (t) => `<header class="hd">${logoOf(t)}<div class="name">${esc(t.company)}</div>${t.tagline ? `<div class="tag">${esc(t.tagline)}</div>` : ''}<div class="short"></div><div class="contact">${inline(t, ' &nbsp;·&nbsp; ')}</div></header>`,
      css: (p, a) => `.hd { padding: 15mm 18mm 4mm; } .hd .logo { display: block; margin-bottom: 4mm; max-height: 18mm; }
.hd .name { font-family: Georgia, 'Times New Roman', serif; text-transform: uppercase; letter-spacing: 4px; font-size: 18pt; font-weight: 600; }
.hd .tag { font-family: Georgia, serif; } .short { width: 24mm; height: .5mm; background: ${a}; margin: 4mm 0 3mm; }
.hd .contact { font-style: italic; } .n footer { font-family: Georgia, serif; font-style: italic; }`,
    },
    wave: {
      label: 'Creative Wave',
      deco: (t, p, a) => `<svg class="wave" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="M0 0H100V11C85 19 68 5 50 11S16 19 0 10Z" fill="${a}"/><path d="M0 0H100V6C82 13 62 0 42 6S12 12 0 5Z" fill="${p}"/></svg>`,
      header: (t) => `<header class="hd"><div class="lft">${logoOf(t)}<div>${nameOf(t)}</div></div><div class="contact">${stacked(t)}</div></header>`,
      css: () => `.wave { position: absolute; left: 0; top: 0; width: 100%; height: 22mm; display: block; }
.hd { display: flex; align-items: center; justify-content: space-between; gap: 8mm; padding: 28mm 18mm 4mm; }
.lft { display: flex; align-items: center; gap: 5mm; } .hd .contact { text-align: right; }`,
    },
    block: {
      label: 'Modern Block',
      header: (t) => `<header class="hd"><div class="row"><div class="lft">${chipOf(t)}<div>${nameOf(t)}</div></div><div class="contact">${stacked(t)}</div></div></header>`,
      css: (p, a, ink) => `.hd { margin: 12mm 18mm 0; background: ${p}; border-left: 3mm solid ${a}; padding: 7mm 8mm; } .hd .row { display: flex; align-items: center; justify-content: space-between; gap: 8mm; }
.lft { display: flex; align-items: center; gap: 5mm; } .hd .name, .hd .tag, .hd .contact { color: ${ink}; } .hd .name { font-size: 18pt; } .hd .tag { font-style: normal; }
.hd .contact { text-align: right; }`,
    },
    split: {
      label: 'Split Header',
      header: (t) => `<header class="hd"><div class="l">${logoOf(t)}<div>${nameOf(t)}</div></div><div class="r"><div class="contact">${stacked(t)}</div></div></header>`,
      css: (p, a, ink) => `.hd { display: grid; grid-template-columns: 1.1fr 1fr; align-items: stretch; margin-bottom: 2mm; }
.hd .l { padding: 14mm 8mm 8mm 18mm; display: flex; flex-direction: column; gap: 3mm; justify-content: center; align-items: flex-start; }
.hd .r { background: ${p}; padding: 14mm 18mm 8mm 10mm; display: flex; align-items: center; border-bottom: 2mm solid ${a}; }
.hd .r .contact { color: ${ink}; font-size: 9.5pt; border-left: 1mm solid ${a}; padding-left: 5mm; }`,
    },
    border: {
      label: 'Thin Border',
      pad: 'padding: 10mm;',
      deco: () => '<div class="frame"></div>',
      header: (t) => `<header class="hd">${logoOf(t)}<div class="name">${esc(t.company)}</div>${t.tagline ? `<div class="tag">${esc(t.tagline)}</div>` : ''}<div class="contact">${inline(t, ' &nbsp;•&nbsp; ')}</div></header>`,
      css: (p, a) => `.frame { position: absolute; inset: 7mm; border: .5mm solid ${p}; outline: .2mm solid ${a}; outline-offset: -1.6mm; pointer-events: none; }
.hd { text-align: center; padding: 8mm 10mm 4mm; border-bottom: .25mm solid ${a}; margin: 0 8mm; } .hd .logo { display: block; margin: 0 auto 3mm; }
.hd .contact { margin-top: 2mm; } .n .body { padding: 10mm 14mm; } .n footer { margin: 0 8mm; } .pno { left: 4mm; bottom: 1.5mm; }`,
    },
    gradient: {
      label: 'Gradient Accent',
      header: (t) => `<header class="hd"><div class="lft">${logoOf(t)}<div>${nameOf(t)}</div></div><div class="contact">${stacked(t)}</div></header>`,
      css: (p, a) => `.hd { display: flex; align-items: center; justify-content: space-between; gap: 8mm; padding: 13mm 18mm 7mm;
  background: linear-gradient(100deg, color-mix(in srgb, ${p} 10%, #fff), color-mix(in srgb, ${a} 24%, #fff)); border-bottom: 2mm solid; border-image: linear-gradient(90deg, ${p}, ${a}) 1; }
.lft { display: flex; align-items: center; gap: 5mm; } .hd .contact { text-align: right; color: #1E293B; }
.n footer { border-top: 1.2mm solid; border-image: linear-gradient(90deg, ${a}, ${p}) 1; }`,
    },
    diagonal: {
      label: 'Diagonal Edge',
      deco: () => '<div class="d1"></div><div class="d2"></div>',
      header: (t) => `<header class="hd">${logoOf(t)}${nameOf(t)}<div class="contact">${stacked(t)}</div></header>`,
      css: (p, a) => `.d1 { position: absolute; left: 0; top: 0; width: 88mm; height: 46mm; background: ${a}; clip-path: polygon(0 0, 100% 0, 0 100%); }
.d2 { position: absolute; left: 0; top: 0; width: 70mm; height: 36mm; background: ${p}; clip-path: polygon(0 0, 100% 0, 0 100%); }
.hd { padding: 13mm 18mm 5mm 92mm; text-align: right; } .hd .logo { margin-left: auto; display: block; margin-bottom: 3mm; }
.hd .contact { margin-top: 3mm; }`,
    },
    watermark: {
      label: 'Watermark',
      deco: (t) => `<div class="wmk">${t.logo ? `<img src="${t.logo}">` : `<span>${initials(t)}</span>`}</div>`,
      header: (t) => `<header class="hd"><div class="name">${esc(t.company)}</div>${t.tagline ? `<div class="tag">${esc(t.tagline)}</div>` : ''}<div class="contact">${inline(t)}</div></header>`,
      css: (p) => `.wmk { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.wmk img { width: 120mm; opacity: .08; } .wmk span { font-size: 190pt; font-weight: 700; color: ${p}; opacity: .07; }
.hd { text-align: center; padding: 15mm 18mm 5mm; margin: 0 18mm; border-bottom: .35mm solid ${p}; } .hd .name { font-size: 22pt; }
.hd .contact { margin-top: 2mm; } .body, footer { position: relative; }`,
    },
    sigline: {
      label: 'Signature Line',
      header: (t) => `<header class="hd">${logoOf(t)}<div class="r">${nameOf(t)}</div></header>`,
      footer: (t) => `<footer class="sf"><div class="decor"><i></i><b></b></div><div class="contact">${inline(t)}</div>${t.footer ? `<div class="sub">${lines(t.footer)}</div>` : ''}</footer>`,
      css: (p, a) => `.hd { display: flex; align-items: center; justify-content: space-between; gap: 8mm; padding: 14mm 18mm 4mm; } .hd .r { text-align: right; } .hd .name { font-size: 16pt; }
.n footer.sf { border: 0; padding-top: 0; } .sf .decor { display: flex; align-items: center; gap: 2mm; margin-bottom: 3mm; }
.sf .decor i { flex: 1; height: .4mm; background: linear-gradient(90deg, transparent, ${p}); } .sf .decor b { width: 3mm; height: 3mm; border-radius: 50%; background: ${a}; }
.sf .contact { color: ${p}; } .sf .sub { margin-top: 1mm; }`,
    },
    card: {
      label: 'Business Card Style',
      header: (t) => `<header class="hd"><div class="card">${logoOf(t)}<div><div class="name">${esc(t.company)}</div>${t.tagline ? `<div class="tag">${esc(t.tagline)}</div>` : ''}<div class="contact">${stacked(t)}</div></div></div></header>`,
      css: (p, a) => `.hd { padding: 14mm 18mm 4mm; } .card { display: flex; align-items: center; gap: 5mm; width: 120mm; background: #F2F6FA; border: .3mm solid #CBD5E1; border-left: 3mm solid ${a}; padding: 5mm 6mm; }
.card .logo { max-height: 15mm; max-width: 30mm; } .card .name { font-size: 13pt; } .card .tag { font-size: 8.5pt; } .card .contact { font-size: 8.5pt; margin-top: 1.5mm; }`,
    },
  };

  const LAYOUT_LIST = Object.keys(LAYOUTS).map((id) => ({ id, label: LAYOUTS[id].label, legacy: !!LAYOUTS[id].legacy }));

  function legacyHeader(t) {
    const logo = t.layout === 'banner' || t.layout === 'sidebar' ? chipOf(t) : logoOf(t);
    const name = nameOf(t);
    const contact = contactBits(t);
    switch (t.layout) {
      case 'centered':
        return `<header class="h-centered">${logo}${name}<div class="contact">${contact.join(' &nbsp;•&nbsp; ')}</div></header>`;
      case 'sidebar':
        return `<aside class="side">${logo}${name}<div class="contact">${contact.join('<br>')}</div></aside>`;
      case 'banner':
        return `<header class="h-banner">${logo}<div>${name}</div><div class="contact">${contact.join('<br>')}</div></header>`;
      default:
        return `<header class="h-classic">${logo}<div class="grow">${name}</div><div class="contact">${contact.join('<br>')}</div></header>`;
    }
  }

  // Body text is split into pages wherever the user types a line containing only [page]
  const PAGE_BREAK = /^\s*\[page\]\s*$/im;
  function pages(t) {
    return String(t.body || '').split(PAGE_BREAK);
  }

  function signature(t) {
    if (!t.showSignature) return '';
    return `<div class="sig">${t.signClosing ? `<div>${esc(t.signClosing)}</div>` : ''}
${t.signatureImg ? `<img src="${t.signatureImg}">` : '<div style="height:14mm"></div>'}
<div class="sname">${esc(t.signName)}</div><div class="stitle">${esc(t.signTitle)}</div></div>`;
  }

  // opts.first / opts.last override "is this the first / last page" so the page-fitting code
  // can measure a single page of text on its own
  function render(t, opts = {}) {
    const all = pages(t);
    const pageIndex = Math.min(opts.page || 0, all.length - 1);
    const isLast = opts.last ?? pageIndex === all.length - 1;
    const isFirst = opts.first ?? pageIndex === 0;
    const pg = sizeOf(t);
    t = { ...t, logo: imgSrc(t.logo), signatureImg: imgSrc(t.signatureImg) };
    const p = color(t.primary, '#06265E');
    const a = color(t.accent, '#00B8A5');
    const ink = onColor(p);
    const tagInk = `color-mix(in srgb, ${a} 55%, #000)`;
    const zoom = Number(opts.zoom) || 1;
    const font = FONT_OK.test(String(t.font || '')) ? t.font : FONTS[0];
    // Unknown layout names fall back to Classic, as before
    const layoutId = Object.prototype.hasOwnProperty.call(LAYOUTS, t.layout) ? t.layout : 'classic';
    t.layout = layoutId;
    const L = LAYOUTS[layoutId];
    const sidebar = layoutId === 'sidebar';
    const pagePad = sidebar ? 'padding-left: 62mm;' : L.pad || '';
    const headerHtml = L.legacy ? legacyHeader(t) : L.header(t);
    const footerHtml = L.footer ? L.footer(t) : `<footer>${lines(t.footer)}</footer>`;
    const deco = L.deco ? L.deco(t, p, a) : '';
    return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${pg.css}; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${pg.mmW}mm; height: ${pg.mmH}mm; overflow: hidden; background: #fff; }
body { zoom: ${zoom}; font-family: ${font}; color: #1F2937; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: ${pg.mmW}mm; height: ${pg.mmH}mm; display: flex; flex-direction: column; ${pagePad} }
.page.n { overflow: hidden; }
.logo { max-height: 22mm; max-width: 45mm; object-fit: contain; }
.chip { background: #fff; border-radius: 2mm; padding: 2.5mm 3mm; display: inline-flex; align-items: center; }
.name { font-size: 20pt; font-weight: 700; color: ${p}; letter-spacing: .5px; }
.tag { font-size: 10pt; color: ${tagInk}; font-style: italic; margin-top: 1mm; }
.contact { font-size: 9pt; color: #334155; line-height: 1.5; }
.h-classic { display: flex; align-items: center; gap: 6mm; padding: 14mm 18mm 6mm; border-bottom: 2.5px solid ${a}; margin: 0 18mm; padding-left: 0; padding-right: 0; }
.h-classic .grow { flex: 1; } .h-classic .contact { text-align: right; }
.h-centered { text-align: center; padding: 12mm 18mm 5mm; border-bottom: 1px solid ${a}; margin: 0 18mm; }
.h-centered .logo { display: block; margin: 0 auto 3mm; }
.h-centered .contact { margin-top: 3mm; }
.h-banner { display: flex; align-items: center; gap: 6mm; padding: 9mm 18mm; background: ${p}; }
.h-banner .name, .h-banner .tag, .h-banner .contact { color: ${ink}; } .h-banner .tag { font-style: normal; } .h-banner .contact { margin-left: auto; text-align: right; }
.side { position: absolute; left: 0; top: 0; bottom: 0; width: 52mm; background: ${p}; color: ${ink}; padding: 16mm 7mm; border-right: 3px solid ${a}; }
.side .chip { display: flex; width: fit-content; margin-bottom: 6mm; } .side .logo { max-width: 34mm; }
.side .name, .side .tag, .side .contact { color: ${ink}; } .side .name { font-size: 15pt; } .side .tag { font-style: normal; }
.side .contact { margin-top: 10mm; }
.body { flex: 1; padding: 12mm 18mm; font-size: ${Math.min(16, Math.max(8, Number(t.fontSize) || 10.5))}pt; line-height: 1.6; text-align: ${['left', 'justify', 'center'].includes(t.align) ? t.align : 'left'}; overflow: hidden; }
.sig { margin-top: 10mm; text-align: left; } .sig img { max-height: 18mm; max-width: 60mm; margin: 2mm 0; display: block; }
.sname { font-weight: 700; color: ${p}; } .stitle { font-size: .9em; color: #475569; }
.pno { position: absolute; left: 6mm; bottom: 3mm; font-size: 6.5pt; color: #94A3B8; }
.preview-wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 9; }
.preview-wm span { transform: rotate(-35deg); font: 700 46pt sans-serif; color: rgba(200,0,0,.12); }
.ref { display: flex; justify-content: space-between; font-size: 9pt; color: #334155; margin-bottom: 8mm; }
footer { padding: 4mm 18mm 9mm; font-size: 8pt; color: #475569; text-align: center; border-top: 1px solid ${a}; margin: 0 18mm; padding-left: 0; padding-right: 0; }
.wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.wm span { transform: rotate(-35deg); font-size: 70pt; font-weight: 700; color: ${p}; opacity: .06; white-space: nowrap; }
.wm img { width: 110mm; opacity: .05; }
.docid { position: absolute; right: 6mm; bottom: 3mm; font-size: 5.5pt; color: #94A3B8; font-family: monospace; }
${L.legacy ? '' : `.n .body { margin-bottom: 4mm; }\n${L.css(p, a, ink)}`}
</style></head><body><div class="page${L.legacy ? '' : ' n'}">
${deco}
${t.watermark === 'logo' && t.logo ? `<div class="wm"><img src="${t.logo}"></div>` : t.watermark === 'text' && t.watermarkText ? `<div class="wm"><span>${esc(t.watermarkText)}</span></div>` : ''}
${headerHtml}
<div class="body">
${t.showRef && isFirst ? `<div class="ref"><span>Ref: ${esc(t.refNo)}</span><span>${esc(t.date)}</span></div>` : ''}
${lines(all[pageIndex].replace(/^\n+|\n+$/g, ''))}
${isLast ? signature(t) : ''}
</div>
${footerHtml}
${all.length > 1 ? `<div class="pno">Page ${pageIndex + 1} of ${all.length}</div>` : ''}
${opts.docId ? `<div class="docid">Doc ID ${esc(opts.docId)}</div>` : ''}
${opts.preview ? '<div class="preview-wm"><span>PREVIEW</span></div>' : ''}
</div></body></html>`;
  }

  const api = { render, pages, PAGE_SIZES, sizeOf, pageCount: (t) => pages(t).length, LAYOUTS: LAYOUT_LIST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Letterhead = api;
})(this);
