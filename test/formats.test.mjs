import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from '../vendor/pdf-lib.esm.min.js';

// The vendored UMD builds attach to `this`, which is undefined at ESM top
// level; run them as classic scripts so they land on globalThis like in a browser.
import vm from 'node:vm';
for (const f of ['exif-reader.js', 'jszip.min.js']) vm.runInThisContext(await readFile(new URL(`../vendor/${f}`, import.meta.url), 'utf8'));
const { detect, read, strip } = await import('../js/formats.js');

const fixture = async name => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
const has = (rows, key, value) => rows.some(r => r.key === key && (value === undefined || r.value.includes(value)));

for (const name of ['photo.jpg', 'photo.png', 'photo.webp']) {
  test(`${name}: reads EXIF/GPS, strip leaves nothing and a decodable image`, async () => {
    const bytes = await fixture(name);
    const kind = detect(bytes, name);
    const rows = await read(kind, bytes);
    assert.ok(has(rows, 'Artist', 'Jane Doe'), `Artist in ${JSON.stringify(rows)}`);
    assert.ok(has(rows, 'Latitude'), 'GPS latitude');
    assert.ok(rows.find(r => r.key === 'Latitude').sensitive);
    if (name.endsWith('.png')) assert.ok(has(rows, 'Comment', 'secret note'));

    const clean = await strip(kind, bytes);
    assert.equal(detect(clean, name), kind);
    assert.ok(clean.length < bytes.length);
    assert.deepEqual(await read(kind, clean), []);
    // pixel data survives: the image dimensions are still readable
    const tags = ExifReader.load(clean.buffer, { expanded: true });
    const dims = { ...tags.file, ...tags.pngFile, ...tags.riff };
    assert.ok(Object.values(dims).some(t => t.value === 8), JSON.stringify(dims));
  });
}

test('jpeg: keeps the ICC profile, drops COM and trailing data', async () => {
  const src = await fixture('photo.jpg');
  const icc = [0xFF, 0xE2, 0x00, 0x10, ...'ICC_PROFILE\0'.split('').map(c => c.charCodeAt(0)), 1, 1];
  const com = [0xFF, 0xFE, 0x00, 0x07, ...'hello'.split('').map(c => c.charCodeAt(0))];
  const bytes = new Uint8Array([...src.subarray(0, 2), ...icc, ...com, ...src.subarray(2), 0xDE, 0xAD]);
  const clean = await strip('jpeg', bytes);
  const s = String.fromCharCode(...clean);
  assert.ok(s.includes('ICC_PROFILE'));
  assert.ok(!s.includes('hello'));
  assert.equal(clean[clean.length - 1], 0xD9);
});

test('pdf: reads Info + XMP, strip removes both and keeps pages', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setTitle('Secret plan'); doc.setAuthor('Jane Doe'); doc.setCreator('Word');
  const bytes = await doc.save();
  assert.equal(detect(bytes, 'x.pdf'), 'pdf');
  const rows = await read('pdf', bytes);
  assert.ok(has(rows, 'Author', 'Jane Doe'));
  assert.ok(has(rows, 'Title', 'Secret plan'));
  const clean = await strip('pdf', bytes);
  assert.deepEqual(await read('pdf', clean), []);
  assert.equal((await PDFDocument.load(clean)).getPageCount(), 1);
  assert.ok(!String.fromCharCode(...clean).includes('Jane Doe'));
});

test('xmp: attribute form and rdf lists are attributed to their property', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Acrobat 9"/>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Jane &amp; Co</rdf:li></rdf:Seq></dc:creator></rdf:Description>
  </rdf:RDF></x:xmpmeta>`;
  const stream = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(doc.context.obj ? (await import('../vendor/pdf-lib.esm.min.js')).PDFName.of('Metadata') : null, doc.context.register(stream));
  const rows = await read('pdf', await doc.save());
  assert.ok(has(rows, 'CreatorTool', 'Acrobat 9'), JSON.stringify(rows));
  assert.ok(has(rows, 'creator', 'Jane & Co'), JSON.stringify(rows));
});

test('docx: reads core/app/custom props, strip empties them and blanks comment authors', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>Jane Doe</dc:creator><cp:lastModifiedBy>Bob</cp:lastModifiedBy><dc:title></dc:title></cp:coreProperties>');
  zip.file('docProps/app.xml', '<Properties xmlns="a"><Application>Word</Application><Company>Acme &amp; Sons</Company></Properties>');
  zip.file('docProps/custom.xml', '<Properties xmlns="p" xmlns:vt="v"><property fmtid="{x}" pid="2" name="Client"><vt:lpwstr>Big Bank</vt:lpwstr></property></Properties>');
  zip.file('word/document.xml', '<w:document><w:body><w:p>Hello</w:p></w:body></w:document>');
  zip.file('word/comments.xml', '<w:comments><w:comment w:id="0" w:author="Jane Doe" w:initials="JD"><w:p>fix this</w:p></w:comment></w:comments>');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  assert.equal(detect(bytes, 'report.docx'), 'office');
  const rows = await read('office', bytes);
  assert.ok(has(rows, 'creator', 'Jane Doe'));
  assert.ok(has(rows, 'Company', 'Acme & Sons'));
  assert.ok(has(rows, 'Client', 'Big Bank'));
  assert.ok(!has(rows, 'title'), 'empty elements are skipped');

  const clean = await strip('office', bytes);
  assert.deepEqual(await read('office', clean), []);
  const out = await JSZip.loadAsync(clean);
  assert.equal(await out.file('word/document.xml').async('string'), '<w:document><w:body><w:p>Hello</w:p></w:body></w:document>');
  assert.match(await out.file('docProps/core.xml').async('string'), /<cp:coreProperties xmlns:cp="c" xmlns:dc="d"\/>$/);
  assert.ok(!(await out.file('word/comments.xml').async('string')).includes('Jane'));
  assert.ok((await out.file('word/comments.xml').async('string')).includes('fix this'));
});

test('detect: unknown bytes and read-only kinds', async () => {
  assert.equal(detect(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'a.bin'), null);
  assert.deepEqual(await read(null, new Uint8Array(8)), []);
  await assert.rejects(strip('heif', new Uint8Array(8)), /Cannot strip HEIC/);
});
