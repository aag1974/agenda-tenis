// HTTP-only scraper for Tênis Integrado.
// Uses cheerio for HTML parsing — no Chromium/Puppeteer needed.

import * as cheerio from 'cheerio';
import { TIClient } from './ti-client.js';
import { extractTier, extractAllTiers, compareTiers } from './tier-utils.js';

const BASE = 'https://www.tenisintegrado.com.br';
const JUVENIL_CATEGORY = 2;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// TI category IDs as exposed in /new_torneio/index2/{categoryId}/...
// Maps a regex (matched against rankings text on profile) to a category id.
export const TI_CATEGORIES = [
  { id: 2,  name: 'Juvenil',       match: /Juvenil/i },
  { id: 17, name: 'Profissional',  match: /Profissional/i },
  { id: 5,  name: 'Senior',        match: /\bSenior\b/i },
  { id: 24, name: 'Beach Tennis',  match: /Beach\s*Tennis/i },
  { id: 29, name: 'Tennis Kids',   match: /Tennis\s*Kids|Mini\s*T[eê]nis/i },
];

// Mapping de detectedCategories ('12F', '14M', etc) pro texto que aparece
// no anchor da aba Inscrições do torneio ("12 Anos Feminino Simples").
// Usado pra restringir scan da aba inscritos a uma categoria por torneio.
export const CATEGORY_HINTS = {
  '12F': '12 Anos Feminino', '12M': '12 Anos Masculino',
  '14F': '14 Anos Feminino', '14M': '14 Anos Masculino',
  '16F': '16 Anos Feminino', '16M': '16 Anos Masculino',
  '18F': '18 Anos Feminino', '18M': '18 Anos Masculino',
};

