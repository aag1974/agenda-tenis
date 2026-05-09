// Gerador de narrativas ELI5 a partir do resultado de analytics.js.
// Princípio: cada número estatístico vira uma frase que uma criança de 12 anos
// (a própria atleta!) entenderia. Sem rótulos abstratos, sem jargão.
//
// Toda regra é determinística — mesmo input gera mesmo output. Isso é o que
// permite escalar pra qualquer atleta cadastrada sem revisão manual.

// Fala em 2ª pessoa ("você") quando se dirige à atleta. Quando narra de fora
// (ex: report assinado pelo estatístico) usa o nome dela. Pra view do app,
// 2ª pessoa funciona melhor.

// ─── Headline "em uma frase" ────────────────────────────────────────────
export function headline(analysis, athleteFirstName) {
  const c = analysis.counts;
  const f = analysis.forma;
  const totalSimples = c.analyzed;
  if (!totalSimples) return null;
  const winsTotal = c.wins;
  const lossesTotal = c.losses;
  const pctTotal = Math.round((winsTotal / (winsTotal + lossesTotal)) * 100);

  if (!f) {
    return `Em ${totalSimples} partidas de simples, ${athleteFirstName} venceu ${winsTotal} e perdeu ${lossesTotal} (${pctTotal}% de aproveitamento).`;
  }

  const pct90 = f.last90?.total > 0 ? Math.round((f.last90.wins / f.last90.total) * 100) : null;
  const pctAll = f.allTime?.total > 0 ? Math.round((f.allTime.wins / f.allTime.total) * 100) : null;

  if (pct90 !== null && pctAll !== null && pct90 - pctAll >= 10) {
    return `Em ${totalSimples} partidas de simples, ${athleteFirstName} venceu ${winsTotal} e perdeu ${lossesTotal} (${pctAll}% no histórico todo). Nos últimos 3 meses, está vencendo ${pct90}% — sua evolução está aparecendo no placar.`;
  }
  if (pct90 !== null && pctAll !== null && pctAll - pct90 >= 10) {
    return `Em ${totalSimples} partidas de simples, ${athleteFirstName} venceu ${winsTotal} e perdeu ${lossesTotal} (${pctAll}% no histórico todo). Nos últimos 3 meses, está em ${pct90}% — período de adaptação.`;
  }
  return `Em ${totalSimples} partidas de simples, ${athleteFirstName} venceu ${winsTotal} e perdeu ${lossesTotal} (${pctAll}% de aproveitamento), com desempenho recente similar à média histórica.`;
}

// ─── Rating Glicko-2 ────────────────────────────────────────────────────
export function ratingNarrative(analysis) {
  const r = analysis.athleteRating;
  if (!r) return null;
  const certainty = r.rd <= 80 ? 'alta' : r.rd <= 150 ? 'média' : 'ainda baixa';
  const trendStable = analysis.forma?.last90 && analysis.forma?.last365
    ? Math.abs(analysis.forma.last90.winRate - analysis.forma.last365.winRate) < 10
    : null;

  let direction;
  if (analysis.forma?.last90 && analysis.forma?.allTime) {
    const diff = analysis.forma.last90.winRate - analysis.forma.allTime.winRate;
    if (diff >= 10) direction = 'em ascensão';
    else if (diff <= -10) direction = 'em queda';
    else direction = 'estável';
  } else {
    direction = 'estável';
  }

  // Descrição do nível com caveat embutido: incerteza alta (rd>120) força
  // tom mais cauteloso ("indicando posição avançada" em vez de "está na elite").
  // Princípio: nunca cravar "elite" com IC largo.
  const highUncertainty = r.rd >= 120;
  let levelDesc;
  if (r.r < 1300) levelDesc = 'em fase inicial competitiva';
  else if (r.r < 1450) levelDesc = 'em nível intermediário';
  else if (r.r < 1600) levelDesc = highUncertainty ? 'apontando pra nível avançado (faixa de incerteza ainda larga)' : 'em nível avançado';
  else levelDesc = highUncertainty ? 'sinalizando elite da categoria, com cautela inferencial pela amostra atual' : 'em patamar de elite da categoria';

  if (direction === 'em ascensão') {
    return `Você está ${levelDesc}, e nos últimos 3 meses o seu nível tem subido. Quando enfrenta atletas parecidas com você, costuma ganhar; contra adversárias mais fortes, ainda perde mais que ganha — o que é normal. A faixa de incerteza (${r.ci95.lower}–${r.ci95.upper}) ainda é ampla porque temos ${analysis.counts.analyzed} partidas; vai estreitar com mais jogos.`;
  }
  if (direction === 'em queda') {
    return `Você está ${levelDesc}. Nos últimos 3 meses o nível avaliado pelo sistema caiu um pouco — pode ser fase, pode ser amostra pequena. A faixa de ${r.ci95.lower} a ${r.ci95.upper} reflete que ainda não temos jogos suficientes pra cravar.`;
  }
  return `Você está ${levelDesc}. O número estimado de hoje (${r.r}) está ${certainty === 'alta' ? 'bem firme' : 'em estabilização'}, na faixa entre ${r.ci95.lower} e ${r.ci95.upper}. Isso quer dizer que com 95% de certeza seu nível verdadeiro está nesse intervalo.`;
}

