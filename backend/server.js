import 'dotenv/config';
import express from 'express';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  listProfiles, getProfile, createProfile, updateProfile, deleteProfile,
  getSyncedData, getNotes, updateTournamentNotes,
  ensureCalendarToken, findProfileByCalendarToken, claimOrphanProfiles,
} from './storage.js';
import { syncProfile, getSyncStatus } from './sync-manager.js';
import { deriveStatus, fetchTournamentDetails } from './scraper.js';
import {
  createUser, authenticate, signCookie, authMiddleware, requireAuth,
  userCount, listUsers,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(authMiddleware);

const COOKIE_OPTIONS = (req) => {
  const isHttps = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isHttps ? 'Secure' : '',
    'Max-Age=2592000', // 30 days
  ].filter(Boolean).join('; ');
};

// ===== Auth =====
app.get('/api/auth/me', (req, res) => {
  res.json({ userId: req.userId || null, email: req.userEmail || null, hasUsers: userCount() > 0 });
});

app.post('/api/auth/signup', (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = createUser({ email, password });
    if (user.isFirst) {
      const claimed = claimOrphanProfiles(user.id);
      if (claimed > 0) console.log(`[auth] Primeiro usuário ${user.email} herdou ${claimed} perfis existentes.`);
    }
    res.setHeader('Set-Cookie', `session=${signCookie(user.id)}; ${COOKIE_OPTIONS(req)}`);
    res.status(201).json({ userId: user.id, email: user.email });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = authenticate(email, password);
  if (!user) return res.status(401).json({ error: 'Email ou senha inválidos' });
  res.setHeader('Set-Cookie', `session=${signCookie(user.id)}; ${COOKIE_OPTIONS(req)}`);
  res.json({ userId: user.id, email: user.email });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `session=; Path=/; HttpOnly; Max-Age=0`);
  res.status(204).end();
});

app.use(express.static(join(__dirname, '..', 'frontend')));

// Profiles — all scoped to req.userId
app.get('/api/profiles', requireAuth, (req, res) => {
  res.json(listProfiles(req.userId));
});

app.post('/api/profiles', requireAuth, (req, res) => {
  const { athleteName, tiEmail, tiPassword, originAirport, originCity } = req.body || {};
  if (!tiEmail || !tiPassword) {
    return res.status(400).json({ error: 'tiEmail e tiPassword são obrigatórios' });
  }
  const profile = createProfile({ userId: req.userId, athleteName, tiEmail, tiPassword, originAirport, originCity });
  res.status(201).json(profile);
});

function ensureOwnedProfile(req, res, next) {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });
  if (p.userId && p.userId !== req.userId) return res.status(403).json({ error: 'Acesso negado' });
  next();
}

app.patch('/api/profiles/:id', requireAuth, ensureOwnedProfile, (req, res) => {
  const updated = updateProfile(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Perfil não encontrado' });
  res.json(updated);
});

app.delete('/api/profiles/:id', requireAuth, ensureOwnedProfile, (req, res) => {
  deleteProfile(req.params.id);
  res.status(204).end();
});

// Sync — only triggered explicitly by the user
app.post('/api/profiles/:id/sync', requireAuth, ensureOwnedProfile, (req, res) => {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });
  syncProfile(req.params.id).catch(err => console.error(`[sync ${req.params.id}]`, err.message));
  res.json({ status: 'started' });
});

app.get('/api/profiles/:id/sync-status', requireAuth, ensureOwnedProfile, (req, res) => {
  res.json({
    ...getSyncStatus(req.params.id),
    syncedAt: getSyncedData(req.params.id)?.syncedAt || null,
  });
});

// Tournaments — single source of truth, server applies derivedStatus and merges notes
app.get('/api/profiles/:id/tournaments', requireAuth, ensureOwnedProfile, (req, res) => {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });

  const data = getSyncedData(req.params.id);
  const notes = getNotes(req.params.id);

  const today = new Date();
  const tournaments = (data?.tournaments || []).map(t => ({
    ...t,
    derivedStatus: deriveStatus(t, today),
    notes: notes[t.id] || null,
  }));

  res.json({
    athlete: data?.athlete || { name: p.athleteName },
    profile: { id: p.id, originAirport: p.originAirport, originCity: p.originCity, athleteName: p.athleteName },
    tournaments,
    syncedAt: data?.syncedAt || null,
  });
});

app.get('/api/profiles/:id/tournaments/:tid', requireAuth, ensureOwnedProfile, (req, res) => {
  const data = getSyncedData(req.params.id);
  if (!data) return res.status(404).json({ error: 'Sem dados sincronizados' });
  const t = (data.tournaments || []).find(x => x.id === req.params.tid);
  if (!t) return res.status(404).json({ error: 'Torneio não encontrado' });
  const notes = getNotes(req.params.id)[req.params.tid] || null;
  res.json({ ...t, derivedStatus: deriveStatus(t), notes });
});

