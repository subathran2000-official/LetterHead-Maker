const $ = (s) => document.querySelector(s);
const form = $('#form');

// Fill the layout selector from the renderer's list so the preview and dropdown never disagree
(() => {
  const sel = form.elements.layout;
  const group = (label, items) => {
    const g = document.createElement('optgroup');
    g.label = label;
    for (const l of items) g.append(new Option(l.label, l.id));
    sel.append(g);
  };
  group('Designs', Letterhead.LAYOUTS.filter((l) => !l.legacy));
  group('Original layouts', Letterhead.LAYOUTS.filter((l) => l.legacy));
})();
let current = null;
let dirty = false;
let defaultId = null; // id of the user's default letterhead
let page = 0;

const defaults = (logo) => ({
  name: 'New letterhead',
  layout: 'classic',
  pageSize: 'letter',
  font: 'Georgia, serif',
  primary: '#06265E',
  accent: '#00B8A5',
  logo,
  company: 'Your company',
  tagline: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  showRef: false,
  refNo: '',
  date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  body: '',
  footer: '',
  watermark: 'none',
  watermarkText: 'CONFIDENTIAL',
  fontSize: 10.5,
  align: 'left',
  showSignature: false,
  signClosing: 'Yours sincerely,',
  signatureImg: '',
  signName: '',
  signTitle: '',
});