function normalizeName(s) {
  if (!s) return '';
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractPendingPayments(text) {
  if (!text) return [];
  const idx = text.indexOf('pagamento pendente');
  if (idx < 0) return [];
  const slice = text.slice(idx, idx + 2000);
  const lines = slice.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  let current = null;
  for (const line of lines) {
    if (line === 'Boleto') {
      if (current?.tournamentName) items.push(current);
      current = { tournamentName: null, category: null, value: null, dueDate: null };
    } else if (current) {
      if (!current.tournamentName) current.tournamentName = line;
      else if (!current.category && /Anos|Simples|Duplas/i.test(line)) current.category = line;
      else if (line.startsWith('Valor:')) current.value = line.replace('Valor:', '').trim();
      else if (line.startsWith('Pagamento até:')) current.dueDate = line.replace('Pagamento até:', '').trim();
    }
    if (line.startsWith('Anuidade')) break;
  }
  if (current?.tournamentName) items.push(current);
  return items;
}

function elementInnerText($el) {
  // Approximate textContent's behavior: text plus newlines at block boundaries
  const html = $el.html() || '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

async function getAthleteInfo(client) {
  const html = await client.getText(`/perfil2/inicio/${client.athleteId}`);
  const $ = cheerio.load(html);

  // Athlete name: prefer <h2> com pattern "Nome Completo (athleteId)" — TI
  // mostra o nome completo lá. Fallback pra primeiro anchor que pareça nome.
  let name = null;
  $('h2').each((i, h) => {
    const text = $(h).text().trim();
    const m = text.match(/^([A-ZÀ-Ýa-zà-ý]+(?:\s+[A-ZÀ-Ýa-zà-ý]+)+)\s*\(\d+\)$/);
    if (m) { name = m[1].trim(); return false; }
  });
  if (!name) {
    $('a').each((i, a) => {
      const t = $(a).text().trim();
      if (/^[A-ZÀ-Ý][a-zà-ý]+(\s+[A-ZÀ-Ý][a-zà-ý]+){1,3}$/.test(t)) { name = t; return false; }
    });
  }

  // Tournament IDs from any link to torneio_painel_info
  const tournamentIds = new Set();
  $('a[href*="torneio_painel_info"]').each((i, a) => {
    const m = ($(a).attr('href') || '').match(/torneio_painel_info\/index\/(\d+)/);
    if (m) tournamentIds.add(m[1]);
  });

  // Boleto URLs (relative format: pay/index/{id})
  const boletoUrls = [];
  $('a[href*="pay/index/"]').each((i, a) => {
    let href = $(a).attr('href') || '';
    if (!href.startsWith('http')) href = BASE + (href.startsWith('/') ? '' : '/') + href;
    boletoUrls.push(href);
  });

  // Inicio tab text — for parsing pending payments
  const $inicio = $('#profile-tabs-inicio').first();
  const inicioText = $inicio.length ? elementInnerText($inicio) : elementInnerText($('body'));
  const bodyText = elementInnerText($('body'));

  // WTN: "WTN - World Tennis Number 37,40 Simples 37,96 Duplas"
  let wtn = null;
  const mWtn = bodyText.match(/WTN[^0-9]*?(\d+[.,]\d+)\s+Simples\s+(\d+[.,]\d+)\s+Duplas/);
  if (mWtn) wtn = { single: mWtn[1], double: mWtn[2] };

  // Profile city/origin: "Sobre Brasil/DF mora em Pindamonhangaba - SP"
  let about = null;
  const mAbout = bodyText.match(/Sobre\s+(Brasil\/[A-Z]{2})/);
  if (mAbout) about = mAbout[1];

  // Hand: "Joga com a mão direita." / "esquerda."
  let hand = null;
  const mHand = bodyText.match(/Joga com a mão (direita|esquerda)/i);
  if (mHand) hand = mHand[1].toLowerCase();

  // Rankings shown in profile: "Ranking Nacional Juvenil 2026 - 12F 01/01/2026 Criado por CBT 141.75 - 52º Colocado"
  const rankings = [];
  const rxRanking = /Ranking\s+Nacional\s+Juvenil\s+(\d{4})\s*-\s*(\d{1,2}[FM])[\s\S]*?([\d.,]+)\s*-\s*(\d+)º\s*Colocado/g;
  for (const m of bodyText.matchAll(rxRanking)) {
    rankings.push({
      year: parseInt(m[1]),
      category: m[2],   // e.g. "12F"
      points: m[3],
      position: parseInt(m[4]),
    });
  }

  // Detect TI categories where the athlete has a ranking entry.
  // Looks for text patterns near "Ranking" lines.
  const detectedCategories = [];
  // Slice the body text around "Ranking" occurrences and check keywords
  const rankingMentions = [...bodyText.matchAll(/Ranking[\s\S]{0,120}/gi)].map(m => m[0]);
  for (const cat of TI_CATEGORIES) {
    if (rankingMentions.some(snippet => cat.match.test(snippet))) {
      detectedCategories.push(cat.id);
    }
  }

  return {
    name: name || 'Atleta',
    tournamentIds: [...tournamentIds],
    inicioText,
    boletoUrls: [...new Set(boletoUrls)],
    wtn,
    about,
    hand,
    rankings,
    detectedCategories,
  };
}

// CBT national juvenil ranking IDs (one per year). 1326 = 2026.
const RANKING_PAGE_ID_CURRENT_YEAR = 1326;
const CATEGORY_IDS = { '12F': 9, '14F': 10, '16F': 11, '18F': 12 }; // simples categories

// Compute athlete's position within their own UF (any state, not hardcoded).
// Two-pass: 1) lista nacional sem filtro pra detectar UF do atleta;
// 2) lista filtrada pela UF detectada pra ranquear regionalmente.
// Returns { uf, regionalPosition, totalRegional, cutoffDate } or null
async function getRegionalPosition(client, athleteTiId, categoryCode = '12F') {
  const catId = CATEGORY_IDS[categoryCode];
  if (!catId) return null;
  try {
    // First GET — captura último corte e mapeamento UF→id_uf do <select>
    const initial = await client.getText(`/ranking_painel_classif/index/${RANKING_PAGE_ID_CURRENT_YEAR}`);
    const $ = cheerio.load(initial);
    let latestCorte = null;
    let latestCorteDate = null;
    $('select#id_corte option').each((i, opt) => {
      const v = ($(opt).attr('value') || '').trim();
      const t = $(opt).text().trim();
      if (/^\d+$/.test(v) && (!latestCorte || parseInt(v) > parseInt(latestCorte))) {
        latestCorte = v;
        latestCorteDate = (t.match(/\d{2}\/\d{2}\/\d{4}/) || [])[0] || null;
      }
    });
    const ufMap = {}; // { 'DF': 7, 'SP': 26, ... }
    $('select#id_uf option').each((i, opt) => {
      const v = ($(opt).attr('value') || '').trim();
      const t = $(opt).text().trim().toUpperCase();
      if (/^\d+$/.test(v) && /^[A-Z]{2}$/.test(t)) ufMap[t] = parseInt(v);
    });

    // 2nd request — POST nacional (sem UF) pra detectar UF da atleta
    const fetchList = async (idUf) => {
      const body = new URLSearchParams({
        busca: '',
        id_corte: latestCorte || '',
        id_categoria: String(catId),
        id_uf: idUf == null ? '' : String(idUf),
      }).toString();
      const res = await client.request(`/ranking_painel_classif/index/${RANKING_PAGE_ID_CURRENT_YEAR}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const html = await res.text();
      return elementInnerText(cheerio.load(html)('body'));
    };

    // Regex estendida: captura também a UF (formato "ID. NUMBER, UF: XX")
    const nacText = await fetchList(null);
    let athleteUF = null;
    for (const m of nacText.matchAll(/(\d+)º\s*-\s*[^I]+ID\.\s*(\d+)[^\n]*?UF:\s*([A-Z]{2})/g)) {
      if (m[2] === athleteTiId) { athleteUF = m[3]; break; }
    }
    if (!athleteUF || !ufMap[athleteUF]) {
      return { uf: athleteUF, regionalPosition: null, totalRegional: 0, cutoffDate: latestCorteDate };
    }

    // 3rd request — POST com a UF da atleta pra ranquear no recorte regional
    const regText = await fetchList(ufMap[athleteUF]);
    const entries = [];
    for (const m of regText.matchAll(/(\d+)º\s*-\s*[^I]+ID\.\s*(\d+)/g)) {
      entries.push({ nationalPos: parseInt(m[1]), id: m[2] });
    }
    const idx = entries.findIndex(e => e.id === athleteTiId);
    return {
      uf: athleteUF,
      regionalPosition: idx >= 0 ? idx + 1 : null,
      totalRegional: entries.length,
      cutoffDate: latestCorteDate,
    };
  } catch (err) {
    return null;
  }
}

// Desempenho agregado do atleta — endpoint AJAX que o widget "Desempenho de
// Anna" consome no /perfil2/inicio/. Retorna W/L + sets + games por ano (até 5
// anos em `lastFive`) + total acumulado.
//
// Endpoint: POST /perfil2/getStats com `id={athleteId}` (form-urlencoded).
// Resposta: { hasData, lastFive: [{ano, vitorias, derrotas, setvitorias,
// setderrotas, gamevitorias, gamederrotas}], total: {vitorias, derrotas, ...} }
async function getDesempenho(client) {
  try {
    const res = await client.request(`/perfil2/getStats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ id: client.athleteId }).toString(),
    });
    const json = JSON.parse(await res.text());
    if (!json?.hasData) return null;
    const toInt = (v) => parseInt(v, 10) || 0;
    const byYear = (json.lastFive || []).map(r => ({
      year: parseInt(r.ano, 10),
      wins: toInt(r.vitorias),
      losses: toInt(r.derrotas),
      setWins: toInt(r.setvitorias),
      setLosses: toInt(r.setderrotas),
      gameWins: toInt(r.gamevitorias),
      gameLosses: toInt(r.gamederrotas),
    })).filter(r => Number.isFinite(r.year));
    const t = json.total || {};
    return {
      byYear,
      total: {
        wins: toInt(t.vitorias),
        losses: toInt(t.derrotas),
        setWins: toInt(t.setvitorias),
        setLosses: toInt(t.setderrotas),
        gameWins: toInt(t.gamevitorias),
        gameLosses: toInt(t.gamederrotas),
      },
    };
  } catch {
    return null;
  }
}

