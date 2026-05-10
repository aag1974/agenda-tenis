// Engine de pontuação de tênis. Pura (sem I/O). Aplica regra de saque
// automática (game completo → troca; tiebreak → 1 ponto inicial e
// alterna a cada 2). Suporta os formatos que aparecem na rotina da
// Anna no juvenil brasileiro:
//   - best_of_3      (melhor de 3 sets, 3º set normal)
//   - best_of_3_stb  (melhor de 3 com super-tiebreak no lugar do 3º set)
//   - one_set_match_tb (1 set + match TB)
//   - pro_set_8      (pro-set: vence quem chegar primeiro a 8 games com 2 de vantagem)
//
// Convenções:
//   - 'a' = atleta dono do scout (Anna)
//   - 'o' = oponente
//   - currentGame.points contagem interna 0..4+ (0=love, 1=15, 2=30, 3=40, 4=ad / ponto vencedor)
//     Em tiebreak/super-TB usamos contagem direta 0..n.

const FORMATS = {
  best_of_3:        { sets: 3, finalSetMode: 'normal' },
  best_of_3_stb:    { sets: 3, finalSetMode: 'super_tiebreak' },
  one_set_match_tb: { sets: 1, finalSetMode: 'normal', singleSetWithTb: true },
  pro_set_8:        { sets: 1, finalSetMode: 'proset8', singleSetProset: true },
};

// Estado inicial.
export function createMatch(config = {}) {
  const format = FORMATS[config.format] ? config.format : 'best_of_3';
  const firstServer = config.firstServer === 'o' ? 'o' : 'a';
  return {
    config: {
      format,
      ad: config.ad !== false,                            // default: ad
      firstServer,
    },
    startedAt: new Date().toISOString(),
    finished: false,
    winner: null,
    server: firstServer,
    setsHistory: [],
    currentSet: makeNewSet(format, 0),
    currentGame: { a: 0, o: 0, mode: 'normal' },          // mode: normal | tiebreak | super_tiebreak | proset8
    points: [],
  };
}

function makeNewSet(format, completedSetsCount) {
  const fmt = FORMATS[format];
  const setNumber = completedSetsCount + 1;
  let mode = 'normal';
  // Set decisivo em formato STB → super-TB no lugar do 3º set
  if (fmt.finalSetMode === 'super_tiebreak' && setNumber === fmt.sets) mode = 'super_tiebreak';
  if (fmt.finalSetMode === 'proset8') mode = 'proset8';
  return { a: 0, o: 0, mode };
}

// Aplica 1 ponto pra `winner` ('a' ou 'o'). Retorna novo state.
// O scouter clica em qualquer um dos botões coletados (Ace, Winner, UE, FE,
// DF, Return Winner, etc) e a UI já sabe se o ponto foi pra Anna ou pro
// oponente. Aqui só recebemos o vencedor + um label opcional do stat
// pra registrar no log de pontos (analytics depois).
export function applyPoint(state, winner, stat = null) {
  if (state.finished) return state;
  if (winner !== 'a' && winner !== 'o') throw new Error(`winner inválido: ${winner}`);

  const fmt = FORMATS[state.config.format];
  const next = cloneState(state);
  next.points.push({
    n: next.points.length + 1,
    ts: new Date().toISOString(),
    stat: stat || null,
    winner,
    server: next.server,
    // snapshot do score AO ENTRAR no ponto (antes de aplicar)
    snap: snapshotScore(state),
  });

  const cg = next.currentGame;
  cg[winner] += 1;

  // Verifica fim de game/tiebreak/proset
  if (cg.mode === 'normal') {
    const ended = checkGameEnded(cg, next.config.ad);
    if (ended) closeGame(next, ended, fmt);
  } else if (cg.mode === 'tiebreak' || cg.mode === 'super_tiebreak') {
    const target = cg.mode === 'super_tiebreak' ? 10 : 7;
    const ended = checkTiebreakEnded(cg, target);
    if (ended) closeTiebreakOrSet(next, ended, fmt);
    else rotateTiebreakServer(next);
  } else if (cg.mode === 'proset8') {
    // Pro-set 8: cada ponto é um game já que são pontos diretos? Não —
    // é a mesma estrutura de games, mas o set vai a 8 (com tiebreak no 8-8).
    // Aqui o "pro-set" funciona internamente como games normais; quando
    // alcança 8-8 vira tiebreak; quem chegar primeiro a 8 (com 2 de vantagem)
    // vence. Tratamos junto com modo normal pra não duplicar lógica.
    const ended = checkGameEnded(cg, next.config.ad);
    if (ended) closeGame(next, ended, fmt);
  }

  return next;
}

