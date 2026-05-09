// Suite de testes pra detecção de tier — roda contra:
//   1. Casos de teste sintéticos (todos os tiers + edge cases)
//   2. Todos os torneios reais no synced.json (regressão)
//
// Uso: node scripts/test-tier.js

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTier, extractAllTiers, VALID_TIERS } from '../backend/tier-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// ─── Casos sintéticos ──────────────────────────────────────────────
const cases = [
  // Casos canônicos com '+'
  { input: 'Etapa - 12FD-G1+', expected: 'G1+' },
  { input: 'Circuito Nacional CBT Infantojuvenil de Tênis - 2ª Etapa Belo Horizonte - 12FD-G1+', expected: 'G1+' },
  { input: 'G1+ Open de Tênis', expected: 'G1+' },
  { input: 'Aberto - 12F G2+', expected: 'G2+' },
  { input: 'Torneio - GA+ Brasília', expected: 'GA+' },

  // Casos canônicos sem '+'
  { input: 'Brazilian Car G3 - 12F', expected: 'G3' },
  { input: 'Etapa Goiânia G2', expected: 'G2' },
  { input: 'CIRCUITO BRAZILIAN CAR DE TENIS JUVENIL - G3 - 12F', expected: 'G3' },
  { input: 'GA Aberto', expected: 'GA' },

  // Casos limítrofes — não deve confundir G1 com G1+
  { input: 'Torneio G1', expected: 'G1' },
  { input: 'Torneio G1+', expected: 'G1+' },
  { input: 'G1 e G3 mistos', expected: 'G1' }, // pega o primeiro encontrado: GA+/G1+/G2+/G3+ depois GA/G1/G2/G3

  // Sinônimos vagos NÃO devem auto-mapear pra tier (princípio conservador 2026-05-08).
  // Tier real desses torneios vem do catálogo TI, não do nome. Detector retorna null.
  { input: 'Brasileirão 2025', expected: null },
  { input: 'Circuito Nacional CBT - 12F', expected: null },
  { input: 'Campeonato Brasileiro de Tênis', expected: null },
  { input: 'Federação Brasiliense - 12F', expected: null },

  // Edge cases
  { input: '', expected: null },
  { input: null, expected: null },
  { input: undefined, expected: null },
  { input: 'Torneio sem tier', expected: null },
  { input: 'G4 não existe', expected: null },

  // Não deve casar números aleatórios
  { input: 'Torneio número 12 G7+', expected: null },
  { input: 'AGRUPAMENTO 1', expected: null },

  // CASE SENSITIVITY — palavras com "ga" minúsculo NÃO devem casar
  { input: 'joga em Brasília', expected: null },
  { input: 'amiga da Anna', expected: null },
  { input: 'Gavião (apelido)', expected: null },
  { input: 'prega o backhand', expected: null },
  { input: 'Aberto GAVIÃO de Tênis', expected: null },  // GAV — não tier
  { input: 'GAS Sport Club', expected: null },           // GAS — não tier
  { input: 'Liga Pega-Solta', expected: null },          // -ga não é tier

  // Combinações com GA+
  { input: 'GA+ Open Internacional', expected: 'GA+' },
  { input: 'Aberto GA+ - 12F', expected: 'GA+' },
  { input: 'Sergipe GA+', expected: 'GA+' },              // GA+ no fim
  { input: 'GA/GA+ Brasileirão Juvenil', expected: 'GA+' }, // mais específico ganha
  { input: 'Aberto - 12F-GA+', expected: 'GA+' },         // colado em categoria

  // Múltiplos tiers no mesmo texto — GA+ tem prioridade na ordem de busca
  { input: 'Etapa G1+ e G3 mistos', expected: 'G1+' },
  { input: 'Etapa G1 e G3 mistos', expected: 'G1' },           // G1 antes de G3 na ordem
  { input: 'GA/GA+ Brasileirão Juvenil', expected: 'GA+' },    // GA+ primeiro na ordem
  { input: 'Etapa G1, Categoria G1+ premium', expected: 'G1+' }, // G1+ antes de G1 na ordem

  // Pesquisa em múltiplos textos (variadic)
  // Quando passa nome E observações, deve combinar busca
];

// Testes variádicos (extractTier aceita múltiplos textos)
const variadicCases = [
  // Tier no nome
  { args: ['Etapa G3 - 12F', 'sem tier nas observações'], expected: 'G3' },
  // Tier nas observações (não no nome)
  { args: ['Brasileirão Juvenil', 'Torneio GA+ oficial'], expected: 'GA+' },
  // Tier em ambos: prioridade pra '+'
  { args: ['Etapa G1', 'Categoria G1+ premium'], expected: 'G1+' },
  // Vazio / null em alguns args
  { args: ['', null, undefined, 'GA Open'], expected: 'GA' },
  // Nenhum dos textos tem tier
  { args: ['Brasileirão', 'Sem informação de tier'], expected: null },
];

let pass = 0, fail = 0;
console.log('=== Testes sintéticos (single-arg) ===');
for (const c of cases) {
  const result = extractTier(c.input);
  const ok = result === c.expected;
  if (ok) {
    pass++;
    console.log(`  ✓ "${c.input || '(empty)'}" → ${result}`);
  } else {
    fail++;
    console.log(`  ✗ "${c.input || '(empty)'}" → ${result} (esperado: ${c.expected})`);
  }
}

