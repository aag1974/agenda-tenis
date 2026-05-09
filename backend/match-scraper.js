// Scraper de matches do TI a partir de /perfil2/jogos/{athleteId}?ano={Y}.
// Diferente do scraper de torneios (que pega metadata), este pega o HISTÓRICO
// DE JOGOS DISPUTADOS — o que alimenta toda a stack analítica (Glicko, win
// probability, Markov de fluxo, etc).
//
// 1 GET por ano. ~0.5s por chamada (depende do servidor TI).
// Backfill típico: 3 anos = 3 GETs, 1-2s total.

import * as cheerio from 'cheerio';
import { extractTier } from './tier-utils.js';

// Mapeia o código de round usado pelo TI pra um label legível.
// Coletado empiricamente da página /perfil2/jogos/.
const ROUND_LABELS = {
  'F':   'Final',
  'S':   'SF',     // Semifinal
  'Q':   'QF',     // Quartas
  'O':   'R16',    // Oitavas
  'R32': 'R32',
  'R16': 'R16',
  'R64': 'R64',
  'TT':  'TT',     // Mantém raw — significado exato (consolação? play-off?) ainda a confirmar
};

// Ordem canônica pra ordenação por "fase" do torneio.
const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'Final', 'TT'];

const MONTH_PT = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
};

// "01 Mai 2026" → "01/05/2026"
function parsePtDate(s) {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-zçÇ]+)\s+(\d{4})$/);
  if (!m) {
    // Fallback: já está em dd/mm/yyyy
    const m2 = s.trim().match(/^(\d{2}\/\d{2}\/\d{4})$/);
    return m2 ? m2[1] : null;
  }
  const [, d, mon, y] = m;
  const mm = MONTH_PT[mon.slice(0, 3).toLowerCase()];
  if (!mm) return null;
  return `${d.padStart(2, '0')}/${mm}/${y}`;
}

// "...G3 - 12F" / "...12FD-G1+" / "...G2 - 14F"
function parseTierAndCategory(headerText) {
  // Tier: G1, G2, G3, GA, G1+, G2+, G3+, GA+
  // BUG FIX: \b após \+? falha porque '+' é non-word char (boundary entre
  // dígito e + é boundary, então a regex prefere não casar o +).
  // Solução: lookahead pra non-letter/digit após o tier.
  const tierM = headerText.match(/G[123A]\+?(?=$|[^A-Za-z0-9])/i);
  const tier = tierM ? tierM[0].toUpperCase() : null;
  // Category: 12F, 14F, 16F, 18F (ou M), com sufixo D pra duplas
  const catM = headerText.match(/\b(\d{1,2})([FM])(D)?\b/i);
  const category = catM ? `${catM[1]}${catM[2].toUpperCase()}${catM[3] ? 'D' : ''}` : null;
  const isDoubles = !!catM?.[3] || /\bduplas?\b/i.test(headerText);
  return { tier, category, isDoubles };
}

// "Cidade - Estado, 01 Mai 2026 à 03/05/2026" → { city, state, startDate, endDate }
function parseLocationAndDates(infoText) {
  if (!infoText) return { city: null, state: null, startDate: null, endDate: null };
  const m = infoText.match(/^(.+?)\s*-\s*(.+?),\s*(.+?)\s*à\s*(\d{2}\/\d{2}\/\d{4})/);
  if (!m) return { city: null, state: null, startDate: null, endDate: null };
  return {
    city: m[1].trim(),
    state: m[2].trim(),
    startDate: parsePtDate(m[3].trim()),
    endDate: m[4].trim(),
  };
}

// "3x6 4x6" → [[3,6],[4,6]]; "6x1 2x6 9x11" → [[6,1],[2,6],[9,11]]
// Empty/WO/RET → [].
function parseScore(rawScore) {
  if (!rawScore || !rawScore.trim()) return [];
  const sets = [];
  for (const setStr of rawScore.trim().split(/\s+/)) {
    const m = setStr.match(/^(\d+)x(\d+)$/i);
    if (!m) continue;
    sets.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
  }
  return sets;
}

// Detecta super-tiebreak (3º set decidido em match tie-break a 10) — comum em
// juvenil. Heurística: ≥1 lado ≥ 10, diferença mínima de 2.
function isSuperTiebreak(set) {
  const [a, b] = set;
  return Math.max(a, b) >= 10 && Math.abs(a - b) >= 2 && Math.min(a, b) <= 9;
}

// Calcula totais agregados de games e sets a partir do array de sets.
// Para super-tiebreak, conta como "1 set" mas não somamos os "games" do TB
// nos game totals (TB é em pontos, não games). O TI mistura no display, mas
// pra estatística separamos.
function aggregateScore(sets) {
  let setsWonAthlete = 0, setsWonOpponent = 0;
  let gamesWonAthlete = 0, gamesWonOpponent = 0;
  let hasSuperTiebreak = false;
  for (const set of sets) {
    const [a, b] = set;
    const stb = isSuperTiebreak(set);
    if (stb) {
      hasSuperTiebreak = true;
      // Conta como set vencido pelo lado maior, mas não soma como games
      if (a > b) setsWonAthlete++; else setsWonOpponent++;
    } else {
      gamesWonAthlete += a;
      gamesWonOpponent += b;
      if (a > b) setsWonAthlete++; else setsWonOpponent++;
    }
  }
  return { setsWonAthlete, setsWonOpponent, gamesWonAthlete, gamesWonOpponent, hasSuperTiebreak };
}