function checkGameEnded(cg, useAd) {
  // No-ad: 1º a 4 pontos vence. Ad: 4 com 2 de vantagem.
  if (!useAd) {
    if (cg.a >= 4 && cg.a > cg.o) return 'a';
    if (cg.o >= 4 && cg.o > cg.a) return 'o';
    return null;
  }
  if (cg.a >= 4 && cg.a - cg.o >= 2) return 'a';
  if (cg.o >= 4 && cg.o - cg.a >= 2) return 'o';
  return null;
}

function closeGame(state, gameWinner, fmt) {
  state.currentSet[gameWinner] += 1;
  state.currentGame = { a: 0, o: 0, mode: state.currentSet.mode === 'proset8' ? 'proset8' : 'normal' };
  // Troca saque
  state.server = state.server === 'a' ? 'o' : 'a';

  // Verifica fim de set
  const setEnded = checkSetEnded(state.currentSet);
  if (setEnded === 'tiebreak') {
    // Entra em tiebreak normal de set (7 pts)
    state.currentGame = { a: 0, o: 0, mode: 'tiebreak' };
    // Saque do tiebreak: quem ESTAVA pra sacar (já trocou acima); 1 ponto e alterna
  } else if (setEnded === 'proset_tb') {
    state.currentGame = { a: 0, o: 0, mode: 'tiebreak' };
  } else if (setEnded === 'a' || setEnded === 'o') {
    closeSet(state, setEnded, fmt);
  }
}

function checkSetEnded(cs) {
  if (cs.mode === 'super_tiebreak') return null; // não usa games
  if (cs.mode === 'proset8') {
    if (cs.a >= 8 && cs.a - cs.o >= 2) return 'a';
    if (cs.o >= 8 && cs.o - cs.a >= 2) return 'o';
    if (cs.a === 8 && cs.o === 8) return 'proset_tb';
    return null;
  }
  // Set normal: 6 com 2 de vantagem; 7 fecha (incluindo 7-5); 6-6 vira tiebreak
  if (cs.a >= 6 && cs.a - cs.o >= 2) return 'a';
  if (cs.o >= 6 && cs.o - cs.a >= 2) return 'o';
  if (cs.a === 7 && cs.o === 5) return 'a';
  if (cs.o === 7 && cs.a === 5) return 'o';
  if (cs.a === 6 && cs.o === 6) return 'tiebreak';
  return null;
}

function checkTiebreakEnded(cg, target) {
  if (cg.a >= target && cg.a - cg.o >= 2) return 'a';
  if (cg.o >= target && cg.o - cg.a >= 2) return 'o';
  return null;
}

function rotateTiebreakServer(state) {
  // Em tiebreak, depois do 1º ponto alterna a cada 2 pontos.
  // Total de pontos do TB já jogados ANTES da rotação = a+o (já incrementado).
  const total = state.currentGame.a + state.currentGame.o;
  // Trocas acontecem nos pontos de número ímpar acumulado (1, 3, 5, ...)
  if (total % 2 === 1) {
    state.server = state.server === 'a' ? 'o' : 'a';
  }
}