// ─── Forma recente ───────────────────────────────────────────────────────
export function formaNarrative(analysis) {
  const f = analysis.forma;
  if (!f || !f.allTime || !f.last90) return null;
  const pct90 = f.last90.total > 0 ? Math.round((f.last90.wins / f.last90.total) * 100) : 0;
  const pctAll = f.allTime.total > 0 ? Math.round((f.allTime.wins / f.allTime.total) * 100) : 0;
  const diff = pct90 - pctAll;

  if (f.last90.total < 5) {
    return `Nos últimos 3 meses foram só ${f.last90.total} jogos — pouco pra cravar tendência recente. À medida que mais torneios entrarem, esse painel vai contar uma história mais clara.`;
  }
  if (diff >= 15) {
    return `Cada janela mais recente tem aproveitamento maior. Quase todas as suas vitórias vieram nos últimos 3 meses. Não é sorte: aconteceram contra adversárias parecidas em nível, em jogos decididos no detalhe. **É evolução real.**`;
  }
  if (diff >= 5) {
    return `Os números recentes estão um pouco acima da média histórica. Sinal positivo, mas modesto — vale acompanhar nos próximos torneios pra confirmar a curva.`;
  }
  if (diff <= -10) {
    return `Os últimos 3 meses estão abaixo da média histórica. Pode ser fase difícil, pode ser que esteja enfrentando adversárias mais fortes. Vale conversar com o coach sobre o que mudou.`;
  }
  return `Seu desempenho recente está alinhado com a média histórica. Sem grandes oscilações pra cima ou pra baixo nos últimos 3 meses.`;
}

