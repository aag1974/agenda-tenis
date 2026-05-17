// Enumera IDs de torneio no TI direto via /torneio_painel_info/index/X
// para construir um histórico completo (catálogo público filtra demais).
//
// Uso:
//   node scripts/enumerate-ti-history.js <idStart> <idEnd>
//   node scripts/enumerate-ti-history.js 19000 22500
//
// Estratégia: concorrência baixa (4), 1 retry com backoff, checkpoint
// incremental a cada 100 IDs em data/ti-historico-checkpoint.json
// pra poder retomar.

import { writeFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { fetchTournamentDetails } from '../backend/scraper.js';

const idStart = parseInt(process.argv[2] || '19000', 10);
const idEnd = parseInt(process.argv[3] || '22500', 10);
const CONCURRENCY = 4;
const BATCH_DELAY_MS = 150;
const CHECKPOINT = 'data/ti-historico-checkpoint.json';
const FINAL = 'data/ti-historico-raw.json';

if (idEnd < idStart) { console.error('idEnd < idStart'); process.exit(1); }

// Carrega checkpoint se existe
let collected = {};
if (existsSync(CHECKPOINT)) {
  const ck = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
  collected = ck.tournaments || {};
  console.log(`Retomando checkpoint: ${Object.keys(collected).length} IDs já processados`);
}

async function fetchWithRetry(id, attempt = 0) {
  try {
    const det = await fetchTournamentDetails(id);
    return { id, ok: true, ...det };
  } catch (e) {
    if (attempt === 0) {
      await new Promise(r => setTimeout(r, 400));
      return fetchWithRetry(id, 1);
    }
    return { id, ok: false, error: e.message };
  }
}

const ids = [];
for (let i = idStart; i <= idEnd; i++) {
  if (collected[i] === undefined) ids.push(i);
}

console.log(`A processar: ${ids.length} IDs (range ${idStart}..${idEnd})`);
console.log(`Concorrência: ${CONCURRENCY} · delay entre lotes: ${BATCH_DELAY_MS}ms`);

const t0 = Date.now();
let hits = 0, misses = 0, since_save = 0;

function saveCheckpoint() {
  const tmp = CHECKPOINT + '.tmp';
  writeFileSync(tmp, JSON.stringify({
    updatedAt: new Date().toISOString(),
    range: [idStart, idEnd],
    count: Object.keys(collected).length,
    tournaments: collected,
  }));
  renameSync(tmp, CHECKPOINT);
  since_save = 0;
}

for (let i = 0; i < ids.length; i += CONCURRENCY) {
  const batch = ids.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(fetchWithRetry));
  for (const r of results) {
    if (r.ok && r.name) {
      collected[r.id] = {
        id: r.id,
        name: r.name,
        city: r.city,
        state: r.state,
        cityState: r.cityState,
        startDate: r.startDate,
        endDate: r.endDate,
        tiers: r.tiers || [],
        registrationOpensAt: r.registrationOpensAt || null,
        registrationDeadline: r.registrationDeadline || null,
        cancelDeadline: r.cancelDeadline || null,
      };
      hits++;
    } else {
      collected[r.id] = { id: r.id, ok: false };
      misses++;
    }
    since_save++;
  }

  if (since_save >= 100) {
    saveCheckpoint();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const done = i + batch.length;
    const rate = done / ((Date.now() - t0) / 1000);
    const remaining = Math.round((ids.length - done) / rate);
    console.log(`  ${done}/${ids.length} (hits ${hits}, misses ${misses}) · ${elapsed}s · ETA ${remaining}s`);
  }

  if (BATCH_DELAY_MS) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
}

saveCheckpoint();

// Compila resultado final: só os hits válidos
const allValid = Object.values(collected).filter(t => t.ok !== false && t.name);
console.log(`\nTotal: ${allValid.length} torneios válidos em ${ids.length} IDs novos (${(100*allValid.length/Object.keys(collected).length).toFixed(0)}% hit rate sobre tudo coletado)`);

writeFileSync(FINAL, JSON.stringify({
  fetchedAt: new Date().toISOString(),
  range: [idStart, idEnd],
  count: allValid.length,
  tournaments: allValid,
}, null, 2));

console.log(`✓ Histórico bruto salvo em ${FINAL}`);
console.log(`  Tempo total: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
