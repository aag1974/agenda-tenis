// Métricas proprietárias derivadas de placar (não só V/D).
// Princípio: tirar o relatório da dependência total do binário ganhou/perdeu
// e ler texturas competitivas reais — dominância, clutch, resiliência.
//
// Saída de cada métrica: { score 0-100, components } pra renderização e
// pra alimentar o "DNA competitivo".

function matchSortKey(m) {
  const d = m.endDate || m.startDate || '';
  if (!d) return '';
  const parts = d.split('/');
  if (parts.length !== 3) return d;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

// ─── Competitive Dominance Index ────────────────────────────────────────
// Quanto "trituradoras" são as vitórias e quão eficiente o atleta é em games.
//   - dominantRate: fração de sets vencidos com ≤2 games cedidos (6-0/6-1/6-2)
//   - gameWinRate:  games ganhos / total de games em sets normais
//   - avgWonMargin: margem média por set vencido (6-X → 6-X)
// Composto: 40% dominantRate + 30% gameWinRate + 30% margin normalizada.
export function computeCompetitiveDominance(matches) {
  const wonSets = [];
  let totalGamesWon = 0, totalGamesLost = 0;

  for (const m of matches) {
    if (!m.sets || !m.sets.length) continue;
    for (const set of m.sets) {
      if (!Array.isArray(set) || set.length !== 2) continue;
      const [a, o] = set;
      // Pula super-tiebreak (placar de match-tiebreak: 10+ pontos)
      if (a >= 10 || o >= 10) continue;
      totalGamesWon += a;
      totalGamesLost += o;
      if (a > o) wonSets.push([a, o]);
    }
  }

  if (!wonSets.length || totalGamesWon + totalGamesLost === 0) {
    return { score: null, components: null };
  }

  const dominantSets = wonSets.filter(([, o]) => o <= 2).length;
  const dominantRate = dominantSets / wonSets.length;
  const avgWonMargin = wonSets.reduce((s, [a, o]) => s + (a - o), 0) / wonSets.length;
  const gameWinRate = totalGamesWon / (totalGamesWon + totalGamesLost);
  const normMargin = Math.min(avgWonMargin / 6, 1);

  const cdi = (dominantRate * 0.40 + gameWinRate * 0.30 + normMargin * 0.30) * 100;
  return {
    score: Math.round(cdi),
    components: {
      dominantSets,
      totalWonSets: wonSets.length,
      dominantRate: Math.round(dominantRate * 100),
      avgGameMargin: Number(avgWonMargin.toFixed(1)),
      gameWinRate: Math.round(gameWinRate * 100),
      totalGamesWon, totalGamesLost,
    },
  };
}

// ─── Clutch Score ───────────────────────────────────────────────────────
// % vitórias em momentos decisivos: tie-breaks, super-tie-breaks, sets finais
// de jogos de 3 sets (não-STB). Combina os 3 com média simples das janelas
// disponíveis (algumas podem não ter amostra).
export function computeClutchScore(matches) {
  let tbWon = 0, tbTotal = 0;            // sets terminando 7-6 / 6-7
  let stbWon = 0, stbTotal = 0;          // super-tiebreaks (10+ pontos)
  let decidingWon = 0, decidingTotal = 0; // 3º set de jogo decidido por set normal

  for (const m of matches) {
    if (!m.sets || !m.sets.length) continue;

    // Sets em tie-break (7-6 ou 6-7) — qualquer set do jogo
    for (const set of m.sets) {
      if (!Array.isArray(set) || set.length !== 2) continue;
      const [a, o] = set;
      if (a >= 10 || o >= 10) continue;
      if ((a === 7 && o === 6) || (a === 6 && o === 7)) {
        tbTotal++;
        if (a > o) tbWon++;
      }
    }

    // Set decisivo: 3º set de match com 3 sets jogados
    if (m.sets.length === 3) {
      const last = m.sets[m.sets.length - 1];
      if (Array.isArray(last) && last.length === 2) {
        const [a, o] = last;
        if (a >= 10 || o >= 10) {
          // Super-tiebreak
          stbTotal++;
          if (a > o) stbWon++;
        } else {
          // Set decisivo regular
          decidingTotal++;
          if (m.result === 'W') decidingWon++;
        }
      }
    }
  }

  const tbRate = tbTotal ? tbWon / tbTotal : null;
  const stbRate = stbTotal ? stbWon / stbTotal : null;
  const decidingRate = decidingTotal ? decidingWon / decidingTotal : null;

  const parts = [tbRate, stbRate, decidingRate].filter(x => x !== null);
  if (!parts.length) return { score: null, components: null };

  const avg = parts.reduce((s, x) => s + x, 0) / parts.length;
  return {
    score: Math.round(avg * 100),
    components: {
      tbWon, tbTotal, tbRate: tbRate !== null ? Math.round(tbRate * 100) : null,
      stbWon, stbTotal, stbRate: stbRate !== null ? Math.round(stbRate * 100) : null,
      decidingWon, decidingTotal, decidingRate: decidingRate !== null ? Math.round(decidingRate * 100) : null,
    },
  };
}

// ─── Resilience Index ───────────────────────────────────────────────────
// Capacidade de reagir a adversidade.
//   - lostFirstSetWin: % vitórias em jogos onde perdeu o 1º set
//   - h2hComebackRate: fração de adversários onde o 1º jogo foi derrota
//                      mas o saldo lifetime virou positivo (W>L)
export function computeResilience(matches, recurrentOpponents) {
  let lostFirstSetMatches = 0;
  let lostFirstSetWon = 0;

  for (const m of matches) {
    if (!m.sets || m.sets.length < 2) continue;
    const first = m.sets[0];
    if (!Array.isArray(first) || first.length !== 2) continue;
    const [a, o] = first;
    if (a < o) {
      lostFirstSetMatches++;
      if (m.result === 'W') lostFirstSetWon++;
    }
  }

  let h2hComebacks = 0;
  let h2hCandidates = 0;
  for (const opp of recurrentOpponents || []) {
    if (!opp.matches || opp.matches.length < 2) continue;
    const sorted = [...opp.matches].sort((a, b) =>
      matchSortKey(a).localeCompare(matchSortKey(b)));
    if (sorted[0]?.result === 'L') {
      h2hCandidates++;
      if (opp.wins > opp.losses) h2hComebacks++;
    }
  }

  const lostFirstWinRate = lostFirstSetMatches ? lostFirstSetWon / lostFirstSetMatches : null;
  const h2hComebackRate = h2hCandidates ? h2hComebacks / h2hCandidates : null;

  const parts = [lostFirstWinRate, h2hComebackRate].filter(x => x !== null);
  if (!parts.length) return { score: null, components: null };

  const avg = parts.reduce((s, x) => s + x, 0) / parts.length;
  return {
    score: Math.round(avg * 100),
    components: {
      lostFirstSetMatches, lostFirstSetWon,
      lostFirstWinRate: lostFirstWinRate !== null ? Math.round(lostFirstWinRate * 100) : null,
      h2hComebacks, h2hCandidates,
      h2hComebackRate: h2hComebackRate !== null ? Math.round(h2hComebackRate * 100) : null,
    },
  };
}

// ─── DNA competitivo: arquétipos derivados ──────────────────────────────
// Combina os 3 índices proprietários + buckets + win rate. Devolve até 2
// arquétipos mais distintivos pra dar IDENTIDADE ao atleta. Cada arquétipo
// tem um threshold conservador — só rotula quando há sinal claro.
export function computeArchetypes(analysis, gender = 'M') {
  const archetypes = [];
  const cdi = analysis.competitiveDominance?.score;
  const clutch = analysis.clutchScore?.score;
  const resilience = analysis.resilience?.score;
  const overall = analysis.counts || {};
  const winRate = overall.analyzed > 0 ? overall.wins / overall.analyzed : 0;
  const b = analysis.bucketPerformance || { strong: {w:0,l:0}, even: {w:0,l:0}, weak: {w:0,l:0} };

  const fracOf = (bucket) => {
    const t = bucket.w + bucket.l;
    return t > 0 ? bucket.w / t : null;
  };
  const evenRate = fracOf(b.even);
  const strongRate = fracOf(b.strong);
  const weakRate = fracOf(b.weak);
  const evenTotal = b.even.w + b.even.l;
  const strongTotal = b.strong.w + b.strong.l;
  const weakTotal = b.weak.w + b.weak.l;
  const F = gender === 'F';

  // Dominador — vitórias por margens largas
  if (cdi !== null && cdi >= 60) {
    archetypes.push({
      tag: F ? 'Dominadora' : 'Dominador',
      icon: '🔨',
      desc: 'Vitórias por margens largas. Frequência alta de sets esmagadores e saldo de games dominante.',
      weight: cdi,
    });
  }

  // Fechador — clutch alto
  if (clutch !== null && clutch >= 60) {
    archetypes.push({
      tag: F ? 'Fechadora' : 'Fechador',
      icon: '🎯',
      desc: 'Decide os jogos a seu favor nos pontos que importam: tie-breaks, super-tiebreaks e sets finais.',
      weight: clutch,
    });
  }

  // Resiliente — vira jogos
  if (resilience !== null && resilience >= 50) {
    archetypes.push({
      tag: F ? 'Resiliente' : 'Resiliente',
      icon: '🛡',
      desc: 'Reage à adversidade. Vira jogos depois de perder o primeiro set; reescreve histórico em rivalidades.',
      weight: resilience,
    });
  }

  // Escalador — vence quem está acima do próprio nível
  if (strongRate !== null && strongRate >= 0.30 && strongTotal >= 5) {
    archetypes.push({
      tag: F ? 'Escaladora' : 'Escalador',
      icon: '⛰',
      desc: 'Vence consistentemente contra adversários acima do próprio nível — sinal de subida real de patamar.',
      weight: Math.round(strongRate * 100),
    });
  }

  // Triturador de inferiores — alta % vs fracos, baixa vs parelhos
  if (weakRate !== null && weakRate >= 0.85 && evenRate !== null && evenRate < 0.45 &&
      weakTotal >= 5 && evenTotal >= 3) {
    archetypes.push({
      tag: F ? 'Trituradora de inferiores' : 'Triturador de inferiores',
      icon: '⚙',
      desc: 'Resolve com sobra contra quem está abaixo, mas ainda não fecha consistente contra parelhos. É a fronteira pro próximo patamar.',
      weight: Math.round(weakRate * 100),
    });
  }

  // Especialista parelho — vence onde é mais difícil
  if (evenRate !== null && evenRate >= 0.55 && evenTotal >= 5) {
    archetypes.push({
      tag: F ? 'Especialista em parelhas' : 'Especialista em parelhos',
      icon: '⚖',
      desc: 'Justamente onde o jogo é mais difícil de ler — contra adversários no mesmo nível — costuma sair na frente.',
      weight: Math.round(evenRate * 100),
    });
  }

  // Construtor — vence muito mas com placares apertados
  if (winRate >= 0.65 && cdi !== null && cdi > 0 && cdi < 45) {
    archetypes.push({
      tag: F ? 'Construtora' : 'Construtor',
      icon: '📐',
      desc: 'Aproveitamento alto, mas com placares apertados. Joga "no limite" — vence mais do que domina.',
      weight: Math.round(winRate * 100),
    });
  }

  // Fallback: nenhum arquétipo distintivo. Tom honesto, sem inventar tag.
  if (archetypes.length === 0) {
    const isLowSample = (overall.analyzed || 0) < 30;
    archetypes.push({
      tag: isLowSample ? 'Em construção' : 'Perfil em definição',
      icon: isLowSample ? '🌱' : '🧭',
      desc: isLowSample
        ? 'Ainda construindo histórico competitivo. O perfil vai se cristalizar com mais jogos.'
        : 'Os indicadores não apontam ainda um padrão competitivo dominante. Vale acompanhar nos próximos torneios — pequenos ajustes podem definir a vocação tática.',
      weight: 0,
    });
  }

  // Top 2 arquétipos por peso (mais distintivos)
  return archetypes
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map(({ weight, ...rest }) => rest);
}
