// Read and strip metadata, one read/strip pair per container format.
// Runs in the browser and under `node --test`. ExifReader and JSZip are UMD
// globals (loaded by index.html, or set by the test); pdf-lib is an ES module.
import { PDFDocument, PDFName, decodePDFRawStream } from '../vendor/pdf-lib.esm.min.js';

const MAX_VALUE = 300;

export const KINDS = {
  jpeg:   { label: 'JPEG',            strip: true },
  png:    { label: 'PNG',             strip: true },
  webp:   { label: 'WebP',            strip: true },
  pdf:    { label: 'PDF',             strip: true },
  office: { label: 'Office document', strip: true },
  tiff:   { label: 'TIFF',            strip: false },
  heif:   { label: 'HEIC/AVIF',       strip: false },
  gif:    { label: 'GIF',             strip: false },
};

const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));
const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function detect(bytes, name = '') {
  const b = bytes, s4 = ascii(b, 0, 4);
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
  if (s4 === '\x89PNG') return 'png';
  if (s4 === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (s4 === '%PDF') return 'pdf';
  if (s4.startsWith('PK') && /\.(docx|xlsx|pptx|odt|ods|odp)$/i.test(name)) return 'office';
  if (s4 === 'II*\0' || s4 === 'MM\0*') return 'tiff';
  if (ascii(b, 4, 8) === 'ftyp') return 'heif';
  if (s4 === 'GIF8') return 'gif';
  return null;
}

// ponytail: keyword heuristic for the "identifying" flag; the strip removes
// everything regardless, this only decides which rows get the warning dot.
const SENSITIVE = /gps|latitude|longitude|altitude|serial|artist|owner|author|creator|modifiedby|company|manager|by-?line|copyright|comment|description|location|city|country|date|time|software|^make$|model|lens|host|history|name|e-?mail|title|subject|keyword|user|contact|credit|source|producer|application|camera|device/i;

function row(group, key, value) {
  value = String(value).replace(/\s+/g, ' ').trim();
  if (!value) return null;
  if (value.length > MAX_VALUE) value = value.slice(0, MAX_VALUE) + '…';
  return { group, key, value, sensitive: SENSITIVE.test(key) || SENSITIVE.test(group) };
}
const rows = list => list.filter(Boolean);

/** @returns {Promise<Array<{group,key,value,sensitive}>>} */
export async function read(kind, bytes) {
  switch (kind) {
    case 'pdf': return readPdf(bytes);
    case 'office': return readOffice(bytes);
    case null: return [];
    default: return readImage(bytes);
  }
}

/** @returns {Promise<Uint8Array>} the same file with its metadata removed */
export async function strip(kind, bytes) {
  switch (kind) {
    case 'jpeg': return stripJpeg(bytes);
    case 'png': return stripPng(bytes);
    case 'webp': return stripWebp(bytes);
    case 'pdf': return stripPdf(bytes);
    case 'office': return stripOffice(bytes);
    default: throw new Error(`Cannot strip ${KINDS[kind]?.label ?? 'this file type'} yet`);
  }
}

/* ---------------- images: ExifReader for reading ---------------- */

const GROUP_LABELS = {
  exif: 'EXIF', iptc: 'IPTC', xmp: 'XMP', icc: 'ICC profile', gps: 'GPS', mpf: 'MPF',
  photoshop: 'Photoshop', pngText: 'PNG text',
  makerNotes: 'Maker notes', composite: 'Derived',
};

function readImage(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const tags = globalThis.ExifReader.load(buf, { expanded: true });
  const out = [];
  for (const [group, obj] of Object.entries(tags)) {
    if (['Thumbnail', 'file', 'jfif', 'pngFile', 'png', 'riff', 'gif'].includes(group)) continue; // container structure, not metadata
    const label = GROUP_LABELS[group] ?? group;
    for (const [key, tag] of Object.entries(obj)) {
      if (key === '_raw' || key.endsWith('IFD Pointer')) continue;
      const v = tag && typeof tag === 'object' ? (tag.description ?? tag.value) : tag;
      if (v != null && typeof v !== 'object') out.push(row(label, key, v));
    }
  }
  return rows(out);
}

/* ---------------- JPEG ---------------- */

// Keep: tables, frames, scans, JFIF, the ICC profile (colour) and the Adobe
// APP14 marker (decides CMYK/YCCK decoding). Drop every other APPn (EXIF, XMP,
// IPTC, Photoshop, MPF...) and COM. Anything after EOI (motion-photo video,
// depth maps) is dropped too.
function keepJpegSegment(marker, seg) {
  if (marker === 0xFE) return false;
  if (marker < 0xE0 || marker > 0xEF) return true;
  const id = ascii(seg, 4, 15);
  return (marker === 0xE0 && id.startsWith('JFIF'))
    || (marker === 0xE2 && id.startsWith('ICC_PROFILE'))
    || (marker === 0xEE && id.startsWith('Adobe'));
}

function stripJpeg(b) {
  const out = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xFF) throw new Error('Corrupt JPEG');
    if (b[i + 1] === 0xFF) { i++; continue; } // fill byte
    const m = b[i + 1];
    if (m === 0xD9) { out.push(b.subarray(i, i + 2)); break; }
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    const seg = b.subarray(i, i + 2 + len);
    if (keepJpegSegment(m, seg)) out.push(seg);
    i += 2 + len;
    if (m === 0xDA) { // entropy-coded data has no length: copy until the next marker
      let j = i;
      while (j < b.length && !(b[j] === 0xFF && b[j + 1] !== 0 && !(b[j + 1] >= 0xD0 && b[j + 1] <= 0xD7))) j++;
      out.push(b.subarray(i, j));
      i = j;
    }
  }
  return concat(out);
}

