// Teste de viabilidade: enumerar IDs de torneio direto via
// /torneio_painel_info/index/X e ver quantos são válidos.
// Pega um range pequeno, mede taxa de hit e tempo médio.

import * as cheerio from 'cheerio';

const BASE = 'https://www.tenisintegrado.com.br';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)';

async function fetchOne(id) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/torneio_painel_info/index/${id}`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return { id, ok: false, status: res.status, ms: Date.now() - t0 };
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $('.tournament-title').first().text().trim();
    const local = $('.tournament-local').first().text().trim();
    // datas no formato dd/mm/aaaa
    const dates = [...html.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map(m => m[1]);
    const earliest = dates.length ? dates.sort()[0] : null;
    return {
      id,
      ok: !!title,
      title: title.slice(0, 70),
      local: local.slice(0, 30),
      sampleDate: earliest,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { id, ok: false, error: e.message, ms: Date.now() - t0 };
  }
}

// Pega 50 IDs no range típico de 2025 (visto 20145, 19995, etc.)
const start = parseInt(process.argv[2] || '20100', 10);
const count = parseInt(process.argv[3] || '50', 10);
const ids = Array.from({ length: count }, (_, i) => start + i);

console.log(`Testando ${count} IDs a partir de ${start} (concorrência 10)...`);
const t0 = Date.now();

const results = [];
const conc = 10;
for (let i = 0; i < ids.length; i += conc) {
  const batch = ids.slice(i, i + conc);
  const batchResults = await Promise.all(batch.map(fetchOne));
  results.push(...batchResults);
  process.stdout.write('.');
}
console.log();

const total = Date.now() - t0;
const ok = results.filter(r => r.ok);
const fail = results.filter(r => !r.ok);
const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);

console.log(`\nTempo total: ${total}ms (${(total / count).toFixed(0)}ms/id médio)`);
console.log(`Hits válidos: ${ok.length}/${count} = ${(100 * ok.length / count).toFixed(0)}%`);
console.log(`Latência média por request: ${avgMs}ms`);
console.log(`\n── Amostra (10 primeiros válidos) ──`);
for (const r of ok.slice(0, 10)) {
  console.log(`  ${r.id} | ${r.sampleDate} | ${r.local} | ${r.title}`);
}
console.log(`\n── Inválidos ──`);
for (const r of fail.slice(0, 5)) {
  console.log(`  ${r.id} | status=${r.status || 'err'} ${r.error || ''}`);
}

// Estimativa de varredura completa
const fullRange = 5000; // IDs 17000-22000 cobre ~2.5 anos
const estSec = (fullRange * avgMs / conc) / 1000;
console.log(`\nExtrapolando: scan de ${fullRange} IDs com concorrência ${conc} ≈ ${estSec.toFixed(0)}s = ${(estSec / 60).toFixed(1)}min`);