// Offer every font installed on this PC (Chromium's local font access)
let fontsLoaded = false;
async function loadSystemFonts() {
  if (fontsLoaded || !window.queryLocalFonts) return;
  try {
    const fams = [...new Set((await window.queryLocalFonts()).map((f) => f.family))].filter((n) => !/['\\\\;{}<>]/.test(n)).sort((x, y) => x.localeCompare(y));
    const sel = form.elements.font;
    const g = document.createElement('optgroup');
    g.label = 'All fonts on this PC';
    for (const n of fams) g.append(new Option(n, `'${n}', sans-serif`));
    sel.append(g);
    if (current) sel.value = current.font;
    fontsLoaded = true;
  } catch { /* permission denied: keep the built-in list */ }
}

// The browser only lets a page read the font list during a click, so load it on the first one
document.addEventListener('pointerdown', loadSystemFonts);

function fillForm(t) {
  const fsel = form.elements.font;
  if (t.font && ![...fsel.options].some((o) => o.value === t.font)) fsel.append(new Option(t.font.split(',')[0].replace(/['"]/g, ''), t.font));
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = !!t[el.name];
    else el.value = t[el.name] ?? '';
  }
  setLogoUi(t.logo || '');
  $('#sigPreview').src = t.signatureImg || '';
}

// Logo box: thumbnail, "Upload"/"Replace" wording and Remove only when there is a logo
function setLogoUi(src) {
  $('#logoPreview').src = src;
  $('#logoDrop').classList.toggle('has', !!src);
  $('#btnLogo').textContent = src ? 'Replace logo' : 'Upload logo';
  $('#btnLogo').classList.toggle('primary', !src);
  $('#btnNoLogo').disabled = !src;
}

function readForm() {
  for (const el of form.elements) {
    if (!el.name) continue;
    current[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return current;
}

// ---- Automatic page breaks ----
// Text that does not fit on a page continues on the next one, so nothing is cut off.
// The saved template is never changed: the extra breaks only exist for preview and export.
const fitFrame = document.createElement('iframe');
fitFrame.setAttribute('sandbox', 'allow-same-origin');
fitFrame.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;visibility:hidden';
document.body.append(fitFrame);

function fitsOnPage(t, text, flags) {
  return new Promise((resolve) => {
    fitFrame.onload = () => {
      const b = fitFrame.contentDocument.querySelector('.body');
      resolve(b.scrollHeight <= b.clientHeight + 1);
    };
    fitFrame.srcdoc = Letterhead.render({ ...t, body: text }, { page: 0, ...flags });
  });
}

// Returns the body text split into pages (the user's own [page] breaks are kept), or null if stale
async function paginate(t, isStale) {
  const chunks = Letterhead.pages(t);
  const sz = Letterhead.sizeOf(t);
  fitFrame.style.width = `${sz.pxW}px`;
  fitFrame.style.height = `${sz.pxH}px`;
  const out = [];
  let first = true;
  for (let c = 0; c < chunks.length; c++) {
    let rest = chunks[c].replace(/^\n+|\n+$/g, '');
    const lastChunk = c === chunks.length - 1;
    for (let guard = 0; guard < 60; guard++) {
      if (isStale()) return null;
      if (await fitsOnPage(t, rest, { first, last: lastChunk })) { out.push(rest); first = false; break; }
      const toks = rest.split(/(\s+)/);
      // largest number of tokens that fits on a page without the signature
      let lo = 0;
      let hi = toks.length;
      while (lo < hi) {
        if (isStale()) return null;
        const mid = (lo + hi + 1) >> 1;
        if (await fitsOnPage(t, toks.slice(0, mid).join('').trimEnd(), { first, last: false })) lo = mid; else hi = mid - 1;
      }
      let cut = lo;
      if (cut >= toks.length) {
        // The text fits but the signature does not: carry the last paragraph over so they stay together
        const idx = rest.lastIndexOf('\n\n');
        cut = idx > 0 ? rest.slice(0, idx).split(/(\s+)/).length : Math.max(1, toks.length - 60);
      }
      cut = Math.max(1, cut);
      out.push(toks.slice(0, cut).join('').trimEnd());
      rest = toks.slice(cut).join('').replace(/^\s+/, '');
      first = false;
      if (!rest) break;
    }
  }
  return out;
}

const fitKey = (t) => JSON.stringify({ ...t, logo: (t.logo || '').length + (t.logo || '').slice(-24), signatureImg: (t.signatureImg || '').length + (t.signatureImg || '').slice(-24) });
let fitted = null; // { key, t }
let fitSeq = 0;
let fitTimer;

// The template as it will be printed: with automatic page breaks once they are worked out
const printable = () => (fitted && fitted.key === fitKey(current) ? fitted.t : current);

async function fitNow(t, isStale = () => false) {
  const pagesOut = await paginate(t, isStale);
  return pagesOut && { ...t, body: pagesOut.join('\n[page]\n') };
}

function scheduleFit() {
  if (fitted && fitted.key === fitKey(current)) return;
  clearTimeout(fitTimer);
  fitTimer = setTimeout(async () => {
    const seq = ++fitSeq;
    const snap = { ...current };
    const key = fitKey(snap);
    const t = await fitNow(snap, () => seq !== fitSeq || key !== fitKey(current));
    if (!t) return;
    fitted = { key, t };
    renderPreview();
    const extra = Letterhead.pageCount(t) - Letterhead.pageCount(snap);
    if (extra > 0) status(`Long letter: continues automatically onto ${extra} extra page${extra > 1 ? 's' : ''}`);
  }, 250);
}

function renderPreview() {
  const t = printable();
  const count = Letterhead.pageCount(t);
  page = Math.min(page, count - 1);
  $('#pgInfo').textContent = `Page ${page + 1} of ${count}`;
  $('#paper').srcdoc = Letterhead.render(t, { page, preview: true });
  applyZoom();
  scheduleFit();
}

// Preview zoom: null = fit whole page in the panel
let zoom = null;
function applyZoom() {
  const wrap = $('.paperWrap');
  const sz = Letterhead.sizeOf(printable());
  const fit = Math.min((wrap.clientWidth - 48) / sz.pxW, (wrap.clientHeight - 48) / sz.pxH);
  const scale = zoom ?? Math.max(0.2, fit);
  $('#paper').style.transform = `scale(${scale})`;
  $('#paper').style.width = `${sz.pxW}px`;
  $('#paper').style.height = `${sz.pxH}px`;
  $('#paperBox').style.width = `${sz.pxW * scale}px`;
  $('#paperBox').style.height = `${sz.pxH * scale}px`;
  $('#pgSize').textContent = `${sz.label} · image-only PDF`;
  $('#zInfo').textContent = `${Math.round(scale * 100)}%`;
}
$('#zFit').onclick = () => { zoom = null; applyZoom(); };
$('#zIn').onclick = () => { zoom = Math.min(2, (zoom ?? parseInt($('#zInfo').textContent) / 100) + 0.1); applyZoom(); };
$('#zOut').onclick = () => { zoom = Math.max(0.2, (zoom ?? parseInt($('#zInfo').textContent) / 100) - 0.1); applyZoom(); };

// Warn when text runs past the bottom of the page (it would be cut off in the PDF)
$('#paper').addEventListener('load', () => {
  const body = $('#paper').contentDocument?.querySelector('.body');
  if (body && fitted && fitted.key === fitKey(current) && body.scrollHeight > body.clientHeight + 1) {
    status(`⚠ Page ${page + 1} has content that cannot be split any further`);
  }
});

const status = (msg) => { $('#status').textContent = msg; updateDefaultUi(); };

// The "save as default" button and the first-time setup banner follow the current state
function updateDefaultUi() {
  const isDefault = !!current && !!current.id && current.id === defaultId && current.kind !== 'letter';
  $('#btnDefault').textContent = isDefault && !dirty ? '★ Your default letterhead' : '★ Save as my default letterhead';
  $('#btnDefault').disabled = isDefault && !dirty;
  $('#setupBar').hidden = !!defaultId;
}
const markDirty = () => { dirty = true; status('Unsaved changes'); };

async function refreshList() {
  const list = await window.api.listTemplates();
  const ul = $('#templateList');
  ul.innerHTML = '';
  for (const t of list) {
    const li = document.createElement('li');
    li.textContent = (t.id === defaultId ? '★ ' : '') + (t.name || 'Untitled');
    const small = document.createElement('small');
    small.textContent = (t.kind === 'letter' ? 'Letter · ' : t.id === defaultId ? 'Default letterhead · ' : '') + new Date(t.updatedAt).toLocaleString();
    li.appendChild(small);
    if (current && t.id === current.id) li.className = 'active';
    li.onclick = () => open(t.id);
    ul.appendChild(li);
  }
  return list;
}

async function confirmDiscard() {
  return !dirty || confirm('Discard unsaved changes?');
}

async function open(id) {
  if (!(await confirmDiscard())) return;
  current = { ...defaults(''), ...(await window.api.loadTemplate(id)) };
  page = 0;
  fillForm(current); renderPreview();
  dirty = false; status('Loaded');
  refreshList();
}

// ---- Design gallery ----
const SAMPLE_COMPANY = { company: 'Your Company', tagline: 'Your tagline here', address: '123 Main Street, Your City', phone: '+1 555 010 0100', email: 'hello@yourcompany.com', website: 'www.yourcompany.com' };
const SAMPLE_BODY = 'Dear Sir or Madam,\n\nThis is how your letters will look. Your company details, logo, colours and font appear in the header, and your text goes here.\n\nYours faithfully,';

// Draws a scaled-down page into a gallery frame
function paperThumb(frame, t, width) {
  const sz = Letterhead.sizeOf(t);
  const scale = width / sz.pxW;
  frame.style.width = `${sz.pxW}px`;
  frame.style.height = `${sz.pxH}px`;
  frame.style.transform = `scale(${scale})`;
  frame.parentElement.style.width = `${width}px`;
  frame.parentElement.style.height = `${sz.pxH * scale}px`;
  frame.srcdoc = Letterhead.render(t, { page: 0 });
}

// Shows every design as a picture, using the details in `base`. Nothing is changed here:
// resolves to { layout, action } when the user presses one of the action buttons, or null on cancel.
function openGallery({ title, sub, base, selected, required, disableSame, actions }) {
  return new Promise((resolve) => {
    const gal = $('#gallery');
    let sel = selected || base.layout;
    $('#galTitle').textContent = title;
    $('#galSub').textContent = sub;
    $('#galCancel').hidden = !!required;
    const grid = $('#galGrid');
    grid.innerHTML = '';
    const bare = { ...base, body: '', showRef: false, showSignature: false, watermark: 'none' };
    const cards = new Map();
    const acts = $('#galActions');
    acts.innerHTML = '';
    const buttons = actions.map((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.onclick = () => finish({ layout: sel, action: a.id });
      acts.append(b);
      return b;
    });
    const choose = (id) => {
      sel = id;
      cards.forEach((c, k) => c.classList.toggle('sel', k === id));
      $('#galName').textContent = Letterhead.LAYOUTS.find((l) => l.id === id).label;
      paperThumb($('#galPreview'), { ...base, layout: id }, 330);
      buttons.forEach((b) => { b.disabled = !!disableSame && id === base.layout; });
    };
    for (const l of Letterhead.LAYOUTS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'galCard';
      const box = document.createElement('div');
      box.className = 'galThumb';
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.tabIndex = -1;
      box.append(frame);
      const label = document.createElement('span');
      label.textContent = l.label;
      card.append(box, label);
      card.onclick = () => choose(l.id);
      grid.append(card);
      cards.set(l.id, card);
      paperThumb(frame, { ...bare, layout: l.id }, 146);
    }
    const onKey = (e) => { if (e.key === 'Escape' && !required) { e.preventDefault(); finish(null); } };
    function finish(result) {
      gal.hidden = true;
      document.removeEventListener('keydown', onKey);
      $('#galCancel').onclick = null;
      resolve(result);
    }
    document.addEventListener('keydown', onKey);
    $('#galCancel').onclick = () => finish(null);
    gal.hidden = false;
    choose(sel);
    cards.get(sel)?.scrollIntoView({ block: 'nearest' });
  });
}

// First launch (or "New template"): pick a design, then fill in the company details in the editor
async function startSetup(required) {
  if (!(await confirmDiscard())) return;
  const pick = await openGallery({
    title: required ? 'Welcome to Letterhead Maker: choose your design' : 'Choose a design',
    sub: 'Pick a style, then enter your company details, logo, colours and font. You can change the design later.',
    base: { ...defaults(''), ...SAMPLE_COMPANY, layout: 'classic-pro', body: SAMPLE_BODY },
    required,
    actions: [{ id: 'use', label: 'Use this design', primary: true }],
  });
  if (!pick) {
    const list = await refreshList();
    if (list.length && !current) open(list[0].id);
    return;
  }
  current = { ...defaults(''), layout: pick.layout, name: 'My letterhead' };
  page = 0;
  fillForm(current); renderPreview();
  markDirty(); refreshList();
}
const newTemplate = () => startSetup(false);

// Makes the current letterhead the one that opens on every launch
async function saveAsDefault() {
  readForm();
  let target = current;
  if (current.kind === 'letter') {
    if (!confirm('Save this letter\'s design and company details as a new default letterhead? The letter text is not included.')) return;
    target = { ...current, id: undefined, kind: undefined, baseId: undefined, body: '', showRef: false, refNo: '', name: `${current.company || 'My'} letterhead` };
  }
  const saved = await window.api.saveTemplate(target);
  await window.api.setDefault(saved.id);
  defaultId = saved.id;
  if (target === current) { current = saved; dirty = false; }
  status('Saved as your default letterhead');
  refreshList();
}

// A new letter starts from the default letterhead; it is a separate document, so nothing is overwritten
async function newLetter() {
  if (!defaultId) { await boot(); return; }
  if (!(await confirmDiscard())) return;
  let base;
  try { base = await window.api.loadTemplate(defaultId); } catch { defaultId = null; await boot(); return; }
  const fresh = defaults('');
  current = {
    ...fresh, ...base, id: undefined, updatedAt: undefined, kind: 'letter', baseId: defaultId,
    name: `Letter – ${fresh.date}, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, body: '', refNo: '', date: fresh.date,
  };
  page = 0;
  fillForm(current); renderPreview();
  dirty = false; status('New letter: save it to keep it alongside your other letters');
  refreshList();
}

// Preview other designs with the user's own details; only an explicit Apply button changes anything
async function changeDesign() {
  readForm();
  const pick = await openGallery({
    title: 'Change design',
    sub: 'Previews use your company details and logo. Nothing changes until you apply a design.',
    base: current, selected: current.layout, disableSame: true,
    actions: [{ id: 'apply', label: current.kind === 'letter' ? 'Apply to this letter' : 'Apply design' }, { id: 'default', label: 'Apply & make my default', primary: true }],
  });
  if (!pick) return;
  current.layout = pick.layout;
  form.elements.layout.value = pick.layout;
  renderPreview(); markDirty();
  if (pick.action !== 'default') return;
  if (current.kind === 'letter' && defaultId) {
    // keep this letter as it is and move the default letterhead to the new design
    const base = await window.api.loadTemplate(defaultId);
    base.layout = pick.layout;
    await window.api.saveTemplate(base);
    status('Design applied; your default letterhead now uses it too');
    refreshList();
  } else {
    await saveAsDefault();
  }
}

// Decides what to show after unlocking: the default letterhead, a chooser, or first-time setup
async function boot() {
  const list = await refreshList();
  defaultId = await window.api.getDefault();
  if (defaultId && list.some((t) => t.id === defaultId)) { refreshList(); open(defaultId); return; }
  defaultId = null;
  if (!list.length) { await startSetup(true); return; }
  chooseDefault(list);
}

// Existing users without a default pick one of their saved templates
function chooseDefault(list) {
  const dlg = $('#modal');
  let chosen = false;
  showModal(`<h3>Choose your default letterhead</h3>
<p>Pick the saved template that opens every time you start the app and is used for new letters. Your other templates and documents are kept.</p>
<ul class="pickList">${list.map((t) => `<li data-id="${esc(t.id)}">${esc(t.name || 'Untitled')}<small>${esc(new Date(t.updatedAt).toLocaleString())}</small></li>`).join('')}</ul>
<p><button type="button" id="pickNew">Create a new one from a design…</button></p>`);
  const onClose = () => { dlg.removeEventListener('close', onClose); if (!chosen) open(list[0].id); };
  dlg.addEventListener('close', onClose);
  document.querySelectorAll('#modalBody .pickList li').forEach((li) => {
    li.onclick = async () => {
      chosen = true; dlg.close();
      await window.api.setDefault(li.dataset.id);
      defaultId = li.dataset.id;
      await refreshList();
      open(defaultId);
    };
  });
  $('#pickNew').onclick = () => { chosen = true; dlg.close(); startSetup(false); };
}

async function save() {
  current = await window.api.saveTemplate(readForm());
  dirty = false; status('Saved (encrypted)');
  refreshList();
}

function showModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').showModal();
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

form.addEventListener('input', () => { readForm(); renderPreview(); markDirty(); });
window.addEventListener('resize', applyZoom);

$('#btnNew').onclick = newTemplate;
$('#btnNewLetter').onclick = newLetter;
$('#btnDesign').onclick = changeDesign;
$('#btnDefault').onclick = saveAsDefault;
$('#btnSave').onclick = save;
$('#pgPrev').onclick = () => { page = Math.max(0, page - 1); renderPreview(); };
$('#pgNext').onclick = () => { page++; renderPreview(); };
$('#btnSig').onclick = async () => {
  const img = await window.api.pickImage();
  if (!img) return;
  current.signatureImg = img; $('#sigPreview').src = img;
  renderPreview(); markDirty();
};
$('#btnNoSig').onclick = () => { current.signatureImg = ''; $('#sigPreview').src = ''; renderPreview(); markDirty(); };
$('#btnDup').onclick = async () => {
  const copy = { ...readForm(), id: undefined, name: `${current.name} (copy)` };
  const saved = await window.api.saveTemplate(copy);
  dirty = false; open(saved.id);
};
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
});

const applyLogo = (logo) => { current.logo = logo; setLogoUi(logo); renderPreview(); markDirty(); };
$('#btnLogo').onclick = async () => {
  try {
    const logo = await window.api.pickImage();
    if (logo) applyLogo(logo);
  } catch (e) { alert(e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
};
$('#btnNoLogo').onclick = () => applyLogo('');

// Drag a PNG or JPG onto the logo box
const logoDrop = $('#logoDrop');
['dragenter', 'dragover'].forEach((ev) => logoDrop.addEventListener(ev, (e) => { e.preventDefault(); logoDrop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => logoDrop.addEventListener(ev, (e) => { e.preventDefault(); logoDrop.classList.remove('over'); }));
logoDrop.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (!/^image\/(png|jpeg)$/.test(f.type)) { alert('Please drop a PNG or JPG image.'); return; }
  if (f.size > 5 * 1024 * 1024) { alert('Image is larger than 5 MB — please use a smaller file'); return; }
  const r = new FileReader();
  r.onload = () => applyLogo(r.result);
  r.readAsDataURL(f);
});
// A file dropped anywhere else must not navigate the window away from the app
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

$('#btnDelete').onclick = async () => {
  if (!current?.id || !confirm(`Delete "${current.name}"?`)) return;
  await window.api.deleteTemplate(current.id);
  dirty = false;
  if (current.id === defaultId) defaultId = null;
  current = null;
  const list = await refreshList();
  if (list.length) open(list[0].id); else startSetup(true);
};

// Asks for a password inside the app's dialog. Resolves to the password, or null if cancelled.
function askPassword({ title, text, confirm }) {
  return new Promise((resolve) => {
    showModal(`<h3>${esc(title)}</h3><p>${esc(text)}</p>
<label>Password<input id="pw1" type="password" autocomplete="off"></label>
${confirm ? '<label>Repeat password<input id="pw2" type="password" autocomplete="off"></label>' : ''}
<p id="pwErr" class="bad"></p><p><button type="button" id="pwOk" class="primary">OK</button></p>`);
    const dlg = $('#modal');
    let done = false;
    const finish = (v) => { if (done) return; done = true; dlg.removeEventListener('close', onClose); dlg.close(); resolve(v); };
    const onClose = () => finish(null);
    dlg.addEventListener('close', onClose);
    const submit = () => {
      const p = $('#pw1').value;
      if (confirm && p.length < 6) { $('#pwErr').textContent = 'Use at least 6 characters'; return; }
      if (confirm && p !== $('#pw2').value) { $('#pwErr').textContent = 'The two passwords do not match'; return; }
      if (!p) { $('#pwErr').textContent = 'Enter the password'; return; }
      finish(p);
    };
    $('#pwOk').onclick = submit;
    $('#modalBody').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    $('#pw1').focus();
  });
}
const rpcMessage = (e) => String(e.message).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

$('#btnShare').onclick = async () => {
  const password = await askPassword({ title: 'Export template', text: 'Choose a password. You will need it to open the file on another PC, so share it separately.', confirm: true });
  if (!password) return;
  try {
    if (await window.api.exportTemplateFile(readForm(), password)) status('Template exported (password protected .blt)');
  } catch (e) { alert('Could not export: ' + rpcMessage(e)); }
};
$('#btnImport').onclick = async () => {
  try {
    let res = await window.api.importPick();
    if (res && res.needsPassword) {
      for (;;) {
        const password = await askPassword({ title: 'Import template', text: 'Enter the password for this template file.' });
        if (!password) return;
        try { res = await window.api.importUnlock(password); break; } catch (e) { alert(rpcMessage(e)); }
      }
    }
    if (res && res.template) { dirty = false; open(res.template.id); }
  } catch (e) { alert('Could not import: ' + rpcMessage(e)); }
};

// ---- Image-only PDF export ----
// Each page is drawn into a canvas at 288 dpi through an SVG <foreignObject>,
// so the PDF only ever contains pictures of the page — no editable text.
const pagePx = (t) => { const s = Letterhead.sizeOf(t); return { w: s.pxW, h: s.pxH }; }; // page size at 96 px/in
const DPI_SCALE = 3;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render page'));
    img.src = src;
  });
}

async function rasterisePage(html, t) {
  const PAGE_PX = pagePx(t);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_PX.w}" height="${PAGE_PX.h}">`
    + `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_PX.w * DPI_SCALE;
  canvas.height = PAGE_PX.h * DPI_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

$('#btnPdf').onclick = async () => {
  if (dirty) await save();
  const t = readForm();
  $('#btnPdf').disabled = true;
  try {
    const docId = await window.api.beginPdf(t);
    if (!docId) { status('Export cancelled'); return; }
    status('Fitting pages…');
    const pt = await fitNow({ ...t });
    const count = Letterhead.pageCount(pt);
    if (count > 20) throw new Error('This letter needs more than 20 pages');
    const pngs = [];
    for (let i = 0; i < count; i++) {
      status(`Rendering page ${i + 1} of ${count}…`);
      pngs.push(await rasterisePage(Letterhead.render(pt, { docId, page: i }), pt));
    }
    status('Encrypting PDF…');
    const r = await window.api.finishPdf(t, docId, pngs);
    status(`Exported ${r.docId} (${r.pages} page${r.pages > 1 ? 's' : ''})`);
  } catch (e) {
    status('Export failed'); alert(e.message);
  } finally { $('#btnPdf').disabled = false; }
};

$('#btnVerify').onclick = async () => {
  const r = await window.api.verifyPdf();
  if (!r) return;
  showModal(r.match
    ? `<h3 class="ok">✔ Genuine &amp; unmodified</h3><p><b>${esc(r.file)}</b> matches document <b>${esc(r.match.docId)}</b><br>Template: ${esc(r.match.template)}<br>Issued: ${new Date(r.match.issuedAt).toLocaleString()}</p>`
    : `<h3 class="bad">✖ Not recognised</h3><p><b>${esc(r.file)}</b> was not issued by this app, or it has been modified since export.</p>`);
};

$('#btnIssued').onclick = async () => {
  const list = await window.api.listIssued();
  showModal(`<h3>Issued documents (${list.length})</h3><table><tr><th>Doc ID</th><th>File</th><th>Template</th><th>Issued</th></tr>${
    list.map((d) => `<tr><td>${esc(d.docId)}</td><td>${esc(d.file)}</td><td>${esc(d.template)}</td><td>${new Date(d.issuedAt).toLocaleString()}</td></tr>`).join('')
  }</table>`);
};

// ---- PIN lock ----
let firstRun = false;
async function showLock() {
  const st = await window.api.authStatus();
  firstRun = !st.hasPin;
  $('#lockMsg').textContent = firstRun ? 'Create your PIN (4–8 digits) to protect this app' : 'Enter your PIN';
  $('#pin').placeholder = firstRun ? 'Create your PIN' : 'Enter your PIN';
  $('#btnUnlock').textContent = firstRun ? 'Save PIN & Continue' : 'Unlock';
  $('#pin2').hidden = !firstRun;
  $('#pin').value = $('#pin2').value = $('#lockErr').textContent = '';
  $('#lock').hidden = false;
  $('#pin').focus();
}

let started = false;
async function tryUnlock() {
  const pin = $('#pin').value;
  try {
    if (firstRun) {
      if (pin !== $('#pin2').value) throw new Error('PINs do not match');
      await window.api.setupPin(pin);
    } else if (!(await window.api.unlock(pin))) {
      throw new Error('Wrong PIN');
    }
  } catch (e) {
    $('#lockErr').textContent = e.message.replace(/^.*Error: /, '');
    $('#pin').select();
    return;
  }
  $('#lock').hidden = true;
  if (!started) {
    started = true;
    boot();
  }
}

$('#btnUnlock').onclick = tryUnlock;
$('#lock').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
// ---- AK Vision Systems branding (app interface only, never in exported letters) ----
const openSite = (e) => { e.preventDefault(); window.api.openWebsite(); };
$('#lnkSite').onclick = openSite;
$('#lnkAbout').onclick = async (e) => {
  e.preventDefault();
  const info = await window.api.about();
  showModal(`<div class="about"><img src="../../assets/letterhead-maker-logo.png" alt="Letterhead Maker">
<h3>About Letterhead Maker</h3><p class="muted">Version ${esc(info.version)}</p>
<p>Created by <b>AK Vision Systems</b></p>
<p><button type="button" id="aboutSite" class="primary">Visit our website</button></p>
<p class="muted">${esc(info.website)}</p></div>`);
  $('#aboutSite').onclick = () => window.api.openWebsite();
};

$('#btnLock').onclick = async () => {
  if (dirty) await save();
  await window.api.lock();
  showLock();
};
$('#btnPin').onclick = async () => {
  showModal(`<h3>Change PIN</h3>
<label>Current PIN<input id="oldPin" type="password" maxlength="8"></label>
<label>New PIN<input id="newPin" type="password" maxlength="8"></label>
<label>Confirm new PIN<input id="newPin2" type="password" maxlength="8"></label>
<button id="savePin" class="primary">Update PIN</button> <span id="pinMsg"></span>`);
  $('#savePin').onclick = async () => {
    if ($('#newPin').value !== $('#newPin2').value) { $('#pinMsg').innerHTML = '<span class="bad">The new PINs do not match</span>'; return; }
    try {
      await window.api.changePin($('#oldPin').value, $('#newPin').value);
      $('#pinMsg').innerHTML = '<span class="ok">PIN updated</span>';
    } catch (e) {
      $('#pinMsg').innerHTML = `<span class="bad">${esc(e.message.replace(/^.*Error: /, ''))}</span>`;
    }
  };
};

// Auto-lock after 15 minutes of inactivity
let idle;
const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => { if ($('#lock').hidden) $('#btnLock').click(); }, 15 * 60 * 1000); };
['mousemove', 'keydown'].forEach((ev) => document.addEventListener(ev, resetIdle));
resetIdle();

showLock();