async function getProgramaIds(client) {
  const html = await client.getText(`/perfil2/programa/${client.athleteId}`);
  const $ = cheerio.load(html);
  const ids = new Set();
  $('select option').each((i, opt) => {
    const v = ($(opt).attr('value') || '').trim();
    if (/^\d+$/.test(v)) ids.add(v);
  });
  $('a[href*="torneio_painel_info"]').each((i, a) => {
    const m = ($(a).attr('href') || '').match(/torneio_painel_info\/index\/(\d+)/);
    if (m) ids.add(m[1]);
  });
  return [...ids];
}

function parseDateRange(s) {
  if (!s) return [null, null];
  const m = s.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?\s*[-a]\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) {
    const single = s.match(/(\d{2}\/\d{2}\/\d{4})/);
    return single ? [single[1], single[1]] : [null, null];
  }
  const [, d1, m1, y1, d2, m2, y2] = m;
  let startYear = y1 || y2;
  if (!y1 && parseInt(m1) > parseInt(m2)) startYear = String(parseInt(y2) - 1);
  return [`${d1}/${m1}/${startYear}`, `${d2}/${m2}/${y2}`];
}

function parseCatalogRows(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('tr').each((i, tr) => {
    const $tr = $(tr);
    const link = $tr.find('a[href*="torneio_painel_info/index/"]').first();
    if (!link.length) return;
    const m = (link.attr('href') || '').match(/\/index\/(\d+)/);
    if (!m) return;
    const id = m[1];
    if (out.some(t => t.id === id)) return;

    const nameEl = $tr.find('.name-info span, .link-tournament .name-info, .link-tournament').first();
    const name = (nameEl.length ? nameEl.text() : link.text()).trim().replace(/\s+/g, ' ');

    const rankingText = $tr.find('.text-light-gray, .text-slim').first().text().trim();
    const statusText = $tr.find('.text-info, .text-success, .text-warning, .text-danger').first().text().trim();

    // Get text per cell
    const cells = [];
    $tr.find('td').each((i, td) => cells.push(elementInnerText($(td))));

    let city = null, state = null;
    for (const c of cells) {
      const m = c.match(/^([A-ZÀ-Ý][A-Za-zÀ-ý'.\s]+?)\s*-\s*([A-Z]{2})$/);
      if (m) { city = m[1].trim(); state = m[2]; break; }
    }

    const lastCell = cells[cells.length - 1] || '';
    out.push({ id, name, rankingText, statusText, datesText: lastCell, city, state });
  });
  return out;
}

async function fetchCatalog(client, { category = JUVENIL_CATEGORY, year = new Date().getFullYear() } = {}) {
  // Fetch all 12 months in parallel
  const pages = await Promise.all(
    Array.from({ length: 12 }, (_, i) => i + 1).map(month =>
      client.getText(`/new_torneio/index2/${category}/${year}/0/0/${month}`).catch(() => '')
    )
  );
  const monthly = [];
  for (const html of pages) monthly.push(...parseCatalogRows(html));
  const byId = new Map();
  for (const r of monthly) if (!byId.has(r.id)) byId.set(r.id, r);
  const raw = [...byId.values()];

  return raw.map(r => {
    const [startDate, endDate] = parseDateRange(r.datesText);
    // Combina 3 fontes de detecção de tier (princípio defensivo do
    // user 2026-05-08: digitação manual falha, busca cobre múltiplas):
    //   1. tiers detectados na página de rankings (categórico-oficial)
    //   2. todos os tiers explícitos no nome do torneio
    //   3. todos os tiers explícitos no rankingText completo
    const tiersFromRankingPage = [...new Set(
      [...r.rankingText.matchAll(/(GA\+|GA|G1\+|G1|G2\+|G2|G3\+|G3)(?!\w)/g)].map(m => m[1])
    )];
    const tiersFromName = extractAllTiers(r.name);
    const tiersFromRankingText = extractAllTiers(r.rankingText);
    // União ordenada (mais alto → mais baixo)
    const tiers = [...new Set([
      ...tiersFromRankingPage,
      ...tiersFromName,
      ...tiersFromRankingText,
    ])].sort(compareTiers);
    return {
      id: r.id,
      name: r.name.slice(0, 200),
      city: r.city, state: r.state,
      cityState: r.city && r.state ? `${r.city}-${r.state}` : null,
      startDate, endDate,
      registrationStatus: r.statusText || null,
      tier: tiers[0] || null, // back-compat (existing code reads `tier`)
      tiers,                   // new: array of all tiers in the tournament
      url: `${BASE}/torneio_painel_info/index/${r.id}`,
    };
  });
}

// Verifica se a atleta está na página "Inscritos" do torneio.
// Estratégia: a página principal do torneio (/torneio_painel_info/index/X)
// tem links pras abas (Inscrições, Classificação). Pegamos a URL da aba
// Inscrições do HTML e seguimos. Mais robusto que chutar URL.
//
// Source of truth — o perfil dela pode estar desatualizado, mas a página
// de Inscritos do torneio reflete o estado real. A maior parte do TI
// requer login pra ver Inscritos, então sem `client` autenticado não roda.
export async function getAthleteStatusInTournament(tournamentId, athleteId, client = null, opts = {}) {
  if (!athleteId) return null;
  if (!client) return null; // requer auth — fetch público dá 404
  const debug = !!opts.debug;
  // categoryHint = "12 Anos Feminino" / "14 Anos Masculino" — vindo do
  // detectedCategories do perfil da atleta. Limita scan a 1 categoria.
  const categoryHint = opts.categoryHint || null;
  const dbg = (extra) => debug ? { ...extra } : undefined;
  const dbgLog = [];

  // 1. Página principal do torneio (info)
  const infoPath = `/torneio_painel_info/index/${tournamentId}`;
  let infoHtml;
  try {
    infoHtml = await client.getText(infoPath);
    dbgLog.push({ step: 'info', path: infoPath, len: infoHtml.length });
  } catch (err) {
    return { inscribed: false, confirmed: false, ...(debug ? { debug: { error: 'info ' + err.message, log: dbgLog } } : {}) };
  }

  // 2. Localiza link pra aba Inscrições. TI usa /torneio_painel_insc/
  // (curto). Per-categoria: /torneio_painel_insc/index/<tid>/<catId>.
  const $ = cheerio.load(infoHtml);
  const insc_anchors = [];
  $('a').each((i, a) => {
    const href = ($(a).attr('href') || '').trim();
    const text = $(a).text().trim();
    if (/torneio_painel_insc/i.test(href)) {
      insc_anchors.push({ href, text });
    }
  });

  // Filtra anchors. Se temos categoryHint, restringe ao que casa
  // (ex: "12 Anos Feminino"). Senão, mantém todos (mais lento).
  const normalize = (h) => {
    if (!h) return null;
    if (h.startsWith('http')) return new URL(h).pathname;
    return h.startsWith('/') ? h : '/' + h;
  };
  let matchedAnchors = insc_anchors;
  if (categoryHint) {
    const hintLower = categoryHint.toLowerCase();
    const hinted = insc_anchors.filter(a => a.text.toLowerCase().includes(hintLower));
    if (hinted.length) matchedAnchors = hinted;
  }
  const candidates = [...new Set(matchedAnchors.map(a => normalize(a.href)).filter(Boolean))];
  // Sem candidatos? Tenta path geral
  if (!candidates.length) candidates.push(`/torneio_painel_insc/index/${tournamentId}`);
  dbgLog.push({ step: 'find-inscritos', categoryHint, anchorsFound: insc_anchors.length, candidates });

  // 3. Cada candidato é uma página (geralmente per-categoria). Scannea
  // todas até achar a atleta. Cap em 12 pra não exagerar nos HTTPs.
  const idPattern = new RegExp(`ID\\s*:\\s*${athleteId}\\b`, 'i');
  let foundMatch = null; // { path, window }
  let anyOk = false;
  for (const path of candidates.slice(0, 12)) {
    try {
      const res = await client.request(path);
      if (!res.ok) {
        dbgLog.push({ step: 'page-skip', path, status: res.status });
        continue;
      }
      anyOk = true;
      const pageHtml = await res.text();
      const pageText = elementInnerText(cheerio.load(pageHtml)('body'));
      const m = idPattern.exec(pageText);
      if (m) {
        const window = pageText.slice(Math.max(0, m.index - 200), Math.min(pageText.length, m.index + 400));
        foundMatch = { path, window };
        dbgLog.push({ step: 'page-found', path, status: res.status });
        break;
      } else {
        dbgLog.push({ step: 'page-no-id', path, status: res.status, len: pageHtml.length });
      }
    } catch (err) {
      dbgLog.push({ step: 'page-err', path, error: err.message });
    }
  }
  if (!foundMatch) {
    if (debug) return { inscribed: false, confirmed: false, debug: { log: dbgLog, anyOk } };
    return { inscribed: false, confirmed: false };
  }
  const confirmed = /Confirmado/i.test(foundMatch.window);
  if (debug) return { inscribed: true, confirmed, debug: { log: dbgLog, found: foundMatch } };
  return { inscribed: true, confirmed };
}

export async function fetchTournamentDetails(tournamentId) {
  const url = `${BASE}/torneio_painel_info/index/${tournamentId}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Detalhes retornaram ${res.status}`);
  const html = await res.text();
  return parseDetailsHtml(html, tournamentId, url);
}

function parseDetailsHtml(html, id, url) {
  const $ = cheerio.load(html);
  const titleEl = $('.tournament-title').first();
  // Title might be inside nested anchor
  const name = (titleEl.find('a').last().text() || titleEl.text() || '').trim();
  const localText = $('.tournament-local').first().text().trim();
  let city = null, state = null;
  if (localText) {
    const m = localText.match(/^(.+)-([A-Z]{2})$/);
    if (m) { city = m[1].trim(); state = m[2]; }
  }

  const text = elementInnerText($('body'));

  const lineAfter = (label) => {
    const i = text.indexOf(label);
    if (i < 0) return null;
    const after = text.slice(i + label.length).split('\n').map(l => l.trim()).filter(Boolean);
    return after[0] || null;
  };

  const periodLine = lineAfter('Período Previsto');
  let startDate = null, endDate = null;
  if (periodLine) {
    const m = periodLine.match(/(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
    if (m) { startDate = m[1]; endDate = m[2]; }
  }

  const cancelLine = lineAfter('Cancelamentos até');
  const cancelDeadline = cancelLine?.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || null;

  // Prazo de fechamento das inscrições (≠ cancelDeadline). Texto típico:
  // "Inscrições abertas até 04/05/2026 e cancelamentos até 05/05/2026"
  // OU badge "(13/01/2026 a 04/05/2026)" próximo do status
  let registrationOpensAt = null;
  let registrationDeadline = null;
  const inscrFraseMatch = text.match(/Inscri[cç][oõ]es\s+abertas?\s+at[ée]\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (inscrFraseMatch) registrationDeadline = inscrFraseMatch[1];
  // Fallback: padrão "(DD/MM/YYYY a DD/MM/YYYY)" perto da palavra "Inscrições"
  if (!registrationDeadline) {
    const idx = text.search(/Inscri[cç][oõ]es/i);
    if (idx >= 0) {
      const window = text.slice(idx, idx + 200);
      const m = window.match(/\((\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})\)/);
      if (m) { registrationOpensAt = m[1]; registrationDeadline = m[2]; }
    }
  }

  const prices = {};
  for (const m of text.matchAll(/(NORMAL|COM\/DESCONTO|PROMOCIONAL)\s*\n?\s*(R\$\s*[\d.,]+)/gi)) {
    prices[m[1].toUpperCase()] = m[2];
  }

  const hotels = parseListSection(text, 'Hoteis', ['Demais informações', 'Locais dos Jogos', 'Direção e Arbitragem']);
  const venues = parseVenuesSection(text);

  let observations = null;
  const obsIdx = text.indexOf('Informações/Observações');
  if (obsIdx >= 0) {
    const endMarkers = ['Direção e Arbitragem', 'Categorias', 'Locais dos Jogos'];
    let endIdx = text.length;
    for (const m of endMarkers) {
      const i = text.indexOf(m, obsIdx + 1);
      if (i > 0 && i < endIdx) endIdx = i;
    }
    observations = text.slice(obsIdx + 'Informações/Observações'.length, endIdx).trim().slice(0, 3000);
  }

  // Tiers do panel: 2 fontes complementares
  // a) Categorias formais entre parênteses: "(G1+)" — `)` no fim previne
  //    falsos positivos. Alternação ordenada longest-first pra capturar
  //    "G1+" antes de cair em "G1".
  // b) Texto "CHAVE G1+" / "CHAVE GA" nas observações (alguns torneios têm
  //    múltiplas chaves sequenciais anunciadas só em texto). Lookahead
  //    `(?![+\d])` previne backtrack de G1+ pra G1.
  const tiers = [...new Set([
    ...[...text.matchAll(/\((GA\+|G1\+|GA|G1|G2|G3)\)/g)].map(m => m[1]),
    ...[...text.matchAll(/\bCHAVE\s+(GA\+|G1\+|GA|G1|G2|G3)(?![+\dA-Za-z])/gi)].map(m => m[1].toUpperCase()),
  ])];

  return {
    id, url,
    name: name || $('title').text().trim(),
    city, state, cityState: localText,
    startDate, endDate,
    cancelDeadline, registrationOpensAt, registrationDeadline,
    prices, hotels, venues, observations,
    tiers,
  };
}

function parseListSection(text, label, endLabels) {
  const result = [];
  const idx = text.indexOf(label);
  if (idx < 0) return result;
  const slice = text.slice(idx + label.length);
  const lines = slice.split('\n').map(l => l.trim());
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (endLabels.includes(l)) break;
    if (l === 'Endereco' || l === 'Endereço') { if (cur) cur.address = lines[++i]; continue; }
    if (l === 'Telefone') { if (cur) cur.phone = lines[++i]; continue; }
    if (l === 'Email' || l === 'E-mail') { if (cur) cur.email = lines[++i]; continue; }
    if (/^https?:\/\//.test(l)) { if (cur) cur.url = l; continue; }
    if (/^R\$\s*[\d.,]+/.test(l)) continue;
    if (/^(Single|Duplo|Triplo|Quádruplo|Quadruplo)$/i.test(l)) continue;
    if (cur && cur.name) result.push(cur);
    cur = { name: l };
  }
  if (cur && cur.name) result.push(cur);
  return result;
}

function parseVenuesSection(text) {
  const result = [];
  const idx = text.indexOf('Locais dos Jogos');
  if (idx < 0) return result;
  const endIdx = text.indexOf('Hoteis', idx);
  const slice = text.slice(idx + 'Locais dos Jogos'.length, endIdx > 0 ? endIdx : idx + 5000);
  const lines = slice.split('\n').map(l => l.trim());
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (l === 'Clube') { if (cur) result.push(cur); cur = { name: lines[++i] || null }; continue; }
    if (cur) {
      if (l === 'Endereco' || l === 'Endereço') { cur.address = lines[++i]; continue; }
      if (l === 'Telefone') { cur.phone = lines[++i]; continue; }
      if (l === 'Email' || l === 'E-mail') { cur.email = lines[++i]; continue; }
      if (l.startsWith('Piso de')) { cur.surface = l + ' ' + (lines[++i] || ''); continue; }
      if (l.startsWith('Bola do jogo')) { cur.ball = lines[++i]; continue; }
    }
  }
  if (cur && cur.name) result.push(cur);
  return result;
}

// Debug: roda só os scrapes de inscrição da atleta e retorna o que veio
// de cada página do TI. Útil pra investigar "por que Anna não aparece
// como inscrita nesse torneio". Aceita opção { tid } pra também testar
// a página de Inscritos daquele torneio com cliente autenticado.
export async function debugAthleteInscriptions({ email, password }, opts = {}) {
  const client = new TIClient();
  await client.login(email, password);
  const athlete = await getAthleteInfo(client);
  let programaIds = [];
  let programaError = null;
  try { programaIds = await getProgramaIds(client); }
  catch (err) { programaError = err.message; }
  const annaIds = [...new Set([...athlete.tournamentIds, ...programaIds])];
  const out = {
    athleteId: client.athleteId,
    athleteName: athlete.name,
    profileTournamentIds: athlete.tournamentIds,
    profileTournamentCount: athlete.tournamentIds.length,
    programaIds,
    programaCount: programaIds.length,
    programaError,
    unionIds: annaIds,
    unionCount: annaIds.length,
  };
  if (opts.tid) {
    out.perTournamentCheck = await getAthleteStatusInTournament(opts.tid, client.athleteId, client, { debug: true })
      .catch(err => ({ error: err.message }));
  }
  return out;
}

export async function syncAthlete({ email, password, starredIds = [], yearsToScrape = null }) {
  const client = new TIClient();
  await client.login(email, password);

  const athlete = await getAthleteInfo(client);
  const programaIds = await getProgramaIds(client).catch(() => []);
  const annaIds = new Set([...athlete.tournamentIds, ...programaIds]);

  const pendingPayments = extractPendingPayments(athlete.inicioText);
  const boletoUrls = athlete.boletoUrls || [];
  for (let i = 0; i < pendingPayments.length; i++) {
    pendingPayments[i].boletoUrl = boletoUrls[i] || null;
  }

  // Determine which categories to fetch:
  // 1. Categories detected on the athlete's profile (rankings)
  // 2. Fallback: Juvenil if nothing detected (most common case for parents using this app)
  const categoriesToFetch = athlete.detectedCategories?.length
    ? athlete.detectedCategories
    : [JUVENIL_CATEGORY];

  // Fetch all detected category catalogs in parallel
  const catalogResults = await Promise.all(
    categoriesToFetch.map(cat => fetchCatalog(client, { category: cat }).catch(() => []))
  );
  // Dedupe by tournament id (a tournament shouldn't appear in two categories, but be safe)
  const seenIds = new Set();
  const catalog = [];
  for (let i = 0; i < catalogResults.length; i++) {
    const cat = categoriesToFetch[i];
    for (const t of catalogResults[i]) {
      if (seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      catalog.push({ ...t, tiCategoryId: cat });
    }
  }

  const pendingByName = new Map();
  for (const p of pendingPayments) pendingByName.set(normalizeName(p.tournamentName), p);

  const tournaments = catalog.map(t => {
    const pp = pendingByName.get(normalizeName(t.name)) || null;
    return {
      ...t,
      isAnnaInscribed: annaIds.has(t.id) || !!pp,
      pendingPayment: pp,
    };
  });

  const catalogIds = new Set(catalog.map(t => t.id));
  const missing = [...annaIds].filter(id => !catalogIds.has(id));
  const missingDetails = await Promise.all(
    missing.map(id => fetchTournamentDetails(id).catch(() => null))
  );
  for (const det of missingDetails) {
    if (!det) continue;
    const pp = pendingByName.get(normalizeName(det.name)) || null;
    const detTiers = (det.tiers && det.tiers.length) ? det.tiers : (extractTier(det.name) ? [extractTier(det.name)] : []);
    tournaments.push({
      ...det,
      tier: detTiers[0] || null,
      tiers: detTiers,
      isAnnaInscribed: true,
      pendingPayment: pp,
    });
  }

  // Enrich starred (todos: passados ou futuros) + inscritos/pendentes futuros com detalhes
  // (hoteis, preços, tiers reais, cancelDeadline). ~1 HTTP request por torneio.
  // Limitado a 60 pra não atrapalhar — aumenta cobertura sem explodir tempo de sync.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isFutureWithStartDate = (t) => {
    if (!t.startDate) return false;
    const [d, m, y] = t.startDate.split('/').map(Number);
    return new Date(y, m - 1, d) >= today;
  };
  const enrichSet = new Set([
    ...starredIds,
    // inscritos/pendentes futuros sem estrela ainda
    ...tournaments
      .filter(t => (t.isAnnaInscribed || !!t.pendingPayment) && t.startDate)
      .map(t => t.id),
    // "Iniciado" / "Confirmado" — status vagos onde a página de detalhes
    // tem datas concretas (registrationOpensAt + registrationDeadline)
    // que vão definir o estado real da janela de inscrição.
    ...tournaments
      .filter(t => /inicia|confirmado/i.test(t.registrationStatus || '') && isFutureWithStartDate(t))
      .map(t => t.id),
  ]);
  const tournamentsById = new Map(tournaments.map(t => [t.id, t]));
  const toEnrich = [...enrichSet]
    .filter(id => tournamentsById.has(id))
    .slice(0, 60);

  if (toEnrich.length) {
    const enrichResults = await Promise.all(
      toEnrich.map(id => fetchTournamentDetails(id).catch(() => null))
    );
    for (const det of enrichResults) {
      if (!det) continue;
      const t = tournamentsById.get(det.id);
      if (!t) continue;
      // Merge: prefer existing values, but bring in details when missing or from richer source.
      t.hotels = det.hotels && det.hotels.length ? det.hotels : (t.hotels || []);
      t.venues = det.venues && det.venues.length ? det.venues : (t.venues || []);
      t.prices = det.prices && Object.keys(det.prices).length ? det.prices : (t.prices || {});
      if (det.observations) t.observations = det.observations;
      if (det.cancelDeadline) t.cancelDeadline = det.cancelDeadline;
      if (det.registrationOpensAt) t.registrationOpensAt = det.registrationOpensAt;
      if (det.registrationDeadline) t.registrationDeadline = det.registrationDeadline;
      // Tiers: union of catalog tiers + details tiers
      const all = new Set([...(t.tiers || []), ...(det.tiers || [])]);
      if (all.size) {
        t.tiers = [...all];
        if (!t.tier) t.tier = t.tiers[0];
      }
    }
  }

  // Source-of-truth: a página /torneio_painel_insc do torneio é canônica
  // pra "atleta inscrita". O perfil dela pode estar atrasado em horas/dias.
  // Otimização: passa categoryHint da atleta pra reduzir scan de 8-12
  // anchors per-categoria pra 1 anchor da categoria correspondente.
  if (client.athleteId) {
    const hints = (athlete.detectedCategories || [])
      .map(c => CATEGORY_HINTS[c])
      .filter(Boolean);
    const primaryHint = hints[0] || null;

    const cutoffPast = new Date(); cutoffPast.setDate(cutoffPast.getDate() - 7);
    const cutoffFuture = new Date(); cutoffFuture.setDate(cutoffFuture.getDate() + 120);
    const inScope = (t) => {
      if (!t.startDate) return false;
      const [d, m, y] = t.startDate.split('/').map(Number);
      const date = new Date(y, m - 1, d);
      return date >= cutoffPast && date <= cutoffFuture;
    };
    const candidates = tournaments.filter(inScope).slice(0, 200);

    // Concorrência limitada: 8 simultâneos pra não saturar TI.
    const CONCURRENCY = 8;
    const results = new Map();
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(t => getAthleteStatusInTournament(t.id, client.athleteId, client, { categoryHint: primaryHint }).catch(() => null))
      );
      for (let j = 0; j < batch.length; j++) {
        if (batchResults[j]) results.set(batch[j].id, batchResults[j]);
      }
    }

    for (const t of tournaments) {
      const status = results.get(t.id);
      if (!status) continue;
      if (status.inscribed) t.isAnnaInscribed = true;
      if (status.confirmed) t.isAnnaConfirmada = true;
    }
    console.log(`[sync] inscritos check: ${candidates.length} torneios, ${[...results.values()].filter(r => r.inscribed).length} inscrita`);
  }

  // Ranking regional (qualquer UF — detecta dinamicamente da página do TI)
  const currentYear = new Date().getFullYear();
  const nationalRanking12F = (athlete.rankings || []).find(r => r.year === currentYear && r.category === '12F') || null;
  const regionalRanking = await getRegionalPosition(client, client.athleteId, '12F').catch(() => null);
  const desempenho = await getDesempenho(client).catch(() => null);

  // Matches scrape — em paralelo por ano. yearsToScrape vem do sync-manager
  // (decide backfill vs incremental). null = pula scrape.
  let matchesByYear = null;
  if (yearsToScrape && yearsToScrape.length) {
    const { fetchAthleteMatches } = await import('./match-scraper.js');
    const results = await Promise.all(
      yearsToScrape.map(y =>
        fetchAthleteMatches(client, client.athleteId, y)
          .then(matches => ({ year: y, matches }))
          .catch(err => {
            console.error(`[sync] matches ${y} falhou:`, err.message);
            return { year: y, matches: null };
          })
      )
    );
    matchesByYear = {};
    for (const r of results) {
      if (r.matches) matchesByYear[r.year] = r.matches;
    }
  }

  return {
    athlete: {
      id: client.athleteId,
      name: athlete.name,
      profileUrl: `${BASE}/perfil2/inicio/${client.athleteId}`,
      wtn: athlete.wtn || null,
      about: athlete.about || null,
      hand: athlete.hand || null,
      rankingNational: nationalRanking12F,           // { year, category, points, position }
      rankingRegional: regionalRanking,              // { uf, regionalPosition, totalRegional, cutoffDate } | null
      rankingsAll: athlete.rankings || [],           // all rankings on profile
      desempenho,                                     // { byYear: [...], total: {...} } | null
      categories: categoriesToFetch.map(id => ({
        id,
        name: TI_CATEGORIES.find(c => c.id === id)?.name || `Categoria ${id}`,
      })),
    },
    tournaments,
    matchesByYear,                                    // { 2026: [...], 2025: [...] } ou null
    syncedAt: new Date().toISOString(),
  };
}

export function deriveStatus(t, today = new Date()) {
  if (!t.startDate || !t.endDate) return 'unknown';
  const parse = (s) => {
    const [d, m, y] = s.split('/').map(Number);
    return new Date(y, m - 1, d);
  };
  const start = parse(t.startDate);
  const end = parse(t.endDate);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (t0 < start) return 'upcoming';
  if (t0 > end) return 'past';
  return 'ongoing';
}