// ─── Performance por força do oponente ──────────────────────────────────
// Narrativa adapta o tom ao perfil agregado: atleta com aproveitamento alto
// (≥65%) que perde nos parelhos é "fronteira pra subir", não "ponto crítico".
// Atleta que está construindo (perde geral) e perde nos parelhos é "foco
// principal de trabalho". Mesmo dado, leitura diferente conforme o contexto.
export function bucketNarrative(analysis) {
  const b = analysis.bucketPerformance;
  if (!b) return null;
  const total = (bucket) => bucket.w + bucket.l;
  const pct = (bucket) => total(bucket) > 0 ? Math.round((bucket.w / total(bucket)) * 100) : null;
  const overall = analysis.counts;
  const overallPct = overall && overall.analyzed > 0 ? Math.round((overall.wins / overall.analyzed) * 100) : null;
  const isHighPerformer = overallPct !== null && overallPct >= 65;

  if (total(b.even) >= 3) {
    const p = pct(b.even);
    if (p >= 60) {
      return `Quando o jogo é entre você e alguém parecida em nível, você sai ganhando na maior parte das vezes (${b.even.w} de cada ${total(b.even)}). É o termômetro mais limpo do desempenho real, porque tira o ruído de jogos fáceis ou difíceis demais. Sinaliza maturidade emocional acima da média.`;
    }
    if (p <= 35) {
      if (isHighPerformer) {
        return `Em jogos parelhos, ${b.even.w} de ${total(b.even)} (${p}%). É a fronteira que separa o nível atual do próximo: você ganha consistente contra quem está abaixo, mas em jogos contra alguém parecida em nível ainda não fechou maioria. É aí que se ganha rating de verdade.`;
      }
      return `Em jogos contra adversárias parelhas, perdeu mais do que ganhou (${b.even.w} de ${total(b.even)} = ${p}%). Esse é o ponto mais importante a trabalhar: jogos onde você está em condição de vencer mas não tem fechado.`;
    }
    return `Em jogos parelhos, ${b.even.w} de ${total(b.even)} (${p}%). Equilíbrio razoável — vai melhorar conforme acumular experiência em momentos decisivos.`;
  }

  if (total(b.strong) >= 5) {
    const p = pct(b.strong);
    if (p >= 30) {
      return `Você tem encarado adversárias mais fortes com competitividade — venceu ${b.strong.w} de ${total(b.strong)} (${p}%). Cada uma dessas vitórias vale mais para o seu rating do que se viesse contra parelhas.`;
    }
    return `Contra adversárias claramente mais fortes, ainda apanha bastante (${b.strong.w} de ${total(b.strong)} = ${p}%). Esperado nessa fase — todo mundo passa por isso. Cada jogo conta na curva de aprendizado.`;
  }

  return `Ainda há poucos jogos pra cravar padrões claros por força do oponente. Continue acompanhando.`;
}

// ─── Esperado vs Realizado ──────────────────────────────────────────────
export function expectedRealizedNarrative(analysis) {
  const ou = analysis.over_under;
  const e = analysis.expected;
  const r = analysis.realized;
  if (!ou || !e || !r) return null;

  const delta = ou.delta;

  if (Math.abs(delta) < 0.5) {
    return `Está ganhando os jogos que dava pra ganhar e perdendo os difíceis. No nível certo pra fase atual da carreira — sem surpresas grandes pra cima ou pra baixo.`;
  }
  if (delta > 0) {
    if (ou.significant) {
      return `Você está jogando melhor do que dava pra esperar. Em vários jogos onde a adversária parecia mais forte, você venceu. Não foi por sorte — aconteceu várias vezes. Pode ser hora de subir o nível dos torneios e enfrentar adversárias melhores.`;
    }
    return `Levemente acima do esperado: era esperado ${e.wins.toFixed(1).replace('.', ',')} vitórias dado o nível das adversárias, e teve ${r.wins}. Pequeno ganho, dentro do que a aleatoriedade explica.`;
  }
  if (ou.significant) {
    return `Está rendendo abaixo do que dava pra esperar. Esperaríamos ${e.wins.toFixed(1).replace('.', ',')} vitórias considerando o nível das adversárias; teve ${r.wins}. Esse déficit não é só azar — vale entender o que está acontecendo (técnico, físico, emocional).`;
  }
  return `Levemente abaixo do esperado: em ${analysis.counts.analyzed} jogos, esperávamos ${e.wins.toFixed(1).replace('.', ',')} vitórias e teve ${r.wins}. Pequena diferença, dentro da margem de aleatoriedade — não é sinal forte.`;
}

// ─── Top surpresa positiva (1 destaque) ─────────────────────────────────
export function topPositiveNarrative(analysis) {
  const s = analysis.topSurprises?.positive?.[0];
  if (!s) return null;
  return {
    title: `MAIOR CONQUISTA — ${formatBrDate(s.date)}`,
    line1: `vs ${s.opponentName} · ${s.tournamentName.slice(0, 60)}`,
    score: s.scoreRaw,
    paragraph: `A chance estimada antes do jogo era de só ${String(s.expectedWinPct).replace('.', ',')}% — foi seu resultado mais inesperado do período. Vitórias contra adversárias estatisticamente acima de você são as que mais fazem o seu nível subir.`,
  };
}

