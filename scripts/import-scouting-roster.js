// Importa inscritos GA do torneio Itajaí (22142) pra data/scouting/roster.json.
// Roda só localmente, gera o arquivo, e o git deploy leva pra produção.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'data', 'scouting');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const TID = '22142';
const GA = {
  '866': '12M GA', '869': '14M GA', '872': '16M GA', '875': '18M GA',
  '848': '12F GA', '849': '14F GA', '882': '16F GA', '885': '18F GA',
};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)';
const BASE = 'https://www.tenisintegrado.com.br';

async function fetchInscritos(catId) {
  const url = `${BASE}/torneio_painel_insc/index/${TID}/${catId}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${catId}`);
  return res.text();
}

function parse(html, cat) {
  const $ = cheerio.load(html);
  const out = [];
  $('.member').each((_, m) => {
    const $m = $(m);
    const a = $m.find('.info-container a').first();
    const nome = a.text().trim();
    const meta = $m.find('.text-light-gray.text-slim').text();
    const idMatch = meta.match(/ID:\s*(\d+)/);
    const ufMatch = meta.match(/UF:\s*([A-Z]{2})/);
    const idadeMatch = meta.match(/Idade:\s*(\d+)/);
    if (!nome || !idMatch) return;
    const clubeEl = $m.find('.text-success').first().text().trim();
    // Cidade vem antes do UF: ID block, num spam (sic) genérico
    const cidade = $m.find('spam').not('.text-success').first().text().trim() || null;
    out.push({
      id: idMatch[1],
      nome,
      categoria: cat,
      clube: clubeEl || null,
      cidade: cidade || null,
      uf: ufMatch ? ufMatch[1] : null,
      idade: idadeMatch ? parseInt(idadeMatch[1], 10) : null,
    });
  });
  return out;
}

async function main() {
  const all = [];
  for (const [catId, label] of Object.entries(GA)) {
    const html = await fetchInscritos(catId);
    const atletas = parse(html, label);
    console.log(`  ${label}: ${atletas.length}`);
    all.push(...atletas);
  }
  // Dedupe por (id, categoria) — alguns atletas podem aparecer em mais de uma
  const seen = new Set();
  const deduped = [];
  for (const a of all) {
    const k = `${a.id}:${a.categoria}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(a);
  }
  const roster = {
    atletas: deduped,
    importedAt: new Date().toISOString(),
    source: `TI tournament ${TID} GA`,
  };
  const outPath = join(OUT_DIR, 'roster.json');
  writeFileSync(outPath, JSON.stringify(roster, null, 2), 'utf8');
  console.log(`\nTotal: ${deduped.length} atletas`);
  console.log(`Únicos por ID: ${new Set(deduped.map(a => a.id)).size}`);
  console.log(`Salvo em ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