function closeTiebreakOrSet(state, winner, fmt) {
  if (state.currentSet.mode === 'super_tiebreak') {
    // Super-TB substitui set inteiro
    state.setsHistory.push({
      a: winner === 'a' ? 1 : 0, // representação simbólica (1-0 ou 0-1) do "set" decidido por TB10
      o: winner === 'o' ? 1 : 0,
      tiebreak: { a: state.currentGame.a, o: state.currentGame.o, target: 10 },
      mode: 'super_tiebreak',
    });
    finishMatch(state, winner, fmt);
    return;
  }
  // Tiebreak de set normal (6-6 → 7 pts)
  // O game count do TB conta como 1 pra quem ganhou
  state.currentSet[winner] += 1;
  state.setsHistory.push({
    a: state.currentSet.a,
    o: state.currentSet.o,
    tiebreak: { a: state.currentGame.a, o: state.currentGame.o, target: 7 },
    mode: state.currentSet.mode,
  });
  // Saque do próximo set: quem NÃO sacou no 1º ponto do TB
  // (regra ITF: troca após o tiebreak)
  state.server = state.server === 'a' ? 'o' : 'a';
  startNextSetOrFinishMatch(state, winner, fmt);
}

function closeSet(state, winner, fmt) {
  state.setsHistory.push({
    a: state.currentSet.a,
    o: state.currentSet.o,
    tiebreak: null,
    mode: state.currentSet.mode,
  });
  startNextSetOrFinishMatch(state, winner, fmt);
}

function startNextSetOrFinishMatch(state, lastSetWinner, fmt) {
  // Conta sets vencidos por cada
  const setsA = state.setsHistory.filter(s => s.a > s.o || (s.tiebreak && s.tiebreak.a > s.tiebreak.o)).length;
  const setsO = state.setsHistory.length - setsA;
  const targetSets = Math.ceil(fmt.sets / 2);
  if (setsA >= targetSets || setsO >= targetSets) {
    finishMatch(state, setsA > setsO ? 'a' : 'o', fmt);
    return;
  }
  // Próximo set
  state.currentSet = makeNewSet(state.config.format, state.setsHistory.length);
  state.currentGame = { a: 0, o: 0, mode: state.currentSet.mode === 'super_tiebreak' ? 'super_tiebreak' : (state.currentSet.mode === 'proset8' ? 'proset8' : 'normal') };
}

function finishMatch(state, winner, fmt) {
  state.finished = true;
  state.winner = winner;
  state.endedAt = new Date().toISOString();
}

// Desfaz o último ponto (pop do log + reaplica do zero).
// Estratégia simples e robusta: replay completo. Custo O(N) por undo,
// mas N é pequeno (~150 pontos por match no máximo).
export function undoLastPoint(state) {
  if (!state.points.length) return state;
  const newConfig = { ...state.config };
  let s = createMatch(newConfig);
  // copia o startedAt original
  s.startedAt = state.startedAt;
  const replay = state.points.slice(0, -1);
  for (const p of replay) {
    s = applyPoint(s, p.winner, p.stat);
  }
  return s;
}

// Helpers de exibição.
export function formatGamePoints(cg, ad) {
  if (cg.mode === 'tiebreak' || cg.mode === 'super_tiebreak') {
    return `${cg.a}-${cg.o}`;
  }
  // Game normal
  const labels = ['0', '15', '30', '40'];
  if (cg.a < 4 && cg.o < 4) return `${labels[cg.a]}-${labels[cg.o]}`;
  if (cg.a >= 3 && cg.o >= 3) {
    if (cg.a === cg.o) return ad ? '40-40' : '0-0'; // no-ad nunca chega aqui
    if (cg.a === cg.o + 1) return 'AD-40';
    if (cg.o === cg.a + 1) return '40-AD';
  }
  return `${cg.a}-${cg.o}`; // fallback
}

export function snapshotScore(state) {
  return {
    sets: state.setsHistory.map(s => ({ a: s.a, o: s.o, tb: s.tiebreak ? `${s.tiebreak.a}-${s.tiebreak.o}` : null })),
    currentSetGames: { a: state.currentSet.a, o: state.currentSet.o },
    currentGame: formatGamePoints(state.currentGame, state.config.ad),
    server: state.server,
    finished: state.finished,
    winner: state.winner,
  };
}

function cloneState(state) {
  return {
    ...state,
    setsHistory: state.setsHistory.map(s => ({ ...s, tiebreak: s.tiebreak ? { ...s.tiebreak } : null })),
    currentSet: { ...state.currentSet },
    currentGame: { ...state.currentGame },
    points: state.points.slice(),
  };
}