// ─── Top surpresa negativa (1 destaque) ─────────────────────────────────
export function topNegativeNarrative(analysis) {
  const s = analysis.topSurprises?.negative?.[0];
  if (!s) return null;
  return {
    title: `FRUSTRAÇÃO — ${formatBrDate(s.date)}`,
    line1: `vs ${s.opponentName} · ${s.tournamentName.slice(0, 60)}`,
    score: s.scoreRaw,
    paragraph: `Você era favorita (${String(s.expectedWinPct).replace('.', ',')}% de chance de vitória) — foi o resultado mais inesperado pro lado ruim. Vale lembrar do jogo: o que mudou no decisivo?`,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────
function formatBrDate(isoOrBr) {
  // Date pode chegar como "2025-08-26" ou "26/08/2025"
  if (!isoOrBr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrBr)) {
    const [y, m, d] = isoOrBr.split('-');
    return `${d}/${m}/${y}`;
  }
  return isoOrBr;
}

// ─── Head-to-head — narrativa por adversária recorrente ───────────────
// Gera parágrafo interpretativo da trajetória do confronto.
export function h2hOpponentNarrative(opponent) {
  if (!opponent || opponent.matches.length < 2) return null;
  const ms = opponent.matches;  // já ordenados cronologicamente
  const balance = opponent.wins - opponent.losses;
  const total = opponent.total;

  // Trajetória: como evoluíram os resultados
  const results = ms.map(m => m.result).join('');

  // Caso 1: 0V em todos — barreira
  if (opponent.wins === 0) {
    const lastDate = ms[ms.length - 1].endDate;
    const firstDate = ms[0].endDate;
    // Se confronto recente (dentro de 3 meses), é "barreira atual"
    const today = new Date();
    const [d, mo, y] = lastDate.split('/').map(Number);
    const daysSinceLast = Math.round((today - new Date(y, mo - 1, d)) / (1000 * 60 * 60 * 24));
    if (daysSinceLast <= 90) {
      // Verifica se houve aproximação (placar do último foi mais próximo que o primeiro)
      const firstClose = isCloseLoss(ms[0]);
      const lastClose = isCloseLoss(ms[ms.length - 1]);
      if (lastClose && !firstClose) {
        return `Adversária ainda não vencida — ${total} confrontos, todos derrota. Mas a evolução é positiva: o segundo jogo (${escapeBr(ms[ms.length - 1].endDate)}) foi muito mais próximo da virada que o primeiro. Está aprendendo a jogar contra ela. No próximo encontro, vale chegar com plano específico pra esses pontos decisivos.`;
      }
      return `Barreira atual — ${total} derrotas em ${total} encontros, todos nos últimos 90 dias. Adversária a observar especificamente: vale chegar com plano de jogo específico baseado nos detalhes dos confrontos anteriores.`;
    }
    // Confrontos antigos (>90 dias)
    return `${total} encontros, todos derrota — mas o último foi em ${escapeBr(lastDate)} (mais de 3 meses atrás). Como tempo passou, novo confronto é "do zero" — você é outra atleta agora.`;
  }

  // Caso 2: 100% vitórias — domínio
  if (opponent.losses === 0) {
    return `Domínio completo — ${total} vitórias em ${total} encontros. Adversária consistentemente derrotada no histórico recente.`;
  }

  // Caso 3: misturado — analisar trajetória
  // Compara início vs fim
  const firstHalf = ms.slice(0, Math.ceil(ms.length / 2));
  const lastHalf = ms.slice(Math.ceil(ms.length / 2));
  const firstWinRate = firstHalf.filter(m => m.result === 'W').length / firstHalf.length;
  const lastWinRate = lastHalf.filter(m => m.result === 'W').length / lastHalf.length;

  if (lastWinRate > firstWinRate + 0.3) {
    // Virada favorável
    return `Caso de virada favorável: o(s) primeiro(s) confronto(s) foi(ram) derrota, mas você reverteu o histórico nos encontros mais recentes. A diferença é evolução real — em ${escapeBr(ms[0].endDate)} você ainda apanhava; hoje, tem domínio. Da próxima vez, lembre-se que adversária que perdeu duas vezes seguidas costuma chegar com plano novo na 3ª.`;
  }
  if (firstWinRate > lastWinRate + 0.3) {
    // Regressão — adversária ficou mais forte
    return `Sinal de atenção: o histórico recente está pior que o inicial. Em ${escapeBr(ms[0].endDate)} você venceu/foi competitiva; nos últimos confrontos vem perdendo. Adversária pode ter evoluído mais rápido que você nesse período. Vale plano específico no próximo encontro.`;
  }
  // Equilíbrio
  if (balance > 0) {
    return `Saldo positivo (${opponent.wins}-${opponent.losses}), mas o último jogo foi derrota — equilíbrio crescente. Adversária está evoluindo. Próximos confrontos tendem a ser parelhos.`;
  }
  if (balance < 0) {
    return `Saldo negativo (${opponent.wins}-${opponent.losses}). Adversária ainda leva vantagem nos confrontos diretos. Oportunidade de mapear o que tem funcionado nas vitórias e replicar.`;
  }
  return `Equilíbrio (${opponent.wins}V ${opponent.losses}D). Histórico de ${total} confrontos sem clara vantagem pra nenhum lado.`;
}

function isCloseLoss(m) {
  // Heurística: derrota com ao menos 1 set ganho ou super-tiebreak
  if (!m.sets || m.sets.length < 2) return false;
  if (m.hasSuperTiebreak) return true;
  // Ganhou pelo menos 1 set?
  for (const s of m.sets) if (s[0] > s[1]) return true;
  return false;
}

function escapeBr(s) {
  return s ? s : '';
}

// ─── Padrões temporais ────────────────────────────────────────────────
export function temporalNarrative(temporal, analysis) {
  if (!temporal) return null;
  const parts = [];

  // Streaks
  if (temporal.streaks.maxL >= 5) {
    parts.push(`A maior sequência de derrotas registrada foi de **${temporal.streaks.maxL} jogos**, acumulada principalmente na fase inicial da carreira competitiva — período natural de adaptação ao circuito.`);
  }
  if (temporal.streaks.maxW >= 3) {
    parts.push(`A melhor sequência foi de **${temporal.streaks.maxW} vitórias consecutivas** — momento de pico que mostra capacidade de manter ritmo competitivo quando as engrenagens se alinham.`);
  }

  // Runs test
  const w = temporal.runsTest;
  if (w.z !== null) {
    if (w.significant) {
      parts.push(`O teste de Wald-Wolfowitz aponta padrão estatisticamente não-aleatório nas sequências (z = ${w.z.toFixed(2).replace('.', ',')}). Isso sugere que vitórias e derrotas tendem a se agrupar em "fases" — comum no esporte, onde estado de confiança influencia os resultados subsequentes.`);
    } else {
      parts.push(`Aplicando o teste de Wald-Wolfowitz, com ${analysis.counts.analyzed} jogos, **não dá pra cravar** estatisticamente que as sequências de vitórias e derrotas formem padrão não-aleatório (z = ${w.z.toFixed(2).replace('.', ',')}). À medida que mais jogos forem disputados, esse teste ganha poder de detectar fases reais.`);
    }
  }

  // Ritmo
  if (temporal.rhythm.medianIntervalDays !== null) {
    parts.push(`O ritmo entre torneios tem mediana de **${temporal.rhythm.medianIntervalDays} dias** — intervalo razoável que combina recuperação física com manutenção de ritmo competitivo.`);
  }

  return parts.join(' ');
}

// ─── Derrota mais apertada ────────────────────────────────────────────
export function tightestLossNarrative(loss) {
  if (!loss) return null;

  // Constrói narrativa rica baseada na anatomia específica do match.
  // Se tem super-TB: enfatiza o desfecho no decisivo. Se ganhou mais games
  // em sets regulares mas perdeu (caso "lost as favorite"), destaca isso.
  const hasSTB = loss.hasSuperTiebreak;
  const wonMoreRegularGames = loss.gamesWonAthlete > loss.gamesWonOpponent;
  const tierLabel = loss.tier ? ` ${loss.tier}` : '';

  let paragraph;
  if (hasSTB && wonMoreRegularGames) {
    // Cenário rico: "venceu mais games mas perdeu o match no super-TB"
    paragraph = `Foi o jogo mais apertado do histórico. Anatomia da partida: ela venceu o primeiro set ${loss.sets[0][0]}-${loss.sets[0][1]} e teve domínio inicial. Perdeu o segundo (${loss.sets[1][0]}-${loss.sets[1][1]}) e o match foi pra super-tiebreak, decidido ${loss.sets[2][1]}-${loss.sets[2][0]} contra ela. **Curiosamente, ela venceu mais games na contagem regular (${loss.gamesWonAthlete} contra ${loss.gamesWonOpponent}) — o que separou vitória de derrota foi o desfecho do super-tiebreak**. É o tipo de jogo que ensina mais que muitas vitórias: ela esteve ali, em condição técnica de vencer, e o que faltou foi o detalhe nos pontos finais.`;
  } else if (hasSTB) {
    paragraph = `O match foi pra super-tiebreak — desfecho ${loss.sets[loss.sets.length - 1][1]}-${loss.sets[loss.sets.length - 1][0]} contra ela. Esse formato é decidido em poucos pontos: o que separa vitória de derrota é o foco nos momentos finais. Ela esteve a poucas bolas da virada.`;
  } else if (loss.gameDiff <= 2) {
    paragraph = `Foi o jogo mais apertado do histórico — perdeu por apenas ${loss.gameDiff} game${loss.gameDiff === 1 ? '' : 's'} de diferença total. Em jogos assim, cada ponto pesa muito: um a mais no momento certo, uma escolha tática diferente, e o resultado teria sido outro. Vale revisitar mentalmente: o que aconteceu nos pontos decisivos?`;
  } else {
    paragraph = `Foi um jogo competitivo do começo ao fim — perdeu por ${loss.gameDiff} games de diferença total. Em jogos assim, o que separa vitória de derrota é o detalhe nos pontos decisivos.`;
  }

  return {
    title: `DERROTA MAIS APERTADA — ${formatBrDate(loss.date)}`,
    line1: `vs ${loss.opponentName} · ${loss.tournamentName.slice(0, 60)}${tierLabel ? ` (${tierLabel.trim()})` : ''}`,
    score: loss.scoreRaw,
    paragraph,
  };
}

// Bundle: gera todas as narrativas de uma vez pra serializar pro frontend
// (2ª pessoa, mais íntimo, fala diretamente com a atleta)
export function generateAllNarratives(analysis, athleteFirstName) {
  const h2h = (analysis.recurrentOpponents || []).map(opp => ({
    opponent: opp,
    paragraph: h2hOpponentNarrative(opp),
  }));
  return {
    headline: headline(analysis, athleteFirstName),
    rating: ratingNarrative(analysis),
    forma: formaNarrative(analysis),
    bucket: bucketNarrative(analysis),
    expectedRealized: expectedRealizedNarrative(analysis),
    topPositive: topPositiveNarrative(analysis),
    topNegative: topNegativeNarrative(analysis),
    tightestLoss: tightestLossNarrative(analysis.tightestLoss),
    h2h,
    temporal: temporalNarrative(analysis.temporal, analysis),
  };
}

// Converte uma narrativa em 2ª pessoa pra 3ª pessoa, flexionando pelo
// gênero do atleta (M default). Templates internos foram escritos em
// feminino histórico (adversária, parecidas, etc.) — quando atleta é M,
// também trocamos as flexões dependentes pra masculino.
function toThirdPerson(text, firstName, gender = 'M') {
  if (!text) return text;
  let s = text;
  const F = gender === 'F';
  // Letra portuguesa (incluindo acentos)
  const L = String.raw`A-Za-zÀ-ÖØ-öø-ÿ`;
  const wordBoundaryReplace = (str, find, replWith) => {
    const re = new RegExp(`(^|[^${L}])(${find})(?=[^${L}]|$)`, 'g');
    return str.replace(re, (_, pre) => `${pre}${replWith}`);
  };

  // 1ª ocorrência de "Você" → nome do atleta; subsequentes → "Ele"/"Ela"
  let firstUse = true;
  s = s.replace(new RegExp(`(^|[^${L}])Você(?=[^${L}]|$)`, 'g'), (_, pre) => {
    const repl = firstUse ? firstName : (F ? 'Ela' : 'Ele');
    firstUse = false;
    return `${pre}${repl}`;
  });

  // Contrações da preposição "de" + "você": "de você" → "dele/dela",
  // "acima de você" → "acima dela/dele", etc. Tratado ANTES da troca
  // simples de "você" pra evitar gerar "acima de ele".
  const dele = F ? 'dela' : 'dele';
  s = wordBoundaryReplace(s, 'de você', dele);

  // "você" minúsculo → "ela"/"ele"
  s = wordBoundaryReplace(s, 'você', F ? 'ela' : 'ele');

  // Possessivos: ordem importa — frases compostas com artigo definido
  // antes ("o seu X") são tratadas primeiro pra evitar duplicação ("o o X dele").
  s = wordBoundaryReplace(s, 'o seu nível', `o nível ${dele}`);
  s = wordBoundaryReplace(s, 'o seu jogo', `o jogo ${dele}`);
  s = wordBoundaryReplace(s, 'a sua evolução', `a evolução ${dele}`);
  s = wordBoundaryReplace(s, 'o seu resultado', `o resultado ${dele}`);
  s = wordBoundaryReplace(s, 'a sua chance', `a chance ${dele}`);
  s = wordBoundaryReplace(s, 'a sua taxa', `a taxa ${dele}`);
  s = wordBoundaryReplace(s, 'a sua faixa', `a faixa ${dele}`);
  s = wordBoundaryReplace(s, 'a sua adaptação', `a adaptação ${dele}`);
  // Versões sem artigo prévio
  s = wordBoundaryReplace(s, 'seu nível', `o nível ${dele}`);
  s = wordBoundaryReplace(s, 'seu jogo', `o jogo ${dele}`);
  s = wordBoundaryReplace(s, 'sua evolução', `a evolução ${dele}`);
  s = wordBoundaryReplace(s, 'sua maior', 'a maior');
  s = wordBoundaryReplace(s, 'seu resultado', `o resultado ${dele}`);
  s = wordBoundaryReplace(s, 'sua chance', `a chance ${dele}`);
  s = wordBoundaryReplace(s, 'sua taxa', `a taxa ${dele}`);
  s = wordBoundaryReplace(s, 'sua faixa', `a faixa ${dele}`);
  s = wordBoundaryReplace(s, 'sua adaptação', `a adaptação ${dele}`);

  // Frases idiomáticas com "você" embutido
  s = s.replace(/contra ela e alguém/g, F ? 'entre ela e alguém' : 'entre ele e alguém');

  // Flexão pra masculino: substantivos e adjetivos que viviam em feminino
  // nos templates históricos. Cuidado: só mexemos quando o gênero é M.
  // Ordem: frases compostas primeiro, depois palavras isoladas.
  if (!F) {
    // Compostas (artigo+substantivo) que precisam vir antes pra evitar
    // descasamento de concordância tipo "das adversários".
    s = s.replace(/das adversárias/g, 'dos adversários');
    s = s.replace(/Das adversárias/g, 'Dos adversários');
    s = s.replace(/das mesmas adversárias/g, 'dos mesmos adversários');
    s = s.replace(/uma adversária/g, 'um adversário');
    s = s.replace(/Uma adversária/g, 'Um adversário');
    s = s.replace(/da adversária/g, 'do adversário');
    s = s.replace(/Da adversária/g, 'Do adversário');
    // Plurais e singulares de "adversária(s)"
    s = wordBoundaryReplace(s, 'adversárias', 'adversários');
    s = wordBoundaryReplace(s, 'adversária', 'adversário');
    // Adjetivos que descrevem oponentes ou atleta
    s = wordBoundaryReplace(s, 'parecidas', 'parecidos');
    s = wordBoundaryReplace(s, 'parecida', 'parecido');
    s = wordBoundaryReplace(s, 'parelhas', 'parelhos');
    s = wordBoundaryReplace(s, 'parelha', 'parelho');
    s = wordBoundaryReplace(s, 'mais fortes', 'mais fortes');
    s = wordBoundaryReplace(s, 'mais fracas', 'mais fracos');
    s = wordBoundaryReplace(s, 'mais fraca', 'mais fraco');
    s = wordBoundaryReplace(s, 'enfrentadas', 'enfrentados');
    s = wordBoundaryReplace(s, 'enfrentada', 'enfrentado');
    s = wordBoundaryReplace(s, 'pressionada', 'pressionado');
    s = wordBoundaryReplace(s, 'outra atleta agora', 'outro atleta agora');
    s = wordBoundaryReplace(s, 'jogadora', 'jogador');
    s = wordBoundaryReplace(s, 'vencedora', 'vencedor');
  }

  return s;
}

function toThirdPersonObj(obj, firstName, gender = 'M') {
  if (!obj) return obj;
  if (typeof obj === 'string') return toThirdPerson(obj, firstName, gender);
  if (Array.isArray(obj)) return obj.map(o => toThirdPersonObj(o, firstName, gender));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = (k === 'paragraph' || k === 'title' || k === 'line1' ||
                k === 'headline' || k === 'rating' || k === 'forma' ||
                k === 'bucket' || k === 'expectedRealized' || k === 'temporal')
        ? toThirdPersonObj(v, firstName, gender)
        : v;
    }
    return out;
  }
  return obj;
}

