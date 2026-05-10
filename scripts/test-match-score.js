// Testes da nota 0-10 do match.
import { computeMatchScore } from '../backend/match-score.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
}

// Helper pra fabricar match com pontos
const mk = (points) => ({ points: points.map((p, i) => ({ n: i + 1, ...p })) });

console.log('1. Sem pontos: score null');
{
  const r = computeMatchScore({ points: [] });
  ok(r.score === null, 'score null quando vazio');
}

console.log('\n2. Match 100% ofensivo Anna (saca e ganha tudo)');
{
  const pts = Array(20).fill().map(() => ({ winner: 'a', stat: 'ace', server: 'a' }));
  const r = computeMatchScore(mk(pts));
  ok(r.score >= 9.5, `score alto pra 20 aces saque · veio ${r.score}`);
}

console.log('\n3. Match 100% derrota');
{
  const pts = Array(20).fill().map(() => ({ winner: 'o', stat: 'ue', server: 'a' }));
  const r = computeMatchScore(mk(pts));
  ok(r.score <= 1, `score baixo pra 20 UEs · veio ${r.score}`);
}

console.log('\n4. Match equilibrado (50/50)');
{
  const pts = [];
  for (let i = 0; i < 20; i++) {
    pts.push({ winner: i % 2 === 0 ? 'a' : 'o', stat: i % 2 === 0 ? 'winner' : 'ue', server: i % 4 < 2 ? 'a' : 'o' });
  }
  const r = computeMatchScore(mk(pts));
  ok(r.score > 4 && r.score < 6, `score próximo de 5 · veio ${r.score}`);
}

console.log('\n5. Breakdown contém valores numéricos');
{
  const pts = [
    { winner: 'a', stat: 'ace',    server: 'a' },
    { winner: 'a', stat: 'winner', server: 'a' },
    { winner: 'o', stat: 'ue',     server: 'a' },
    { winner: 'a', stat: 'winner', server: 'o' },
  ];
  const r = computeMatchScore(mk(pts));
  ok(typeof r.breakdown.pctWon.score === 'number', 'pctWon.score é número');
  ok(typeof r.breakdown.balance.score === 'number', 'balance.score é número');
  ok(typeof r.breakdown.serving.score === 'number', 'serving.score é número');
  ok(typeof r.breakdown.receiving.score === 'number', 'receiving.score é número');
}

console.log('\n6. Só pontos sacando (não recebeu ainda) — redistribui peso');
{
  const pts = Array(8).fill().map(() => ({ winner: 'a', stat: 'winner', server: 'a' }));
  const r = computeMatchScore(mk(pts));
  ok(r.breakdown.receiving.score === null, 'receiving null (sem pontos)');
  ok(r.score != null, 'score ainda calculado com peso redistribuído');
}

console.log(`\n${pass} passou, ${fail} falhou.`);
if (fail > 0) process.exit(1);