// Match canônico com ID determinístico — mesmo (athleteId, opponentId, tournament, round)
// nunca duplica em re-scrape.
function makeMatchId({ athleteId, tournamentId, round, opponentId, doublesPartner = null }) {
  // Se o opponentId vier como pair de duplas no nome, opponentId já é só o ID
  // do "primeiro adversário" (o que o TI link aponta). Ainda sim único.
  return [
    'm', athleteId, tournamentId, round, opponentId, doublesPartner ? `d${doublesPartner}` : '',
  ].join(':').replace(/:+$/, '');
}

// Função principal — fetcha e parseia 1 ano de jogos do atleta.
//
// IMPORTANTE: a página `/perfil2/jogos/{id}` ignora `?ano=Y` no GET — sempre
// devolve o ano corrente (2026 hoje). O filtro real é via POST do form
// `frm-list` com `ano=Y` no body (form-urlencoded). Sem isso, scrapear 3
// anos retornava as mesmas 23 matches × 3 = 69 entries duplicadas.
export async function fetchAthleteMatches(client, athleteId, year) {
  const res = await client.request(`/perfil2/jogos/${athleteId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ano: String(year) }).toString(),
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  const matches = [];

  // Cada bloco de torneio é um <ul.list-group.tournmt-results>
  // Precedido por <div.innerpanel-header> com nome/datas/local.
  $('ul.list-group.tournmt-results').each((_, ul) => {
    const $ul = $(ul);
    const $hdr = $ul.prevAll('div.innerpanel-header').first();

    const $h4link = $hdr.find('h4 a').first();
    const headerText = $h4link.text().trim();
    const tournamentUrl = $h4link.attr('href') || '';
    const tidMatch = tournamentUrl.match(/torneio_painel_info\/index\/(\d+)/);
    const tournamentId = tidMatch?.[1] || null;

    const infoText = $hdr.find('.info').first().text().trim();
    const { city, state, startDate, endDate } = parseLocationAndDates(infoText);
    const { tier, category, isDoubles } = parseTierAndCategory(headerText);

    $ul.find('li.list-group-item').each((__, li) => {
      const $li = $(li);
      const roundRaw = $li.find('.round').first().text().trim();
      const round = ROUND_LABELS[roundRaw] || roundRaw;

      const $oppLink = $li.find('.avatar-info a.avatar-name').first();
      const opponentName = $oppLink.text().trim();
      const oppHref = $oppLink.attr('href') || '';
      const oppIdMatch = oppHref.match(/perfil2\/index\/(\d+)/);
      const opponentId = oppIdMatch?.[1] || null;

      // Doubles: detecta APENAS pelo formato do nome do oponente. Nomes
      // separados por "/" = duplas (TI lista os dois). Nome simples = simples,
      // mesmo que o tier do torneio diga "12FD" (TI às vezes mistura simples
      // e duplas no mesmo bloco visual da página /perfil2/jogos/).
      const opponentNames = opponentName.split('/').map(s => s.trim()).filter(Boolean);
      const isDoublesMatch = opponentNames.length > 1;

      // Result: "V" / "D" / possivelmente outros (W.O., RET — não vimos ainda)
      const $resultSpan = $li.find('.result .text-bold').first();
      const resultRaw = $resultSpan.text().trim();
      const isWin = /^V/i.test(resultRaw);
      const isLoss = /^D/i.test(resultRaw);

      // Score: texto após o span de V/D dentro do .result
      const $resultDiv = $li.find('.result').first();
      // Pega o texto dele EXCETO o do span (que é V/D)
      const resultFullText = $resultDiv.text().trim();
      const scoreRaw = resultFullText.replace(/^[VDW.\s ]+/i, '').trim();

      const sets = parseScore(scoreRaw);
      const agg = aggregateScore(sets);

      // WO/RET: se não tiver score, e tiver V/D, marca como tal
      const hasScore = sets.length > 0;
      const wo = !hasScore && (isWin || isLoss); // walkover se vitória/derrota sem score
      // RET é mais difícil de detectar sem marker explícito — TI às vezes
      // mostra "ABD" ou anota no info. Por ora, não distinguimos WO de RET.

      matches.push({
        id: makeMatchId({ athleteId, tournamentId, round: roundRaw, opponentId }),
        athleteId,
        year,
        date: endDate || startDate || null,  // Aproximação: usamos endDate do torneio (TI não dá data exata do match)
        tournamentId,
        tournamentName: headerText,
        tier,
        category,
        isDoubles: isDoublesMatch,
        round,                               // R32, R16, QF, SF, Final, TT
        roundRaw,                            // Original do TI
        city,
        state,
        startDate,
        endDate,
        opponentId,                          // null se duplas e link não der ID claro
        opponentName,                        // String original (pode ter "/")
        opponentNames,                       // Array, útil pra duplas
        result: isWin ? 'W' : isLoss ? 'L' : null,
        scoreRaw,
        sets,                                // [[6,4],[3,6],[10,7]]
        wo,
        ...agg,                              // setsWonAthlete, setsWonOpponent, gamesWonAthlete, gamesWonOpponent, hasSuperTiebreak
        scrapedAt: new Date().toISOString(),
      });
    });
  });

  return matches;
}

// Dado um array de matches já scrapeados, dá um sumário rápido pra logging/debug.
export function summarizeMatches(matches) {
  const total = matches.length;
  const wins = matches.filter(m => m.result === 'W').length;
  const losses = matches.filter(m => m.result === 'L').length;
  const dbl = matches.filter(m => m.isDoubles).length;
  const yearMin = Math.min(...matches.map(m => m.year));
  const yearMax = Math.max(...matches.map(m => m.year));
  return { total, wins, losses, doubles: dbl, yearRange: [yearMin, yearMax] };
}

export { ROUND_ORDER, ROUND_LABELS };