// Gera as mesmas narrativas mas em 3ª pessoa — pro relatório técnico assinado.
// G = genderTerms object (opcional, default masculino genérico).
export function generateAllNarrativesThirdPerson(analysis, athleteFirstName, athleteFullName, G) {
  const gender = G?.gender || 'M';
  const second = generateAllNarratives(analysis, athleteFullName || athleteFirstName);
  return {
    headline: toThirdPerson(second.headline, athleteFirstName, gender),
    rating: toThirdPerson(second.rating, athleteFirstName, gender),
    forma: toThirdPerson(second.forma, athleteFirstName, gender),
    bucket: toThirdPerson(second.bucket, athleteFirstName, gender),
    expectedRealized: toThirdPerson(second.expectedRealized, athleteFirstName, gender),
    topPositive: second.topPositive ? {
      ...second.topPositive,
      paragraph: toThirdPerson(second.topPositive.paragraph, athleteFirstName, gender),
    } : null,
    topNegative: second.topNegative ? {
      ...second.topNegative,
      paragraph: toThirdPerson(second.topNegative.paragraph, athleteFirstName, gender),
    } : null,
    tightestLoss: second.tightestLoss ? {
      ...second.tightestLoss,
      paragraph: toThirdPerson(second.tightestLoss.paragraph, athleteFirstName, gender),
    } : null,
    h2h: second.h2h.map(item => ({
      opponent: item.opponent,
      paragraph: toThirdPerson(item.paragraph, athleteFirstName, gender),
    })),
    temporal: toThirdPerson(second.temporal, athleteFirstName, gender),
  };
}
