// Analytics — orquestra Glicko-2 e computa indicadores derivados pro report.
//
// Pipeline:
//   1. Carrega matches do storage
//   2. Filtra: nada de WOs, nada de duplas (singles only — Glicko-2 não
//      modela bem times de 2; quando virar relevante, fazemos com BT)
//   3. Ordena cronologicamente
//   4. Roda Glicko-2 sequencial — cada match atualiza Anna E o oponente
//   5. Tracks rating history da Anna pro sparkline
//   6. Computa Expected wins (Σ E_i) vs Realized (Σ s_i)
//   7. Identifica top surpresas (matches onde |s_i - E_i| é grande)

import { newPlayer, updatePlayer, winProbability } from './glicko.js';

// Score: 1 (vitória do atleta), 0 (derrota). Empate = 0.5 (não usado no tênis).
function scoreFor(match) {
  return match.result === 'W' ? 1 : 0;
}

// Filtra matches válidos pra análise estatística:
// - exclui WOs (não foram jogados de fato — ruído sem informação real)
// - exclui duplas (Glicko não modela bem; análise separada futura via BT)
// - exclui matches sem oponentId (sem ID = não conseguimos rastrear oponente)
// - exclui matches sem resultado claro (V/D)
function isAnalyzable(match) {
  if (match.wo) return false;
  if (match.isDoubles) return false;
  if (!match.opponentId) return false;
  if (match.result !== 'W' && match.result !== 'L') return false;
  return true;
}

