// Testes da engine de score do tênis.
import { createMatch, applyPoint, undoLastPoint, snapshotScore, formatGamePoints } from '../backend/tennis-score.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
}

// Helper: aplica array de winners
function play(state, seq) {
  for (const w of seq) state = applyPoint(state, w);
  return state;
}

console.log('1. Game normal: 4-0 fecha game pra A');
{
  let s = createMatch({ format: 'best_of_3', firstServer: 'a' });
  s = play(s, ['a','a','a','a']);
  eq(s.currentSet.a, 1, 'A ganhou 1 game');
  eq(s.currentSet.o, 0, 'O ainda em 0');
  eq(s.server, 'o', 'saque trocou pra O após game');
  eq(s.currentGame.a, 0, 'pontos do game zerados');
}

console.log('\n2. Game normal: deuce → AD → fecha');
{
  let s = createMatch({ format: 'best_of_3', firstServer: 'a' });
  s = play(s, ['a','o','a','o','a','o']); // 40-40
  eq(formatGamePoints(s.currentGame, true), '40-40', 'chegou no 40-40');
  s = applyPoint(s, 'a');
  eq(formatGamePoints(s.currentGame, true), 'AD-40', 'AD pra A');
  s = applyPoint(s, 'o');
  eq(formatGamePoints(s.currentGame, true), '40-40', 'voltou pro deuce');
  s = applyPoint(s, 'a');
  s = applyPoint(s, 'a');
  eq(s.currentSet.a, 1, 'A fechou o game após segundo AD');
}

console.log('\n3. No-ad: 1º a 4 pontos vence');
{
  let s = createMatch({ format: 'best_of_3', firstServer: 'a', ad: false });
  s = play(s, ['a','o','a','o','a','o','a']); // 4-3 (no-ad)
  eq(s.currentSet.a, 1, 'A fechou no 4-3 (no-ad)');
}

console.log('\n4. Set: 6-0 fecha set');
{
  let s = createMatch({ format: 'best_of_3', firstServer: 'a' });
  for (let g = 0; g < 6; g++) s = play(s, ['a','a','a','a']);
  eq(s.setsHistory.length, 1, 'fechou 1 set');
  eq(s.setsHistory[0].a, 6, 'set foi 6-0');
  eq(s.currentSet.a, 0, 'currentSet zerado');
}

console.log('\n5. Tiebreak no 6-6: 7 pontos com 2 de vantagem');
{
  let s = createMatch({ format: 'best_of_3', firstServer: 'a' });
  // 6 games A
  for (let g = 0; g < 6; g++) s = play(s, ['a','a','a','a']);
  // Anular: vai fechar set. Refaz pra chegar 6-6:
  s = createMatch({ format: 'best_of_3', firstServer: 'a' });
  // Padrão: alterna A/O games até 6-6 (12 games)
  for (let g = 0; g < 12; g++) {
    const winner = g % 2 === 0 ? 'a' : 'o';
    s = play(s, [winner, winner, winner, winner]);
  }
  eq(s.currentSet.a, 6, 'A com 6');
  eq(s.currentSet.o, 6, 'O com 6');
  eq(s.currentGame.mode, 'tiebreak', 'entrou em tiebreak');
  // 7-0 fecha o tiebreak
  s = play(s, ['a','a','a','a','a','a','a']);
  eq(s.setsHistory.length, 1, 'set fechado');
  eq(s.setsHistory[0].tiebreak.a, 7, 'TB foi 7-0');
  eq(s.setsHistory[0].tiebreak.o, 0, '');
}

console.log('\n6. Match best_of_3: 2 sets fecha match');
{
  let s = createMatch({ format: 'best_of_3', firstServer: 'a' });
  // 6-0 6-0
  for (let g = 0; g < 12; g++) s = play(s, ['a','a','a','a']);
  ok(s.finished, 'match finished');
  eq(s.winner, 'a', 'winner A');
  eq(s.setsHistory.length, 2, '2 sets');
}

console.log('\n7. Super-tiebreak no 3º set (best_of_3_stb)');
{
  let s = createMatch({ format: 'best_of_3_stb', firstServer: 'a' });
  // Set 1 A: 6-0
  for (let g = 0; g < 6; g++) s = play(s, ['a','a','a','a']);
  // Set 2 O: 0-6
  for (let g = 0; g < 6; g++) s = play(s, ['o','o','o','o']);
  eq(s.setsHistory.length, 2, '2 sets jogados');
  eq(s.currentGame.mode, 'super_tiebreak', '3º "set" virou super-TB');
  // Super-TB 10-0 pra A
  for (let i = 0; i < 10; i++) s = applyPoint(s, 'a');
  ok(s.finished, 'match terminou');
  eq(s.winner, 'a', 'A venceu match');
  eq(s.setsHistory[2].tiebreak.target, 10, 'super-TB target 10');
}

console.log('\n8. Saque alterna a cada game completo');
{
  let s = createMatch({ format: 'best_of_3', firstServer: 'a' });
  eq(s.server, 'a', 'inicia A');
  s = play(s, ['a','a','a','a']);
  eq(s.server, 'o', 'após 1º game troca');
  s = play(s, ['o','o','o','o']);
  eq(s.server, 'a', 'após 2º game troca');
}

console.log('\n9. Undo do último ponto');
{
  let s = createMatch({ format: 'best_of_3', firstServer: 'a' });
  s = play(s, ['a','a','a']);
  const before = JSON.stringify(snapshotScore(s));
  s = applyPoint(s, 'a'); // 4 pontos = fim do game
  s = undoLastPoint(s);
  const after = JSON.stringify(snapshotScore(s));
  eq(before, after, 'undo voltou ao estado anterior');
  eq(s.points.length, 3, 'log tem 3 pontos');
}

console.log('\n10. Pro-set 8 games: vence quem chegar a 8 com 2 de vantagem');
{
  let s = createMatch({ format: 'pro_set_8', firstServer: 'a' });
  for (let g = 0; g < 8; g++) s = play(s, ['a','a','a','a']);
  ok(s.finished, 'pro-set 8-0 fecha match');
  eq(s.winner, 'a', '');
}

console.log('\n11. one_set_match_tb: 1 set termina o match');
{
  let s = createMatch({ format: 'one_set_match_tb', firstServer: 'a' });
  for (let g = 0; g < 6; g++) s = play(s, ['a','a','a','a']);
  ok(s.finished, '6-0 fecha match em one_set_match_tb');
}

console.log('\n12. Set 7-5: fecha sem tiebreak');
{
  let s = createMatch({ format: 'best_of_3', firstServer: 'a' });
  // 5-5 → 7-5
  for (let g = 0; g < 10; g++) {
    const w = g % 2 === 0 ? 'a' : 'o';
    s = play(s, [w,w,w,w]);
  }
  eq(s.currentSet.a, 5, '5-5 antes');
  s = play(s, ['a','a','a','a']); // 6-5
  s = play(s, ['a','a','a','a']); // 7-5 fecha
  eq(s.setsHistory.length, 1, 'set fechou');
  eq(s.setsHistory[0].a, 7, 'placar 7-5');
  eq(s.setsHistory[0].o, 5, '');
}

console.log(`\n${pass} passou, ${fail} falhou.`);
if (fail > 0) process.exit(1);
