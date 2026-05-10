// Testes da nota 0-10 do match (2 lados, padrão iOnCourt).
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

console.log('\n2. Anna 100% ofensivo (saca e ganha tudo com aces)');
{
  const pts = Array(20).fill().map(() => ({ winner: 'a', stat: 'ace', server: 'a' }));
  const r = computeMatchScore(mk(pts));
  ok(r.a.score >= 9.5, `Anna alta · veio ${r.a.score}`);
  ok(r.o.score <= 3,   `Adv baixa · veio ${r.o.score}`);
}

console.log('\n3. Adv 100% ofensivo (aces dela)');
{
  const pts = Array(20).fill().map(() => ({ winner: 'o', stat: 'ace', server: 'o' }));
  const r = computeMatchScore(mk(pts));
  ok(r.o.score >= 9.5, `Adv alta · veio ${r.o.score}`);
  ok(r.a.score <= 3,   `Anna baixa · veio ${r.a.score}`);
}

console.log('\n4. Match equilibrado (rally winners alternados)');
{
  const pts = [];
  for (let i = 0; i < 20; i++) {
    pts.push({ winner: i % 2 === 0 ? 'a' : 'o', stat: 'winner', server: i % 4 < 2 ? 'a' : 'o' });
  }
  const r = computeMatchScore(mk(pts));
  ok(Math.abs(r.a.score - r.o.score) < 1, `scores próximos · a=${r.a.score} o=${r.o.score}`);
}

console.log('\n5. unforced_error: quem perdeu (winner oposto) que errou');
{
  // Anna sempre ganha porque adv erra unforced — Anna alta (% saque OK), Adv baixa (errou tudo)
  const pts = Array(10).fill().map((_, i) => ({ winner: 'a', stat: 'unforced_error', server: i % 2 === 0 ? 'a' : 'o' }));
  const r = computeMatchScore(mk(pts));
  ok(r.a.score >= 6, `Anna alta · ${r.a.score}`);
  ok(r.o.score <= 4, `Adv penalizada · ${r.o.score}`);
}

console.log('\n6. Markers (winner: null) não entram no cálculo');
{
  const pts = [
    { winner: null, stat: 'serve_fault',     server: 'a' },
    { winner: 'a',  stat: 'ace',             server: 'a' },
    { winner: null, stat: 'return_in_play',  server: 'a' },
    { winner: 'a',  stat: 'winner',          server: 'a' },
  ];
  const r = computeMatchScore(mk(pts));
  ok(r.totalPts === 2, `só pontos fechados contam · totalPts=${r.totalPts}`);
}

console.log(`\n${pass} passou, ${fail} falhou.`);
if (fail > 0) process.exit(1);
