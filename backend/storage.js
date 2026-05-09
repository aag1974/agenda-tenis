import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { COLUMNS } from './board.js';

const COLUMN_LABEL_BY_ID = Object.fromEntries(COLUMNS.map(c => [c.id, c.label]));
const labelOfColumn = (id) => COLUMN_LABEL_BY_ID[id] || id;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '..', 'data');
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');
const SECRET_FILE = join(DATA_DIR, '.secret');

mkdirSync(DATA_DIR, { recursive: true });

function getSecret() {
  if (!existsSync(SECRET_FILE)) {
    const s = randomBytes(32).toString('hex');
    writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
  return readFileSync(SECRET_FILE, 'utf8').trim();
}

const SECRET = getSecret();
const KEY = scryptSync(SECRET, 'agenda-tenis', 32);

export function encrypt(plaintext) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function decrypt(payload) {
  const [ivHex, tagHex, encHex] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

export function listProfiles({ userId = null, householdId = null } = {}) {
  return readJson(PROFILES_FILE, [])
    .filter(p => {
      if (householdId) {
        if (p.householdId) return p.householdId === householdId;
        return p.userId === householdId; // legado
      }
      if (userId) return p.userId === userId;
      return true;
    })
    .map(p => ({
      id: p.id,
      userId: p.userId || null,
      householdId: p.householdId || null,
      athleteName: p.athleteName,
      tiEmail: p.tiEmail,
      originAirport: p.originAirport,
      originCity: p.originCity,
      calendarToken: p.calendarToken || null,
      createdAt: p.createdAt,
    }));
}

// Migration helper: claim all profiles without userId for the given user.
// Called when first user signs up so they "inherit" any pre-existing local data.
export function claimOrphanProfiles(userId) {
  const all = readJson(PROFILES_FILE, []);
  let claimed = 0;
  for (const p of all) {
    if (!p.userId) { p.userId = userId; claimed++; }
  }
  if (claimed > 0) writeJson(PROFILES_FILE, all);
  return claimed;
}

export function getProfile(id) {
  const all = readJson(PROFILES_FILE, []);
  return all.find(p => p.id === id);
}

export function getProfileCredentials(id) {
  const p = getProfile(id);
  if (!p) return null;
  return { email: p.tiEmail, password: decrypt(p.tiPassword) };
}

export function createProfile({ userId, householdId, athleteName, tiEmail, tiPassword, originAirport, originCity }) {
  const all = readJson(PROFILES_FILE, []);
  const id = randomBytes(8).toString('hex');
  const calendarToken = randomBytes(20).toString('hex');
  const profile = {
    id,
    userId: userId || null,
    householdId: householdId || userId || null,
    athleteName: athleteName || null,
    tiEmail,
    tiPassword: encrypt(tiPassword),
    originAirport: originAirport || 'BSB',
    originCity: originCity || 'Brasília',
    calendarToken,
    createdAt: new Date().toISOString(),
  };
  all.push(profile);
  writeJson(PROFILES_FILE, all);
  return { id, ...profile, tiPassword: undefined };
}

export function ensureCalendarToken(profileId) {
  const all = readJson(PROFILES_FILE, []);
  const idx = all.findIndex(p => p.id === profileId);
  if (idx < 0) return null;
  if (!all[idx].calendarToken) {
    all[idx].calendarToken = randomBytes(20).toString('hex');
    writeJson(PROFILES_FILE, all);
  }
  return all[idx].calendarToken;
}

export function findProfileByCalendarToken(token) {
  const all = readJson(PROFILES_FILE, []);
  return all.find(p => p.calendarToken === token) || null;
}

export function updateProfile(id, updates) {
  const all = readJson(PROFILES_FILE, []);
  const idx = all.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const p = all[idx];
  if (updates.athleteName !== undefined) p.athleteName = updates.athleteName;
  if (updates.tiEmail !== undefined) p.tiEmail = updates.tiEmail;
  if (updates.tiPassword !== undefined) p.tiPassword = encrypt(updates.tiPassword);
  if (updates.originAirport !== undefined) p.originAirport = updates.originAirport;
  if (updates.originCity !== undefined) p.originCity = updates.originCity;
  writeJson(PROFILES_FILE, all);
  return { ...p, tiPassword: undefined };
}

export function deleteProfile(id) {
  const all = readJson(PROFILES_FILE, []);
  const filtered = all.filter(p => p.id !== id);
  writeJson(PROFILES_FILE, filtered);
  const dir = profileDir(id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function profileDir(id) { return join(DATA_DIR, `profile-${id}`); }

export function getSyncedData(profileId) {
  return readJson(join(profileDir(profileId), 'synced.json'), null);
}

export function saveSyncedData(profileId, data) {
  writeJson(join(profileDir(profileId), 'synced.json'), data);
}

// ===== Matches (histórico de jogos disputados) =====
// Armazenado separado do synced.json pra não inchar o JSON principal e
// permitir scrape incremental por ano.
//
// Shape: { matches: [...], lastScraped: { '2026': isoTs, '2025': isoTs, ... } }
export function getMatchesData(profileId) {
  return readJson(join(profileDir(profileId), 'matches.json'), { matches: [], lastScraped: {} });
}

export function saveMatchesData(profileId, data) {
  writeJson(join(profileDir(profileId), 'matches.json'), data);
}

// Merge: substitui matches do ano dado pelos novos (idempotente — re-scrape
// não duplica), preserva matches de outros anos. Dedupe defensivo por id
// (caso o scraper retorne o mesmo match em anos diferentes — bug histórico
// quando o filtro de ano não funcionava).
export function upsertYearMatches(profileId, year, newMatches) {
  const cur = getMatchesData(profileId);
  const filtered = (cur.matches || []).filter(m => m.year !== year);
  const merged = [...filtered, ...newMatches];
  // Dedupe por id — se aparecer o mesmo id em anos diferentes, mantém só o
  // do ano mais recente (provavelmente é o "verdadeiro").
  const byId = new Map();
  for (const m of merged) {
    const ex = byId.get(m.id);
    if (!ex || (m.year || 0) > (ex.year || 0)) byId.set(m.id, m);
  }
  const deduped = [...byId.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  cur.matches = deduped;
  cur.lastScraped = { ...(cur.lastScraped || {}), [year]: new Date().toISOString() };
  saveMatchesData(profileId, cur);
  return cur;
}

export function getNotes(profileId) {
  return readJson(join(profileDir(profileId), 'notes.json'), {});
}

export function saveNotes(profileId, notes) {
  writeJson(join(profileDir(profileId), 'notes.json'), notes);
}

export function updateTournamentNotes(profileId, tournamentId, patch) {
  const notes = getNotes(profileId);
  notes[tournamentId] = { ...(notes[tournamentId] || {}), ...patch, updatedAt: new Date().toISOString() };
  saveNotes(profileId, notes);
  return notes[tournamentId];
}

// Reset radical — apaga synced.json + notes.json + manual.json + activity
// + alertas. Preserva o perfil (creds TI). Próxima sync vira baseline novo.
export function resetProfileData(profileId) {
  const dir = profileDir(profileId);
  const files = ['synced.json', 'notes.json', 'manual.json', 'alert-events.json'];
  for (const f of files) {
    const path = join(dir, f);
    if (existsSync(path)) rmSync(path);
  }
}

// Limpa apenas overrides manuais de coluna/ordem — preserva tudo o resto
// (selected, comments, labels, manualInscribed, manualGiveUp, pinned).
// Cada card volta a obedecer a regra de auto-placement.
export function clearColumnOverrides(profileId) {
  const notes = getNotes(profileId);
  let changed = 0;
  for (const tid of Object.keys(notes)) {
    const n = notes[tid];
    if (!n) continue;
    if (n.column != null || n.cardOrder != null) {
      delete n.column;
      delete n.cardOrder;
      changed++;
    }
  }
  if (changed) saveNotes(profileId, notes);
  return changed;
}

// ===== Kanban — comments, activity, column =====
function ensureNoteShape(notes, tournamentId) {
  const cur = notes[tournamentId] || {};
  if (!Array.isArray(cur.comments)) cur.comments = [];
  if (!Array.isArray(cur.activity)) cur.activity = [];
  notes[tournamentId] = cur;
  return cur;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function setCardColumn(profileId, tournamentId, column, { addActivity = true } = {}) {
  const notes = getNotes(profileId);
  const note = ensureNoteShape(notes, tournamentId);
  const previousColumn = note.column || null;
  note.column = column;
  note.columnSetAt = new Date().toISOString();
  note.updatedAt = note.columnSetAt;
  if (addActivity && previousColumn !== column) {
    note.activity.push({
      id: newId(),
      type: 'column_change',
      message: `Movido para "${labelOfColumn(column)}"${previousColumn ? ` (de "${labelOfColumn(previousColumn)}")` : ''}`,
      createdAt: new Date().toISOString(),
      auto: false,
    });
  }
  saveNotes(profileId, notes);
  return note;
}

export function addCardComment(profileId, tournamentId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Comentário vazio');
  if (trimmed.length > 5000) throw new Error('Comentário muito longo (max 5000 caracteres)');
  const notes = getNotes(profileId);
  const note = ensureNoteShape(notes, tournamentId);
  const entry = {
    id: newId(),
    text: trimmed,
    createdAt: new Date().toISOString(),
  };
  note.comments.push(entry);
  note.updatedAt = entry.createdAt;
  saveNotes(profileId, notes);
  return entry;
}

export function updateCardComment(profileId, tournamentId, commentId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Comentário vazio');
  const notes = getNotes(profileId);
  const note = ensureNoteShape(notes, tournamentId);
  const c = note.comments.find(c => c.id === commentId);
  if (!c) return null;
  c.text = trimmed;
  c.updatedAt = new Date().toISOString();
  note.updatedAt = c.updatedAt;
  saveNotes(profileId, notes);
  return c;
}

export function deleteCardComment(profileId, tournamentId, commentId) {
  const notes = getNotes(profileId);
  const note = ensureNoteShape(notes, tournamentId);
  const before = note.comments.length;
  note.comments = note.comments.filter(c => c.id !== commentId);
  if (note.comments.length === before) return false;
  note.updatedAt = new Date().toISOString();
  saveNotes(profileId, notes);
  return true;
}

export function addAutoActivity(profileId, tournamentId, entries) {
  if (!entries || !entries.length) return;
  const notes = getNotes(profileId);
  const note = ensureNoteShape(notes, tournamentId);
  note.activity.push(...entries);
  note.updatedAt = new Date().toISOString();
  saveNotes(profileId, notes);
}

export function getCardActivity(profileId, tournamentId) {
  const notes = getNotes(profileId);
  const note = ensureNoteShape(notes, tournamentId);
  // Combined timeline: comments tagged as 'comment', activity entries with their own type
  const items = [
    ...note.comments.map(c => ({ ...c, kind: 'comment', auto: false })),
    ...note.activity.map(a => ({ ...a, kind: 'activity' })),
  ];
  items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return items;
}

// ===== Alertas =====
// Regras criadas pelo usuário e eventos disparados pelo sync.
// Regra: { id, type, params, enabled, createdAt, label? }
// Evento: { id, ruleId, ruleType, message, tournamentId?, createdAt, seen }
function alertsFile(profileId, kind) {
  return join(profileDir(profileId), `alert-${kind}.json`);
}

export function getAlertRules(profileId) {
  return readJson(alertsFile(profileId, 'rules'), []);
}

export function saveAlertRules(profileId, rules) {
  writeJson(alertsFile(profileId, 'rules'), rules);
}

export function addAlertRule(profileId, rule) {
  const rules = getAlertRules(profileId);
  const full = {
    id: newId(),
    enabled: true,
    createdAt: new Date().toISOString(),
    ...rule,
  };
  rules.push(full);
  saveAlertRules(profileId, rules);
  return full;
}

export function updateAlertRule(profileId, ruleId, patch) {
  const rules = getAlertRules(profileId);
  const idx = rules.findIndex(r => r.id === ruleId);
  if (idx < 0) return null;
  rules[idx] = { ...rules[idx], ...patch, id: rules[idx].id };
  saveAlertRules(profileId, rules);
  return rules[idx];
}

export function deleteAlertRule(profileId, ruleId) {
  const rules = getAlertRules(profileId).filter(r => r.id !== ruleId);
  saveAlertRules(profileId, rules);
}

export function getAlertEvents(profileId) {
  return readJson(alertsFile(profileId, 'events'), []);
}

export function saveAlertEvents(profileId, events) {
  writeJson(alertsFile(profileId, 'events'), events);
}

// Cap mantido pequeno — alertas antigos não precisam ficar pra sempre.
const ALERT_EVENTS_CAP = 200;

export function addAlertEvents(profileId, newEvents) {
  if (!newEvents?.length) return [];
  const events = getAlertEvents(profileId);
  const seen = new Set(events.map(e => e.dedupeKey).filter(Boolean));
  const added = [];
  for (const ev of newEvents) {
    if (ev.dedupeKey && seen.has(ev.dedupeKey)) continue;
    const full = {
      id: newId(),
      createdAt: new Date().toISOString(),
      seen: false,
      ...ev,
    };
    events.unshift(full);
    added.push(full);
    if (ev.dedupeKey) seen.add(ev.dedupeKey);
  }
  // Trim antigos vistos
  if (events.length > ALERT_EVENTS_CAP) events.length = ALERT_EVENTS_CAP;
  saveAlertEvents(profileId, events);
  return added;
}

export function markAlertsSeen(profileId, ids) {
  const set = new Set(ids || []);
  const events = getAlertEvents(profileId);
  let touched = false;
  for (const e of events) {
    if (set.has(e.id) && !e.seen) { e.seen = true; touched = true; }
  }
  if (touched) saveAlertEvents(profileId, events);
  return events;
}

export function markAllAlertsSeen(profileId) {
  const events = getAlertEvents(profileId);
  let touched = false;
  for (const e of events) if (!e.seen) { e.seen = true; touched = true; }
  if (touched) saveAlertEvents(profileId, events);
  return events;
}

export function deleteAlertEvent(profileId, id) {
  const events = getAlertEvents(profileId).filter(e => e.id !== id);
  saveAlertEvents(profileId, events);
}

// ===== Solicitações de relatório completo (LGPD) =====
// Cada clique em "Enviar solicitação" no modal de consentimento grava
// uma entrada aqui — evidência server-side da autorização. Triplica a
// prova: email do solicitante, email do admin, registro local.
function reportRequestsFile(profileId) {
  return join(profileDir(profileId), 'report-requests.json');
}

export function getReportRequests(profileId) {
  return readJson(reportRequestsFile(profileId), []);
}

export function addReportRequest(profileId, request) {
  const all = getReportRequests(profileId);
  const entry = { id: newId(), createdAt: new Date().toISOString(), ...request };
  all.unshift(entry);
  writeJson(reportRequestsFile(profileId), all);
  return entry;
}

export function getManualTournaments(profileId) {
  return readJson(join(profileDir(profileId), 'manual.json'), []);
}

// ===== Share links (cards públicos compartilhados) =====
// data/shared/_index.json: { "profileId:tid": "token" } — pra idempotência
// data/shared/<token>.json: { token, profileId, tournamentId, sharedBy, sharedAt }
const SHARED_DIR = join(DATA_DIR, 'shared');
const SHARED_INDEX = join(SHARED_DIR, '_index.json');

export function findOrCreateShareToken(profileId, tournamentId, sharedBy) {
  const index = readJson(SHARED_INDEX, {});
  const key = `${profileId}:${tournamentId}`;
  if (index[key]) {
    const existing = readJson(join(SHARED_DIR, `${index[key]}.json`), null);
    if (existing) return existing;
  }
  // Token base62 ~10 chars — randomBytes 8 bytes em base64url
  const token = 'T' + randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 10);
  const data = {
    token,
    profileId,
    tournamentId,
    sharedBy,
    sharedAt: new Date().toISOString(),
  };
  writeJson(join(SHARED_DIR, `${token}.json`), data);
  index[key] = token;
  writeJson(SHARED_INDEX, index);
  return data;
}

export function getShareLink(token) {
  if (!/^T[A-Za-z0-9]{1,16}$/.test(token)) return null;
  return readJson(join(SHARED_DIR, `${token}.json`), null);
}

export function addManualTournament(profileId, tournament) {
  const list = getManualTournaments(profileId);
  if (list.find(t => t.id === tournament.id)) return list;
  list.push({ ...tournament, isManual: true, addedAt: new Date().toISOString() });
  writeJson(join(profileDir(profileId), 'manual.json'), list);
  return list;
}

export function removeManualTournament(profileId, tournamentId) {
  const list = getManualTournaments(profileId).filter(t => t.id !== tournamentId);
  writeJson(join(profileDir(profileId), 'manual.json'), list);
  return list;
}
