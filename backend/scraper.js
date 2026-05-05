// HTTP-only scraper for Tênis Integrado.
// Uses cheerio for HTML parsing — no Chromium/Puppeteer needed.

import * as cheerio from 'cheerio';
import { TIClient } from './ti-client.js';

const BASE = 'https://www.tenisintegrado.com.br';
const JUVENIL_CATEGORY = 2;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function extractTier(name) {
  if (!name) return null;
  if (/\bG1\+/.test(name)) return 'G1+';
  if (/\bG1\b/.test(name)) return 'G1';
  if (/\bG2\b/.test(name)) return 'G2';
  if (/\bG3\b/.test(name)) return 'G3';
  if (/\bGA\b/.test(name)) return 'GA';
  if (/Federa[çc]/i.test(name)) return 'Federações';
  if (/Brasileir[ãa]o/i.test(name)) return 'GA';
  if (/Circuito Nacional|Nacional CBT/i.test(name)) return 'GA';
  return null;
}

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

  // Athlete name: first anchor matching a name pattern
  let name = null;
  $('a').each((i, a) => {
    const t = $(a).text().trim();
    if (/^[A-ZÀ-Ý][a-zà-ý]+(\s+[A-ZÀ-Ý][a-zà-ý]+){1,3}$/.test(t)) { name = t; return false; }
  });

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

  return {
    name: name || 'Atleta',
    tournamentIds: [...tournamentIds],
    inicioText,
    boletoUrls: [...new Set(boletoUrls)],
  };
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
    const tiersFromRanking = [...new Set(
      [...r.rankingText.matchAll(/(GA\+|GA|G1\+|G1|G2|G3)\b/g)].map(m => m[1])
    )];
    const fallback = extractTier(r.name);
    const tiers = tiersFromRanking.length ? tiersFromRanking : (fallback ? [fallback] : []);
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

  return {
    id, url,
    name: name || $('title').text().trim(),
    city, state, cityState: localText,
    startDate, endDate,
    cancelDeadline, prices, hotels, venues, observations,
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

export async function syncAthlete({ email, password }) {
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

  const catalog = await fetchCatalog(client, { category: JUVENIL_CATEGORY });

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
    tournaments.push({ ...det, tier: extractTier(det.name), isAnnaInscribed: true, pendingPayment: pp });
  }

  return {
    athlete: { id: client.athleteId, name: athlete.name, profileUrl: `${BASE}/perfil2/inicio/${client.athleteId}` },
    tournaments,
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
