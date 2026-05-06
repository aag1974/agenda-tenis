import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

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

export function listProfiles(userId = null) {
  return readJson(PROFILES_FILE, [])
    .filter(p => userId ? p.userId === userId : true)
    .map(p => ({
      id: p.id,
      userId: p.userId || null,
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

export function createProfile({ userId, athleteName, tiEmail, tiPassword, originAirport, originCity }) {
  const all = readJson(PROFILES_FILE, []);
  const id = randomBytes(8).toString('hex');
  const calendarToken = randomBytes(20).toString('hex');
  const profile = {
    id,
    userId: userId || null,
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
      message: `Movido para "${column}"${previousColumn ? ` (de "${previousColumn}")` : ''}`,
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

export function getManualTournaments(profileId) {
  return readJson(join(profileDir(profileId), 'manual.json'), []);
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
