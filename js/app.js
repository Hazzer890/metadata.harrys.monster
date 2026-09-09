import { KINDS, detect, read, strip } from './formats.js';

const cards = document.getElementById('cards');
const tpl = document.getElementById('card-tpl');

function bytesToSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderRows(tbody, rows) {
  tbody.replaceChildren(...rows.map(r => {
    const tr = document.createElement('tr');
    if (r.sensitive) tr.className = 'is-sensitive';
    for (const v of [r.group, r.key, r.value]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    if (r.sensitive) tr.firstChild.title = 'Likely identifying';
    return tr;
  }));
}

async function inspect(file) {
  const card = tpl.content.firstElementChild.cloneNode(true);
  const $ = sel => card.querySelector(sel);
  $('.card-name').textContent = file.name;
  $('.card-size').textContent = bytesToSize(file.size);
  $('.card-remove').addEventListener('click', () => card.remove());
  cards.prepend(card);

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = detect(bytes, file.name);
    const info = KINDS[kind];
    $('.card-kind').textContent = info?.label ?? 'Unsupported type';
    const rows = await read(kind, bytes);
    renderRows($('tbody'), rows);
    const flagged = rows.filter(r => r.sensitive).length;
    $('.card-summary').textContent = !info ? 'This file type is not supported.'
      : rows.length === 0 ? 'No metadata found.'
      : `${rows.length} field${rows.length === 1 ? '' : 's'} found, ${flagged} likely identifying.`;
    $('table').hidden = rows.length === 0;
    window.track?.('inspect', { kind, fields: rows.length });

    const btn = $('.card-strip');
    if (!info?.strip) {
      if (info) $('.card-note').textContent = `Removing metadata from ${info.label} files is not supported yet.`;
      btn.remove();
      return;
    }
    btn.hidden = false;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const clean = await strip(kind, bytes);
        const left = await read(kind, clean);
        const url = URL.createObjectURL(new Blob([clean]));
        const a = Object.assign(document.createElement('a'), {
          href: url, download: file.name.replace(/(\.[^.]+)?$/, '-clean$1'),
        });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        $('.card-note').textContent = `Downloaded ${bytesToSize(clean.length)}; ${left.length === 0 ? 'nothing left to read' : `${left.length} fields could not be removed`}.`;
        window.track?.('strip', { kind });
      } catch (err) {
        $('.card-error').textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  } catch (err) {
    $('.card-error').textContent = err.message || String(err);
  }
}

const zone = document.getElementById('dropzone');
const input = document.getElementById('file-input');
document.getElementById('browse').addEventListener('click', () => input.click());
input.addEventListener('change', () => { [...input.files].forEach(inspect); input.value = ''; });
['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('is-over'); }));
['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return;
  zone.classList.remove('is-over');
}));
zone.addEventListener('drop', e => [...e.dataTransfer.files].forEach(inspect));
document.getElementById('year').textContent = new Date().getFullYear();
