// Forecast: gera metas SMART pros próximos 6 e 12 meses a partir das
// métricas atuais. Princípio: alvos razoáveis (não previsão), focados nos
// pontos fracos identificados. Métricas já fortes não geram meta — só
// entram na lista "manter".
//
// Regras de progressão:
//   < 45 (em desenvolvimento): subir pro médio (50) em 6m, pro forte
//                              (60-65) em 12m
//   45-64 (médio):              +10 em 6m, +20 em 12m, com cap em 75
//   ≥ 65 (forte):               sem meta — vira "manter"
//
// Pra buckets (% de vitórias contra parelhos/fortes), regra similar
// adaptada à escala 0-100%. Pra Glicko (faixa ±X), meta é estreitar
// a incerteza com mais partidas (~75% em 6m, ~65% em 12m).

export function computeForecast(analysis) {
  const targets = [];
  const strengths = [];

  const cdi = analysis.competitiveDominance?.score;
  const clutch = analysis.clutchScore?.score;
  const res = analysis.resilience?.score;
  const r = analysis.athleteRating;
  const overall = analysis.counts || {};
  const winRate = overall.analyzed > 0
    ? Math.round((overall.wins / overall.analyzed) * 100)
    : null;
  const b = analysis.bucketPerformance || {};
  const evenTotal = (b.even?.w || 0) + (b.even?.l || 0);
  const evenRate = evenTotal >= 3 ? Math.round((b.even.w / evenTotal) * 100) : null;
  const strongTotal = (b.strong?.w || 0) + (b.strong?.l || 0);
  const strongRate = strongTotal >= 3 ? Math.round((b.strong.w / strongTotal) * 100) : null;

  // ─── Pontos fortes (sem meta — só manter) ─────────────────────────
  if (cdi !== null && cdi >= 65) {
    strengths.push({
      icon: '🔨',
      label: 'Dominância',
      value: `${cdi}/100`,
      message: 'Vence com folga — manter o padrão.',
    });
  }
  if (clutch !== null && clutch >= 65) {
    strengths.push({
      icon: '🎯',
      label: 'Clutch',
      value: `${clutch}/100`,
      message: 'Aparece nos pontos decisivos — manter.',
    });
  }
  if (res !== null && res >= 60) {
    strengths.push({
      icon: '🛡',
      label: 'Resiliência',
      value: `${res}/100`,
      message: 'Vira jogos quando começa atrás — manter.',
    });
  }
  if (winRate !== null && winRate >= 70) {
    strengths.push({
      icon: '📈',
      label: 'Aproveitamento agregado',
      value: `${winRate}%`,
      message: 'Não cair abaixo de 70% — sustentar a base.',
    });
  }
  if (strongRate !== null && strongRate >= 35 && strongTotal >= 5) {
    strengths.push({
      icon: '⛰',
      label: 'Contra adversários acima do nível',
      value: `${strongRate}% (${b.strong.w}V/${b.strong.l}D)`,
      message: 'Já vence acima do nível — sinal de subida real.',
    });
  }

  // Helper: gera target 6m/12m em escala 0-100 conforme thresholds
  const targetForScore = (current) => {
    if (current < 45) return { t6: 50, t12: 60 };
    if (current < 65) return { t6: Math.min(current + 10, 65), t12: Math.min(current + 20, 75) };
    return null; // já forte — não vira meta
  };

  // ─── Métricas a trabalhar ─────────────────────────────────────────
  // Clutch
  if (clutch !== null && clutch < 65) {
    const t = targetForScore(clutch);
    const tbComp = analysis.clutchScore?.components || {};
    const tbInfo = tbComp.tbTotal > 0
      ? `Hoje fecha ${tbComp.tbWon} de ${tbComp.tbTotal} tie-breaks (${tbComp.tbRate}%); ${tbComp.stbTotal > 0 ? `${tbComp.stbWon} de ${tbComp.stbTotal} super-tiebreaks (${tbComp.stbRate}%);` : ''} meta é elevar essas duas contagens.`
      : 'Acompanhar o índice geral à medida que mais momentos decisivos aparecem.';
    targets.push({
      id: 'clutch',
      icon: '🎯',
      label: 'Como joga quando o jogo aperta',
      shortLabel: 'Clutch',
      current: `${clutch}/100`,
      target6m: `${t.t6}/100`,
      target12m: `${t.t12}/100`,
      rationale: 'Subir significa fechar tie-breaks, super-tie-breaks e sets decisivos com mais frequência. É o que separa "compete" de "decide".',
      measurement: tbInfo,
      trainingHint: 'Trabalho específico em quadra: rotina mental nos pontos 4-4 / 5-5 / no super-tie. Vale também treino simulado com pontuação a partir de 5-5.',
    });
  }

  // Resiliência
  if (res !== null && res < 60) {
    const t = targetForScore(res);
    const resComp = analysis.resilience?.components || {};
    const lostFirst = resComp.lostFirstSetMatches > 0
      ? `Hoje vira ${resComp.lostFirstSetWon} de cada ${resComp.lostFirstSetMatches} jogos onde perde o 1º set (${resComp.lostFirstWinRate}%).`
      : 'Métrica vai ganhar volume com mais jogos.';
    targets.push({
      id: 'resilience',
      icon: '🛡',
      label: 'Como reage depois de perder um set',
      shortLabel: 'Resiliência',
      current: `${res}/100`,
      target6m: `${t.t6}/100`,
      target12m: `${t.t12}/100`,
      rationale: 'Quando o jogo começa errado, o que separa um atleta de elite é a capacidade de virar a chave entre sets — não desligar.',
      measurement: lostFirst,
      trainingHint: 'Trabalho mental: rotina de "reset" entre sets. Foco no primeiro game do segundo set como ponto-chave da virada.',
    });
  }

  // Vs Parelhos — fronteira do próximo degrau
  if (evenRate !== null && evenRate < 55 && evenTotal >= 5) {
    const t6Pct = Math.min(evenRate + 12, 50);
    const t12Pct = Math.min(evenRate + 22, 60);
    targets.push({
      id: 'vs-even',
      icon: '⚖',
      label: 'Contra rivais do mesmo nível',
      shortLabel: 'vs Parelhos',
      current: `${evenRate}% (${b.even.w}V/${b.even.l}D)`,
      target6m: `${t6Pct}%`,
      target12m: `${t12Pct}%`,
      rationale: 'Jogos contra adversários do mesmo nível são onde se ganha rating de verdade. Subir esse número é o que separa um patamar do próximo.',
      measurement: 'Cada vitória contra parelho vale mais no Glicko que duas contra adversário abaixo. A próxima edição mede de novo.',
      trainingHint: 'Sparring com atletas do mesmo nível. Atenção tática nos jogos onde o placar fica 4-4 / 5-5 — é aí que se perde mais por desfoco que por nível.',
    });
  }

  // Cobertura Glicko (faixa) — vai estreitar com mais jogos
  if (r && r.rd >= 70) {
    const ic = Math.round(r.rd * 1.96);
    const ic6m = Math.round(ic * 0.75);
    const ic12m = Math.round(ic * 0.6);
    targets.push({
      id: 'glicko-precision',
      icon: '📊',
      label: 'Precisão do nível estimado',
      shortLabel: 'Faixa Glicko',
      current: `±${ic} pts`,
      target6m: `±${ic6m} pts`,
      target12m: `±${ic12m} pts`,
      rationale: 'Quanto menor a faixa, mais firme a leitura de onde o atleta realmente está. Estreita naturalmente com mais jogos.',
      measurement: `Faixa atual: ${r.ci95.lower}–${r.ci95.upper}. Vai apertar conforme o histórico crescer.`,
      trainingHint: 'Não há trabalho específico — basta jogar. Manter calendário ativo de torneios oficiais.',
    });
  }

  return { targets, strengths };
}
