// Enriquece data/ti-catalogo-base.json cruzando com a listagem TI cat=2
// (oficialmente Juvenil) dos anos passados. A listagem captura tier
// vindo do rankingText (campo que a página de detalhes individual não
// expõe), e marca audience='juvenil' pra torneios sem hint nominal.

import * as cheerio from 'cheerio';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE_URL = 'https://www.tenisintegrado.com.br';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)';
const JUVENIL_CAT = 2;
const BASE_FILE = 'data/ti-catalogo-base.json';
const SEED_FILE = 'backend/seed/ti-catalogo-base.seed.json';

async function getText(url) {
  const res = await fetch(BASE_URL + url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' },
  });
  return res.ok ? await res.text() : '';
}

function parseCatalogRows(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('a[href*="torneio_painel_info/index/"]').first();
    if (!link.length) return;
    const m = (link.attr('href') || '').match(/\/index\/(\d+)/);
    if (!m) return;
    const id = m[1];
    const rankingText = $tr.find('.text-light-gray, .text-slim').first().text().trim();
    const tiers = [...new Set(
      [...rankingText.matchAll(/(GA\+|G1\+|GA|G1|G2\+|G2|G3\+|G3)(?!\w)/g)].map(x => x[1])
    )];
    out.push({ id, tiers });
  });
  return out;
}

async function fetchCatalogYear(year) {
  const pages = await Promise.all(
    Array.from({ length: 12 }, (_, i) => i + 1).map(month =>
      getText(`/new_torneio/index2/${JUVENIL_CAT}/${year}/0/0/${month}`).catch(() => '')
    )
  );
  const seen = new Map();
  for (const html of pages) {
    for (const r of parseCatalogRows(html)) {
      if (!seen.has(r.id)) seen.set(r.id, r);
    }
  }
  return [...seen.values()];
}

console.log('Puxando listagem cat=2 do TI: 2024, 2025, 2026...');
const [list2024, list2025, list2026] = await Promise.all([
  fetchCatalogYear(2024),
  fetchCatalogYear(2025),
  fetchCatalogYear(2026),
]);
console.log(`  2024: ${list2024.length} IDs`);
console.log(`  2025: ${list2025.length} IDs`);
console.log(`  2026: ${list2026.length} IDs`);

const officialJuvenil = new Map();
for (const list of [list2024, list2025, list2026]) {
  for (const r of list) officialJuvenil.set(r.id, r);
}
console.log(`Total IDs oficialmente Juvenil (cat=2): ${officialJuvenil.size}`);

const base = JSON.parse(readFileSync(BASE_FILE, 'utf8'));
let enriched = 0, tierAdded = 0;
for (const [id, t] of Object.entries(base.tournaments)) {
  const official = officialJuvenil.get(String(id));
  if (!official) continue;
  let changed = false;
  if (t.audience !== 'juvenil') {
    t.audience = 'juvenil';
    enriched++;
    changed = true;
  }
  if (official.tiers.length && (!t.tiers || t.tiers.length === 0)) {
    t.tiers = official.tiers;
    tierAdded++;
    changed = true;
  }
}
console.log(`\nEnriquecimento aplicado:`);
console.log(`  ${enriched} torneios re-classificados como audience='juvenil'`);
console.log(`  ${tierAdded} torneios ganharam tier pela 1ª vez`);

base.schemaVersion = 3;
base.fetchedAt = new Date().toISOString();
writeFileSync(BASE_FILE, JSON.stringify(base, null, 2));
writeFileSync(SEED_FILE, JSON.stringify(base, null, 2));
console.log(`\n✓ Base + seed atualizados (schema v3)`);