console.log('\n=== Testes variádicos (múltiplos textos) ===');
for (const c of variadicCases) {
  const result = extractTier(...c.args);
  const ok = result === c.expected;
  if (ok) {
    pass++;
    console.log(`  ✓ ${JSON.stringify(c.args.map(a => a || '(null)'))} → ${result}`);
  } else {
    fail++;
    console.log(`  ✗ ${JSON.stringify(c.args)} → ${result} (esperado: ${c.expected})`);
  }
}
console.log('\n=== Testes extractAllTiers (plural — pra etiquetas do quadro) ===');
const allTiersCases = [
  // 1 tier só → array de 1
  { args: ['Etapa G3 - 12F'], expected: ['G3'] },
  { args: ['GA+ Open'], expected: ['GA+'] },

  // Múltiplos tiers no mesmo texto
  { args: ['Etapa G1+ e G3 mistos'], expected: ['G1+', 'G3'] },
  { args: ['GA/GA+ Brasileirão Juvenil'], expected: ['GA+', 'GA'] },
  { args: ['Etapa G1, Categoria G1+ premium'], expected: ['G1+', 'G1'] },
  { args: ['Aberto - 12F-G2+ e 14F-G3+'], expected: ['G2+', 'G3+'] },

  // Variádico
  { args: ['Etapa G1', 'Observações: também G2'], expected: ['G1', 'G2'] },
  { args: ['Brasileirão', 'Observações: GA+ oficial'], expected: ['GA+'] },

  // Vazio
  { args: ['Sem tier'], expected: [] },
  { args: [], expected: [] },
];
for (const c of allTiersCases) {
  const result = extractAllTiers(...c.args);
  const ok = JSON.stringify(result) === JSON.stringify(c.expected);
  if (ok) {
    pass++;
    console.log(`  ✓ ${JSON.stringify(c.args)} → [${result.join(', ')}]`);
  } else {
    fail++;
    console.log(`  ✗ ${JSON.stringify(c.args)} → [${result.join(', ')}] (esperado: [${c.expected.join(', ')}])`);
  }
}

console.log(`\n${pass}/${pass + fail} passaram\n`);

// ─── Regressão contra dados reais ──────────────────────────────────
console.log('=== Regressão sobre torneios reais (synced.json) ===');
const profileDirs = readdirSync(DATA_DIR).filter(d => d.startsWith('profile-'));
let realTested = 0;
let realCriticalDivergence = 0;
let realFallbackOK = 0;
const divergences = [];

for (const profileDir of profileDirs) {
  const syncedFile = join(DATA_DIR, profileDir, 'synced.json');
  let synced;
  try { synced = JSON.parse(readFileSync(syncedFile, 'utf8')); }
  catch { continue; }

  const tournaments = synced.tournaments || [];
  for (const t of tournaments) {
    if (!t.name) continue;
    realTested++;
    const detected = extractTier(t.name);
    const stored = t.tier;

    // CASOS:
    //   - synced=null, detected=null    → nada a verificar (skip)
    //   - synced=X,    detected=X       → ✓ consistente
    //   - synced=X,    detected=null    → tier não está no nome, mas TI achou via
    //                                     catálogo. OK — extractTier é fallback.
    //   - synced=null, detected=X       → ATENÇÃO: extractTier acha algo que TI
    //                                     não declarou. Pode ser falso-positivo.
    //   - synced=X,    detected=Y (X≠Y) → DIVERGÊNCIA CRÍTICA — é bug.

    if (stored && detected && detected !== stored) {
      // Caso legítimo: detector achou versão "+" (mais específica) e synced
      // tem só o base. Provavelmente cadastro manual falhou em registrar +.
      // Trata como aviso, não erro.
      const isVariantUpgrade = detected.endsWith('+') &&
                               stored === detected.replace('+', '');
      if (isVariantUpgrade) {
        divergences.push({ name: t.name, stored, detected, severity: 'detector mais específico' });
      } else {
        realCriticalDivergence++;
        divergences.push({ name: t.name, stored, detected, severity: 'CRÍTICO' });
      }
    } else if (!stored && detected) {
      // Falso-positivo possível — mas pode ser apenas tier não populado pelo catalog
      divergences.push({ name: t.name, stored, detected, severity: 'verificar' });
    } else if (stored && !detected) {
      // OK — o nome não declara tier, mas TI sabe via catalog. Comportamento esperado.
      realFallbackOK++;
    }
  }
}

console.log(`Total testado: ${realTested} torneios`);
console.log(`Casos onde detector é fallback (synced tem, name não): ${realFallbackOK} (esperado)`);
console.log(`Divergências críticas (synced=X, detector=Y, X≠Y): ${realCriticalDivergence}`);
console.log(`Falsos-positivos potenciais (synced=null, detector=X): ${divergences.filter(d => d.severity === 'verificar').length}`);

if (divergences.length) {
  const critical = divergences.filter(d => d.severity === 'CRÍTICO');
  if (critical.length) {
    console.log('\n❌ DIVERGÊNCIAS CRÍTICAS:');
    for (const d of critical) {
      console.log(`  "${d.name.slice(0, 70)}" — synced: ${d.stored}, detector: ${d.detected}`);
    }
  }
  const possible = divergences.filter(d => d.severity === 'verificar').slice(0, 5);
  if (possible.length) {
    console.log('\n⚠ Falsos-positivos potenciais (verificar manualmente):');
    for (const d of possible) {
      console.log(`  "${d.name.slice(0, 70)}" — detector: ${d.detected}`);
    }
  }
}

// ─── Saída final ──────────────────────────────────────────────────
console.log();
if (fail === 0 && realCriticalDivergence === 0) {
  console.log('✅ Detecção de tier consistente — sem divergências críticas.');
  process.exit(0);
} else {
  console.log(`⚠ Falhas: ${fail} sintéticas, ${realCriticalDivergence} divergências críticas.`);
  process.exit(1);
}
