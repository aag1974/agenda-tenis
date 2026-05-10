// Testes da nota 0-10 do match (2 lados).
import { computeMatchScore } from '../backend/match-score.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
}

const mk = (points) => ({ points: points.map((p, i) => ({ n: i + 1, ...p })) });

console.log('1. Sem pontos: ambos scores null');
{
  const r = computeMatchScore({ points: [] });
  ok(r.a.score === null && r.o.score === null, 'scores null quando vazio');
}

console.log('\n2. Anna 100% ofensivo (saca e ganha tudo)');
{
  const pts = Array(20).fill().map(() => ({ winner: 'a', stat: 'ace', server: 'a' }));
  const r = computeMatchScore(mk(pts));
  ok(r.a.score >= 9.5, `Anna alta · veio ${r.a.score}`);
  ok(r.o.score <= 3,   `Adv baixa · veio ${r.o.score}`);
}

console.log('\n3. Adv 100% ofensivo (saca e ganha tudo)');
{
  const pts = Array(20).fill().map(() => ({ winner: 'o', stat: 'oppace', server: 'o' }));
  const r = computeMatchScore(mk(pts));
  ok(r.o.score >= 9.5, `Adv alta · veio ${r.o.score}`);
  ok(r.a.score <= 3,   `Anna baixa · veio ${r.a.score}`);
}

console.log('\n4. Match equilibrado');
{
  const pts = [];
  for (let i = 0; i < 20; i++) {
    pts.push({ winner: i % 2 === 0 ? 'a' : 'o', stat: i % 2 === 0 ? 'winner' : 'oppwinner', server: i % 4 < 2 ? 'a' : 'o' });
  }
  const r = computeMatchScore(mk(pts));
  ok(Math.abs(r.a.score - r.o.score) < 1, `scores próximos · a=${r.a.score} o=${r.o.score}`);
}

console.log('\n5. Adv errando muito beneficia Anna');
{
  const pts = Array(15).fill().map(() => ({ winner: 'a', stat: 'returnue', server: 'a' }));
  const r = computeMatchScore(mk(pts));
  ok(r.a.score >= 6, `Anna ganha (não muito alta pois é erro adv, não winner Anna) · ${r.a.score}`);
  ok(r.o.score <= 4, `Adv penalizada pelos erros · ${r.o.score}`);
}

console.log('\n6. Breakdown completo nos 2 lados');
{
  const pts = [
    { winner: 'a', stat: 'ace',        server: 'a' },
    { winner: 'a', stat: 'winner',     server: 'a' },
    { winner: 'o', stat: 'ue',         server: 'a' },
    { winner: 'a', stat: 'returnwin_a', server: 'o' },
    { winner: 'o', stat: 'oppwinner',  server: 'o' },
  ];
  const r = computeMatchScore(mk(pts));
  ok(r.a.breakdown.pctWon.score != null, 'Anna pctWon');
  ok(r.o.breakdown.pctWon.score != null, 'Adv pctWon');
  ok(r.a.breakdown.balance.score != null, 'Anna balance');
  ok(r.o.breakdown.balance.score != null, 'Adv balance');
}

console.log(`\n${pass} passou, ${fail} falhou.`);
if (fail > 0) process.exit(1);