// Constrói chave cronológica pra ordenação. Usa endDate (data fim do
// torneio = data aproximada do match), com fallback no startDate.
function matchSortKey(m) {
  // "dd/mm/yyyy" → "yyyy-mm-dd"
  const d = m.endDate || m.startDate || '';
  if (!d) return '';
  const parts = d.split('/');
  if (parts.length !== 3) return d;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

// Roda análise completa sobre um array de matches (já carregado do storage).
// Retorna estrutura pronta pra serializar e mandar pro frontend.
export function analyzeMatches(rawMatches, athleteId) {
  const valid = rawMatches.filter(isAnalyzable);
  const excluded = {
    wo:        rawMatches.filter(m => m.wo).length,
    doubles:   rawMatches.filter(m => m.isDoubles && !m.wo).length,
    noOppId:   rawMatches.filter(m => !m.opponentId && !m.wo && !m.isDoubles).length,
    noResult:  rawMatches.filter(m => m.result !== 'W' && m.result !== 'L' && !m.wo).length,
  };

  // Ordena cronologicamente — matches mais antigos primeiro
  const sorted = [...valid].sort((a, b) => matchSortKey(a).localeCompare(matchSortKey(b)));

  // Estado: rating de cada jogador (Anna + cada oponente)
  let athlete = newPlayer();  // Anna inicia em 1500/350/0.06
  const opponentRatings = new Map();  // opponentId → { r, rd, sigma }

  // History de updates da Anna pro sparkline
  const ratingHistory = [{
    date: null,
    matchId: null,
    r: athlete.r,
    rd: athlete.rd,
    label: 'Início',
  }];

  // Análise por match — pra cada um, expected score (antes do match) + delta
  const matchAnalysis = [];

  let expectedTotal = 0;
  let realizedTotal = 0;

  for (const m of sorted) {
    const oppKey = m.opponentId;
    if (!opponentRatings.has(oppKey)) {
      opponentRatings.set(oppKey, newPlayer());
    }
    const opp = opponentRatings.get(oppKey);

    // Expected score ANTES do match (snapshot dos ratings atuais)
    const expected = winProbability(athlete, opp);
    const actual = scoreFor(m);
    const surprise = actual - expected;

    expectedTotal += expected;
    realizedTotal += actual;

    matchAnalysis.push({
      id: m.id,
      date: matchSortKey(m),
      tournamentName: m.tournamentName,
      tier: m.tier,
      round: m.round,
      opponentId: oppKey,
      opponentName: m.opponentName,
      opponentRatingBefore: Math.round(opp.r),
      opponentRdBefore: Math.round(opp.rd),
      athleteRatingBefore: Math.round(athlete.r),
      athleteRdBefore: Math.round(athlete.rd),
      expectedScore: expected,
      actualScore: actual,
      surprise,
      result: m.result,
      scoreRaw: m.scoreRaw,
    });

    // Update ambos os jogadores (1 match no período pra cada)
    const newAthlete = updatePlayer(athlete, [{ opponent: opp, score: actual }]);
    const newOpp = updatePlayer(opp, [{ opponent: athlete, score: 1 - actual }]);
    athlete = newAthlete;
    opponentRatings.set(oppKey, newOpp);

    ratingHistory.push({
      date: matchSortKey(m),
      matchId: m.id,
      r: athlete.r,
      rd: athlete.rd,
      label: `vs ${m.opponentName}`,
    });
  }

  // Top surpresas — ordena por |surprise| descrescente
  const surprisesSorted = [...matchAnalysis].sort((a, b) => Math.abs(b.surprise) - Math.abs(a.surprise));
  const topPositive = surprisesSorted.filter(m => m.surprise > 0).slice(0, 3);
  const topNegative = surprisesSorted.filter(m => m.surprise < 0).slice(0, 3);

  // Performance vs ranking do oponente (qualitativa por agora — raw rating do oponente)
  // Buckets: oponente forte (r ≥ atleta + 100), parelho (-100 a +100), fraco (≤ -100)
  const buckets = { strong: { w: 0, l: 0 }, even: { w: 0, l: 0 }, weak: { w: 0, l: 0 } };
  for (const m of matchAnalysis) {
    const diff = m.opponentRatingBefore - m.athleteRatingBefore;
    let bucket;
    if (diff >= 100) bucket = 'strong';
    else if (diff <= -100) bucket = 'weak';
    else bucket = 'even';
    if (m.actualScore === 1) buckets[bucket].w++;
    else buckets[bucket].l++;
  }

  // Total wins/losses
  const wins = matchAnalysis.filter(m => m.actualScore === 1).length;
  const losses = matchAnalysis.filter(m => m.actualScore === 0).length;

  // Standard error around expected — útil pra dizer "underperformou X σ"
  // var(realized) ≈ Σ E_i (1 - E_i)
  let varSum = 0;
  for (const m of matchAnalysis) varSum += m.expectedScore * (1 - m.expectedScore);
  const stdError = Math.sqrt(varSum);
  const zScore = stdError > 0 ? (realizedTotal - expectedTotal) / stdError : 0;

  // Forma — 3 janelas temporais (90d, 12m, all-time). Permite narrar
  // "está em ascensão" / "estável" / "em queda" e mostrar tile comparativo.
  const today = new Date();
  const daysAgo = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  const cutoff90 = daysAgo(90);
  const cutoff365 = daysAgo(365);
  const matchDate = (m) => m.date ? new Date(m.date) : null;
  const inWindow = (m, cutoff) => {
    const d = matchDate(m);
    return d && d >= cutoff;
  };
  const window = (filterFn) => {
    const ms = matchAnalysis.filter(filterFn);
    const w = ms.filter(m => m.actualScore === 1).length;
    const l = ms.length - w;
    return {
      total: ms.length,
      wins: w,
      losses: l,
      winRate: ms.length > 0 ? (w / ms.length) * 100 : 0,
    };
  };
  const forma = {
    last90:  window(m => inWindow(m, cutoff90)),
    last365: window(m => inWindow(m, cutoff365)),
    allTime: window(_ => true),
  };

  // ─── Confrontos recorrentes (head-to-head) ─────────────────────────
  // Adversárias enfrentadas 2+ vezes em singles. Pra cada uma, lista
  // cronológica de matches com resultado, score, contexto.
  const opponentMatchesMap = new Map();
  for (const m of sorted) {
    const orig = rawMatches.find(x => x.id === m.id);
    if (!orig) continue;
    const key = orig.opponentName;
    if (!opponentMatchesMap.has(key)) opponentMatchesMap.set(key, []);
    opponentMatchesMap.get(key).push(orig);
  }
  const recurrentOpponents = [];
  for (const [name, ms] of opponentMatchesMap.entries()) {
    if (ms.length < 2) continue;
    const w = ms.filter(m => m.result === 'W').length;
    const l = ms.length - w;
    recurrentOpponents.push({
      name,
      matches: ms,
      wins: w,
      losses: l,
      total: ms.length,
      lastDate: ms[ms.length - 1].endDate,
      firstDate: ms[0].endDate,
    });
  }
  // Ordena: positivos primeiro (saldo positivo, mais frequentes), depois 0V
  recurrentOpponents.sort((a, b) => {
    const sa = a.wins - a.losses;
    const sb = b.wins - b.losses;
    if (sb !== sa) return sb - sa;
    return b.total - a.total;
  });

  // ─── Padrões temporais ───────────────────────────────────────────────
  // Distribuição mensal das partidas singles
  const monthlyMatches = {};  // 'YYYY-MM' → { wins, losses }
  for (const m of sorted) {
    const orig = rawMatches.find(x => x.id === m.id);
    if (!orig?.endDate) continue;
    const [d, mo, y] = orig.endDate.split('/');
    const k = `${y}-${mo}`;
    if (!monthlyMatches[k]) monthlyMatches[k] = { wins: 0, losses: 0 };
    if (orig.result === 'W') monthlyMatches[k].wins++;
    else monthlyMatches[k].losses++;
  }

  // Wald-Wolfowitz runs test
  // Sorted é array de raw matches (não matchAnalysis). Usa .result.
  const seq = sorted.map(m => m.result === 'W' ? 'W' : 'L').join('');
  let runs = 1;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] !== seq[i - 1]) runs++;
  }
  const n1 = wins, n2 = losses;
  let wwExpected = null, wwZ = null, wwSig = null;
  if (n1 > 0 && n2 > 0) {
    wwExpected = (2 * n1 * n2) / (n1 + n2) + 1;
    const varRuns = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) /
                    ((n1 + n2) * (n1 + n2) * (n1 + n2 - 1));
    wwZ = varRuns > 0 ? (runs - wwExpected) / Math.sqrt(varRuns) : null;
    wwSig = wwZ != null && Math.abs(wwZ) >= 1.96;
  }

  // Maior sequência de vitórias e derrotas
  let maxWStreak = 0, maxLStreak = 0;
  let curStreak = 0, curType = null;
  for (const m of sorted) {
    const t = m.result === 'W' ? 'W' : 'L';
    if (t === curType) curStreak++;
    else { curStreak = 1; curType = t; }
    if (curType === 'W' && curStreak > maxWStreak) maxWStreak = curStreak;
    if (curType === 'L' && curStreak > maxLStreak) maxLStreak = curStreak;
  }

  // Ritmo entre torneios
  const tournamentDates = [...new Set(sorted.map(m => {
    const orig = rawMatches.find(x => x.id === m.id);
    return orig?.endDate;
  }).filter(Boolean))].sort((a, b) =>
    a.split('/').reverse().join('').localeCompare(b.split('/').reverse().join(''))
  );
  const intervalsDays = [];
  for (let i = 1; i < tournamentDates.length; i++) {
    const [d1, m1, y1] = tournamentDates[i - 1].split('/').map(Number);
    const [d2, m2, y2] = tournamentDates[i].split('/').map(Number);
    const dt1 = new Date(y1, m1 - 1, d1);
    const dt2 = new Date(y2, m2 - 1, d2);
    intervalsDays.push(Math.round((dt2 - dt1) / (1000 * 60 * 60 * 24)));
  }
  const medianInterval = intervalsDays.length
    ? [...intervalsDays].sort((a, b) => a - b)[Math.floor(intervalsDays.length / 2)]
    : null;

  const temporal = {
    monthlyMatches,
    runsTest: { runs, expected: wwExpected, z: wwZ, significant: wwSig, sequence: seq },
    streaks: { maxW: maxWStreak, maxL: maxLStreak },
    rhythm: {
      medianIntervalDays: medianInterval,
      minIntervalDays: intervalsDays.length ? Math.min(...intervalsDays) : null,
      maxIntervalDays: intervalsDays.length ? Math.max(...intervalsDays) : null,
      tournamentCount: tournamentDates.length,
    },
  };

  // ─── Distribuição de placares ────────────────────────────────────────
  const scoreHistogram = {};
  for (const m of sorted) {
    const orig = rawMatches.find(x => x.id === m.id);
    if (!orig?.sets) continue;
    for (const s of orig.sets) {
      const key = `${s[0]}-${s[1]}`;
      if (!scoreHistogram[key]) scoreHistogram[key] = 0;
      scoreHistogram[key]++;
    }
  }

  // ─── Derrota mais apertada (closest loss) ───────────────────────────
  // Critério: derrota com menor diferença total de games. Ranqueia todas as
  // derrotas pela proximidade e pega a mais apertada que NÃO seja já
  // destacada como topNegative (evita redundância narrativa).
  const lossesRanked = [];
  for (const m of sorted) {
    if (m.result !== 'L') continue;
    if (!m.sets || m.sets.length === 0) continue;
    let totalFor = 0, totalAgainst = 0;
    for (const s of m.sets) {
      totalFor += s[0];
      totalAgainst += s[1];
    }
    const diff = Math.abs(totalAgainst - totalFor);
    lossesRanked.push({
      id: m.id,
      date: m.endDate,
      opponentName: m.opponentName,
      tournamentName: m.tournamentName,
      round: m.round,
      scoreRaw: m.scoreRaw,
      gameDiff: diff,
      hasSuperTiebreak: m.hasSuperTiebreak,
      // Campos pra narrativa enriquecida (separa games regulares vs super-TB)
      sets: m.sets,
      setsWonAthlete: m.setsWonAthlete,
      setsWonOpponent: m.setsWonOpponent,
      gamesWonAthlete: m.gamesWonAthlete,
      gamesWonOpponent: m.gamesWonOpponent,
      tier: m.tier,
    });
  }
  lossesRanked.sort((a, b) => a.gameDiff - b.gameDiff);
  const topNegId = topNegative[0]?.id;
  const tightestLoss = lossesRanked.find(l => l.id !== topNegId) || lossesRanked[0] || null;

  return {
    athleteId,
    athleteRating: {
      r: Math.round(athlete.r),
      rd: Math.round(athlete.rd),
      sigma: Number(athlete.sigma.toFixed(4)),
      ci95: {
        lower: Math.round(athlete.r - 1.96 * athlete.rd),
        upper: Math.round(athlete.r + 1.96 * athlete.rd),
      },
    },
    counts: {
      analyzed: matchAnalysis.length,
      wins,
      losses,
      excluded,
    },
    expected: {
      wins: Number(expectedTotal.toFixed(2)),
      losses: Number((matchAnalysis.length - expectedTotal).toFixed(2)),
      stdError: Number(stdError.toFixed(2)),
    },
    realized: {
      wins,
      losses,
    },
    over_under: {
      delta: Number((realizedTotal - expectedTotal).toFixed(2)),
      zScore: Number(zScore.toFixed(2)),
      // Heurística: |z| ≥ 1.96 = significante a 95%
      significant: Math.abs(zScore) >= 1.96,
    },
    bucketPerformance: buckets,
    forma,
    recurrentOpponents,
    temporal,
    scoreHistogram,
    tightestLoss,
    ratingHistory: ratingHistory.map(h => ({
      ...h,
      r: Math.round(h.r),
      rd: Math.round(h.rd),
    })),
    topSurprises: {
      positive: topPositive.map(m => ({
        date: m.date,
        opponentName: m.opponentName,
        opponentRatingBefore: m.opponentRatingBefore,
        ratingDiff: m.opponentRatingBefore - m.athleteRatingBefore,
        expectedWinPct: Number((m.expectedScore * 100).toFixed(1)),
        result: m.result,
        scoreRaw: m.scoreRaw,
        tournamentName: m.tournamentName,
        round: m.round,
      })),
      negative: topNegative.map(m => ({
        date: m.date,
        opponentName: m.opponentName,
        opponentRatingBefore: m.opponentRatingBefore,
        ratingDiff: m.opponentRatingBefore - m.athleteRatingBefore,
        expectedWinPct: Number((m.expectedScore * 100).toFixed(1)),
        result: m.result,
        scoreRaw: m.scoreRaw,
        tournamentName: m.tournamentName,
        round: m.round,
      })),
    },
  };
}