/* ---------------- PNG ---------------- */

// Allowlist: critical chunks, colour/transparency, physical size and APNG.
// Text (tEXt/zTXt/iTXt), eXIf, tIME and unknown chunks go.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT']);

function stripPng(b) {
  const dv = view(b), out = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i), type = ascii(b, i + 4, i + 8);
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, i + 12 + len));
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return concat(out);
}

/* ---------------- WebP ---------------- */

function stripWebp(b) {
  const dv = view(b), chunks = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, i + 4), len = dv.getUint32(i + 4, true);
    const size = 8 + len + (len & 1); // chunks are padded to even length
    if (type !== 'EXIF' && type !== 'XMP ') chunks.push(b.subarray(i, i + size));
    i += size;
  }
  const body = concat(chunks);
  if (ascii(body, 0, 4) === 'VP8X') body[8] &= ~0x0C; // clear the EXIF and XMP flags
  const head = new Uint8Array(b.subarray(0, 12));
  view(head).setUint32(4, 4 + body.length, true);
  return concat([head, body]);
}

/* ---------------- XML (XMP, Office) ---------------- */

const unescapeXml = s => s.replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (_, e, n) =>
  n ? String.fromCodePoint(n) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e]);

// Flat scrape, no parser: `<ns:key>value</ns:key>`, the first `<rdf:li>` of a
// list attributed to its parent, and XMP's attribute form on rdf:Description.
function xmlRows(group, xml) {
  const out = [];
  for (const m of xml.matchAll(/<rdf:Description\b([^>]*)>/g)) {
    for (const a of m[1].matchAll(/([\w.-]+:[\w.-]+)="([^"]*)"/g)) {
      if (!/^(xmlns|rdf):/.test(a[1])) out.push(row(group, a[1].split(':')[1], unescapeXml(a[2])));
    }
  }
  for (const m of xml.matchAll(/<property\b[^>]*\bname="([^"]+)"[^>]*>\s*<[^>]+>([^<]*)</g)) {
    out.push(row(group, m[1], unescapeXml(m[2])));
  }
  const rest = xml.replace(/<property\b[\s\S]*?<\/property>/g, '');
  for (const m of rest.matchAll(/<(?:[\w.-]+:)?([\w.-]+)(?:\s[^>]*)?>(?:\s*<rdf:(?:Seq|Bag|Alt)>)?\s*(?:<rdf:li[^>]*>)?([^<]+)</g)) {
    if (m[1] !== 'li' && !/^rdf:/.test(m[0].slice(1, 5))) out.push(row(group, m[1], unescapeXml(m[2])));
  }
  return rows(out);
}

/* ---------------- PDF ---------------- */

async function readPdf(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = [];
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info) {
    for (const [k, ref] of info.entries()) {
      const v = doc.context.lookup(ref);
      out.push(row('PDF info', k.decodeText(), v.decodeText ? v.decodeText() : v.toString()));
    }
  }
  const xmp = doc.catalog.lookup(PDFName.of('Metadata'));
  if (xmp) {
    const raw = xmp.dict.has(PDFName.of('Filter')) ? decodePDFRawStream(xmp).decode() : xmp.contents;
    out.push(...xmlRows('XMP', new TextDecoder().decode(raw)));
  }
  return rows(out);
}

// ponytail: document-level Info + XMP only; per-object XMP (embedded images,
// form fields) stays. Swap for a full-tree walk if that ever matters.
async function stripPdf(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.context.trailerInfo.Info = doc.context.register(doc.context.obj({}));
  doc.catalog.delete(PDFName.of('Metadata'));
  return doc.save();
}

/* ---------------- Office / OpenDocument ---------------- */

const OFFICE_META = /^(docProps\/(core|app|custom)\.xml|meta\.xml)$/;

async function readOffice(bytes) {
  const zip = await globalThis.JSZip.loadAsync(bytes);
  const out = [];
  for (const name of Object.keys(zip.files).filter(n => OFFICE_META.test(n))) {
    out.push(...xmlRows(name.replace(/^docProps\//, ''), await zip.file(name).async('string')));
  }
  return out;
}

// Property parts keep their root element (namespaces intact) and lose every
// child. Comment/revision author names in the body parts are blanked; the
// comment and tracked-change text itself stays.
const emptyRoot = xml => xml.replace(/^([\s\S]*?<[\w:-]+(?:\s[^>]*?)?)\/?>[\s\S]*$/, '$1/>');
const blankAuthors = xml => xml
  .replace(/\b(w:author|w:initials)="[^"]*"/g, '$1=""')
  .replace(/<author>[^<]*<\/author>/g, '<author></author>')
  .replace(/(<p:cmAuthor\b[^>]*?)\bname="[^"]*"/g, '$1name=""')
  .replace(/(<p:cmAuthor\b[^>]*?)\binitials="[^"]*"/g, '$1initials=""');

async function stripOffice(bytes) {
  const zip = await globalThis.JSZip.loadAsync(bytes);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (OFFICE_META.test(name)) zip.file(name, emptyRoot(await entry.async('string')));
    else if (/^(word|xl|ppt)\/.*\.xml$/.test(name)) zip.file(name, blankAuthors(await entry.async('string')));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