app.patch('/api/profiles/:id/tournaments/:tid/notes', requireAuth, ensureOwnedProfile, (req, res) => {
  const updated = updateTournamentNotes(req.params.id, req.params.tid, req.body || {});
  res.json(updated);
});

// Lazy-load full tournament details (hotels, venues, observations) — public endpoint, with cache
const detailsCache = new Map(); // tid -> { data, ts }
const DETAILS_TTL = 6 * 60 * 60 * 1000; // 6h
app.get('/api/tournament-details/:tid', async (req, res) => {
  const tid = req.params.tid;
  const cached = detailsCache.get(tid);
  if (cached && Date.now() - cached.ts < DETAILS_TTL) {
    return res.json(cached.data);
  }
  try {
    const data = await fetchTournamentDetails(tid);
    detailsCache.set(tid, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Flight search URL builder — only for future tournaments
app.get('/api/profiles/:id/tournaments/:tid/flight-url', requireAuth, ensureOwnedProfile, (req, res) => {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });
  const data = getSyncedData(req.params.id);
  const t = data?.tournaments?.find(x => x.id === req.params.tid);
  if (!t) return res.status(404).json({ error: 'Torneio não encontrado' });
  if (!t.city || !t.startDate || !t.endDate) {
    return res.status(400).json({ error: 'Torneio sem cidade ou datas' });
  }

  const destAirport = inferAirport(t.city, t.state);
  if (!destAirport) {
    return res.status(400).json({ error: `Aeroporto da cidade "${t.city}" não cadastrado` });
  }
  const origin = (p.originAirport || 'BSB').toUpperCase();
  const dest = destAirport.toUpperCase();

  const startISO = brToIso(t.startDate);
  const endISO = brToIso(t.endDate);
  const arrival = addDays(startISO, -1);
  const ret = addDays(endISO, 1);

  // Kayak — deep link com pre-fill confiável
  const kayakUrl = `https://www.kayak.com.br/flights/${origin}-${dest}/${arrival}/${ret}`;

  // Skyscanner — yymmdd nas datas
  const yymmdd = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
  const skyUrl = `https://www.skyscanner.com.br/transporte/passagens-aereas/${origin.toLowerCase()}/${dest.toLowerCase()}/${yymmdd(arrival)}/${yymmdd(ret)}/`;

  // Decolar (BR) — formato roundtrip
  const decolarUrl = `https://www.decolar.com/shop/flights-search/roundtrip/${origin}/${dest}/${arrival}/${ret}/1/0/0`;

  res.json({
    origin, dest, arrival, ret,
    links: [
      { name: 'Kayak', url: kayakUrl, primary: true },
      { name: 'Skyscanner', url: skyUrl },
      { name: 'Decolar', url: decolarUrl },
    ],
    url: kayakUrl,
  });
});

function brToIso(s) {
  if (!s) return null;
  const [d, m, y] = s.split('/').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(iso, n) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const AIRPORT_BY_CITY = {
  'belo horizonte': 'CNF',
  'sao paulo': 'GRU', 'são paulo': 'GRU',
  'rio de janeiro': 'GIG',
  'brasilia': 'BSB', 'brasília': 'BSB',
  'porto alegre': 'POA',
  'curitiba': 'CWB',
  'recife': 'REC',
  'salvador': 'SSA',
  'fortaleza': 'FOR',
  'natal': 'NAT',
  'manaus': 'MAO',
  'belem': 'BEL', 'belém': 'BEL',
  'goiania': 'GYN', 'goiânia': 'GYN',
  'florianopolis': 'FLN', 'florianópolis': 'FLN',
  'vitoria': 'VIX', 'vitória': 'VIX',
  'cuiaba': 'CGB', 'cuiabá': 'CGB',
  'campo grande': 'CGR',
  'uberlandia': 'UDI', 'uberlândia': 'UDI',
  'londrina': 'LDB',
  'maringa': 'MGF', 'maringá': 'MGF',
  'campinas': 'VCP',
  'joao pessoa': 'JPA', 'joão pessoa': 'JPA',
  'maceio': 'MCZ', 'maceió': 'MCZ',
  'aracaju': 'AJU',
  'sao luis': 'SLZ', 'são luís': 'SLZ',
  'teresina': 'THE',
  'porto velho': 'PVH',
  'rio branco': 'RBR',
  'palmas': 'PMW',
  'macapa': 'MCP', 'macapá': 'MCP',
  'boa vista': 'BVB',
  'sao jose dos campos': 'SJK', 'são josé dos campos': 'SJK',
  'niteroi': 'GIG', 'niterói': 'GIG',
  'colombo': 'CWB',
  'novo hamburgo': 'POA',
  'nova lima': 'CNF',
};

function inferAirport(city, state) {
  if (!city) return null;
  const norm = city.toLowerCase().trim();
  return AIRPORT_BY_CITY[norm] || null;
}

// Public iCal feed — anyone with the token can subscribe
app.get('/calendar/:token.ics', (req, res) => {
  const profile = findProfileByCalendarToken(req.params.token);
  if (!profile) return res.status(404).type('text/plain').send('Calendar não encontrado');
  const synced = getSyncedData(profile.id);
  const notes = getNotes(profile.id);
  const tournaments = (synced?.tournaments || []).map(t => ({
    ...t,
    notes: notes[t.id] || null,
  }));
  const ics = buildIcsFeed(tournaments, profile);
  res.type('text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="agenda-${profile.athleteName || 'tenis'}.ics"`);
  res.send(ics);
});

// Returns the calendar token for a profile (creates one if missing)
app.get('/api/profiles/:id/calendar-token', requireAuth, ensureOwnedProfile, (req, res) => {
  const token = ensureCalendarToken(req.params.id);
  if (!token) return res.status(404).json({ error: 'Perfil não encontrado' });
  res.json({ token });
});

function buildIcsFeed(tournaments, profile) {
  const fmt = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };
  const fmtDateOnly = (s) => {
    if (!s) return null;
    const [d, m, y] = s.split('/');
    return `${y}${m}${d}`;
  };
  const escape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AgendaTenisIntegrado//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(`Tênis - ${profile.athleteName || 'Atleta'}`)}`,
    `X-WR-CALDESC:Torneios e lembretes de pagamento`,
    'X-WR-TIMEZONE:America/Sao_Paulo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  const now = new Date();

  // Tournament events (only starred ones)
  for (const t of tournaments) {
    if (!t.notes?.selected) continue;
    if (!t.startDate || !t.endDate) continue;
    const start = fmtDateOnly(t.startDate);
    const endDate = fmtDateOnly(t.endDate);
    if (!start || !endDate) continue;
    // iCal DTEND for all-day events is exclusive — add 1 day
    const [ey, em, ed] = [endDate.slice(0,4), endDate.slice(4,6), endDate.slice(6,8)].map(Number);
    const endNext = new Date(Date.UTC(ey, em - 1, ed + 1));
    const endStr = `${endNext.getUTCFullYear()}${String(endNext.getUTCMonth()+1).padStart(2,'0')}${String(endNext.getUTCDate()).padStart(2,'0')}`;

    const desc = [
      t.tier && `Nível: ${t.tier}`,
      t.isAnnaInscribed && '✓ Inscrita',
      t.cancelDeadline && `Cancelamento até: ${t.cancelDeadline}`,
      t.notes?.flight && `Voo: ${t.notes.flight}`,
      t.notes?.hotel && `Hotel: ${t.notes.hotel}`,
      t.notes?.transport && `Transporte: ${t.notes.transport}`,
      t.notes?.cost && `Custo: ${t.notes.cost}`,
      t.notes?.general && `Notas: ${t.notes.general}`,
      '',
      `Detalhes: ${t.url || ''}`,
    ].filter(Boolean).join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:tournament-${t.id}@agenda-tenis-integrado`,
      `DTSTAMP:${fmt(now)}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${endStr}`,
      `SUMMARY:🎾 ${escape(t.name || 'Torneio')}`,
      `DESCRIPTION:${escape(desc)}`,
      `LOCATION:${escape([t.city, t.state].filter(Boolean).join(' / '))}`,
      `URL:${t.url || ''}`,
      'END:VEVENT',
    );
  }

  // Payment reminders
  for (const t of tournaments) {
    const pp = t.pendingPayment;
    if (!pp?.dueDate) continue;
    const [d, m, y] = pp.dueDate.split('/').map(Number);
    const due = new Date(y, m - 1, d);
    const reminder = new Date(due);
    reminder.setDate(reminder.getDate() - 1);
    reminder.setHours(9, 0, 0, 0);
    const end = new Date(reminder.getTime() + 30 * 60 * 1000);

    const desc = [
      pp.category && `Categoria: ${pp.category}`,
      pp.value && `Valor: ${pp.value}`,
      `Vence: ${pp.dueDate} (16h horário de Brasília)`,
      '',
      pp.boletoUrl && `Boleto: ${pp.boletoUrl}`,
    ].filter(Boolean).join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:payment-${t.id}@agenda-tenis-integrado`,
      `DTSTAMP:${fmt(now)}`,
      `DTSTART:${fmt(reminder)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:💰 Pagar inscrição: ${escape(t.name || 'torneio')}`,
      `DESCRIPTION:${escape(desc)}`,
      pp.boletoUrl && `URL:${pp.boletoUrl}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Pagar inscrição',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).join('\r\n');
}

app.post('/api/shutdown', (req, res) => {
  res.json({ status: 'shutting-down' });
  console.log('\n👋 Encerrando o servidor a pedido do app...');
  setTimeout(() => process.exit(0), 200);
});

function getLanIps() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

const PORT = process.env.PORT || 4173;
app.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLanIps();
  console.log('\n  📅 Agenda Tênis Integrado rodando em:');
  console.log(`     • http://localhost:${PORT}                 ← este Mac`);
  for (const ip of lanIps) {
    console.log(`     • http://${ip}:${PORT}        ← celular/iPad na mesma WiFi`);
  }
  console.log('');
});
