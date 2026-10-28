// Builds a locked, image-only PDF from page images rasterised in the app window:
//  - every page is a flattened high-res image (no text layer to edit, copy or convert)
//  - US Letter (612 x 792 pt) or A4 (595.28 x 841.89 pt), as chosen in the template
//  - AES-256 encrypted with a random, discarded owner password and all
//    permissions except printing disabled
const crypto = require('crypto');
const { PDFDocument } = require('@cantoo/pdf-lib');

const LETTER = { w: 612, h: 792 };
const A4 = { w: 595.28, h: 841.89 };
const sizeFor = (t) => (t && t.pageSize === 'a4' ? A4 : LETTER);

const newDocId = () =>
  `BLP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

async function buildPdf(template, docId, pngPages) {
  if (!Array.isArray(pngPages) || !pngPages.length) throw new Error('No pages to export');
  const pdf = await PDFDocument.create();
  const size = sizeFor(template);

  for (const bytes of pngPages) {
    const png = await pdf.embedPng(Uint8Array.from(bytes));
    pdf.addPage([size.w, size.h]).drawImage(png, { x: 0, y: 0, width: size.w, height: size.h });
  }

  pdf.setTitle(`${template.company || 'Letterhead Maker'} — ${template.name || 'Letterhead'}`);
  pdf.setAuthor(template.company || 'Letterhead Maker');
  pdf.setCreator('Letterhead Maker');
  pdf.setProducer('Letterhead Maker');
  pdf.setSubject(`Document ID ${docId}`);
  pdf.setKeywords([docId]);

  pdf.encrypt({
    ownerPassword: crypto.randomBytes(32).toString('base64'),
    userPassword: '',
    algorithm: 'AES-256',
    permissions: {
      printing: 'highResolution',
      modifying: false,
      copying: false,
      annotating: false,
      fillingForms: false,
      contentAccessibility: false,
      documentAssembly: false,
    },
  });

  const bytes = await pdf.save({ useObjectStreams: false });
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return { bytes, sha256, pages: pdf.getPageCount() };
}

module.exports = { buildPdf, newDocId, LETTER, A4 };
