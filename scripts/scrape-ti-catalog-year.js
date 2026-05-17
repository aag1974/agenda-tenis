// Puxa o catálogo TI completo de um ano (categoria juvenil = 2) e
// salva em data/ti-catalog-<year>.json. Uso:
//   node scripts/scrape-ti-catalog-year.js 2025
// É só leitura de listagem pública, não precisa de login.

import * as cheerio from 'cheerio';
import { writeFileSync } from 'node:fs';

const BASE = 'https://www.tenisintegrado.com.br';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const JUVENIL = 2;

const year = parseInt(process.argv[2] || `${new Date().getFullYear()}`, 10);
if (!year || year < 2020 || year > 2030) {
  console.error('Ano inválido. Uso: node scripts/scrape-ti-catalog-year.js 2025');
  process.exit(1);
}

async function getText(url) {
  const res = await fetch(BASE + url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function elementInnerText($el) {
  return $el.text().replace(/\s+/g, ' ').trim();
}

function parseDateRange(s) {
  if (!s) return [null, null];
  const m = s.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?\s*[-a]\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) {
    const single = s.match(/(\d{2}\/\d{2}\/\d{4})/);
    return single ? [single[1], single[1]] : [null, null];
  }
  const [, d1, m1, y1, d2, m2, y2] = m;
  let startYear = y1 || y2;
  if (!y1 && parseInt(m1) > parseInt(m2)) startYear = String(parseInt(y2) - 1);
  return [`${d1}/${m1}/${startYear}`, `${d2}/${m2}/${y2}`];
}

function parseCatalogRows(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('tr').each((i, tr) => {
    const $tr = $(tr);
    const link = $tr.find('a[href*="torneio_painel_info/index/"]').first();
    if (!link.length) return;
    const m = (link.attr('href') || '').match(/\/index\/(\d+)/);
    if (!m) return;
    const id = m[1];
    if (out.some(t => t.id === id)) return;

    const nameEl = $tr.find('.name-info span, .link-tournament .name-info, .link-tournament').first();
    const name = (nameEl.length ? nameEl.text() : link.text()).trim().replace(/\s+/g, ' ');
    const rankingText = $tr.find('.text-light-gray, .text-slim').first().text().trim();

    const cells = [];
    $tr.find('td').each((i, td) => cells.push(elementInnerText($(td))));

    let city = null, state = null;
    for (const c of cells) {
      const mc = c.match(/^([A-ZÀ-Ý][A-Za-zÀ-ý'.\s]+?)\s*-\s*([A-Z]{2})$/);
      if (mc) { city = mc[1].trim(); state = mc[2]; break; }
    }
    const lastCell = cells[cells.length - 1] || '';

    const tierMatch = rankingText.match(/(GA\+|GA|G1\+|G1|G2\+|G2|G3\+|G3)(?!\w)/);
    const tier = tierMatch ? tierMatch[1] : null;

    out.push({ id, name, rankingText, city, state, datesText: lastCell, tier });
  });
  return out;
}

console.log(`Puxando catálogo TI juvenil ano ${year} (12 meses em paralelo)...`);

const pages = await Promise.all(
  Array.from({ length: 12 }, (_, i) => i + 1).map(month =>
    getText(`/new_torneio/index2/${JUVENIL}/${year}/0/0/${month}`).catch(e => {
      console.error(`  mês ${month}: ${e.message}`);
      return '';
    })
  )
);

const all = [];
for (const html of pages) all.push(...parseCatalogRows(html));
const byId = new Map();
for (const r of all) if (!byId.has(r.id)) byId.set(r.id, r);
const unique = [...byId.values()];

const enriched = unique.map(r => {
  const [startDate, endDate] = parseDateRange(r.datesText);
  return {
    id: r.id,
    name: r.name.slice(0, 200),
    city: r.city,
    state: r.state,
    startDate,
    endDate,
    tier: r.tier,
    url: `${BASE}/torneio_painel_info/index/${r.id}`,
  };
});

// Filtra: só queremos torneios cujo startDate está no ano-alvo
const filtered = enriched.filter(t => {
  if (!t.startDate) return false;
  const [, , yy] = t.startDate.split('/');
  return yy === String(year);
});

const outPath = `data/ti-catalog-${year}.json`;
writeFileSync(outPath, JSON.stringify({ year, fetchedAt: new Date().toISOString(), count: filtered.length, tournaments: filtered }, null, 2));
console.log(`✓ ${filtered.length} torneios (filtrados pra ano ${year}) salvos em ${outPath}`);
console.log(`  Total bruto antes do filtro: ${enriched.length}`);
