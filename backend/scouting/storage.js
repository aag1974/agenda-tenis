// Storage do /scouting — JSON files em data/scouting/.
// Mantido SEPARADO do TF (data/profile-*) conforme decisão 7 do design.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCOUTING_DIR = join(__dirname, '..', '..', 'data', 'scouting');
if (!existsSync(SCOUTING_DIR)) mkdirSync(SCOUTING_DIR, { recursive: true });

const ROSTER_FILE = join(SCOUTING_DIR, 'roster.json');
// Fallback do roster: vai junto com o código (gitignore não pega).
// Se data/scouting/roster.json não existir, usa este. Coach pode "atualizar"
// em runtime via POST /api/scouting/roster — grava em data/.
const ROSTER_DEFAULT = join(__dirname, 'roster.default.json');
const INVITES_FILE = join(SCOUTING_DIR, 'invites.json');

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return fallback; }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

// ===== Roster (lista de atletas) =====

export function getRoster() {
  // Prefere o de data/ (atualizado em runtime); cai pro default do código.
  if (existsSync(ROSTER_FILE)) return readJson(ROSTER_FILE, { atletas: [] });
  return readJson(ROSTER_DEFAULT, { atletas: [], importedAt: null, source: null });
}

export function saveRoster({ atletas, source = 'manual' }) {
  const data = {
    atletas: atletas.map(a => ({
      id: a.id || a.id_ti,
      nome: a.nome,
      categoria: a.categoria || null,
      clube: a.clube || null,
      cidade: a.cidade || null,
      uf: a.uf || null,
      idade: a.idade || null,
    })),
    importedAt: new Date().toISOString(),
    source,
  };
  writeJson(ROSTER_FILE, data);
  return data;
}

// ===== Invites (1 coach + 1 atleta = 1 link pro scouter) =====

export function newInviteToken() {
  return randomBytes(16).toString('hex');
}

export function newInviteId() {
  return 'inv-' + randomBytes(8).toString('hex');
}

export function listInvites() {
  const all = readJson(INVITES_FILE, {});
  return Object.values(all).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
}

export function getInvite(token) {
  const all = readJson(INVITES_FILE, {});
  return all[token] || null;
}

export function createInvite({ atletaId, atletaNome, atletaCategoria, createdBy }) {
  const all = readJson(INVITES_FILE, {});
  const token = newInviteToken();
  const invite = {
    id: newInviteId(),
    token,
    atletaId: atletaId || null,
    atletaNome,
    atletaCategoria: atletaCategoria || null,
    createdBy,
    createdAt: new Date().toISOString(),
    matchId: null,       // preenchido quando scouter completa
    matchToken: null,    // scoutToken do match criado
    completedAt: null,
  };
  all[token] = invite;
  writeJson(INVITES_FILE, all);
  return invite;
}

export function markInviteCompleted(token, { matchId, matchToken }) {
  const all = readJson(INVITES_FILE, {});
  const invite = all[token];
  if (!invite) return null;
  invite.matchId = matchId;
  invite.matchToken = matchToken;
  invite.completedAt = new Date().toISOString();
  writeJson(INVITES_FILE, all);
  return invite;
}

export function deleteInvite(token) {
  const all = readJson(INVITES_FILE, {});
  if (!all[token]) return false;
  delete all[token];
  writeJson(INVITES_FILE, all);
  return true;
}

// ProfileId fixo onde os matches do scouting são guardados — reusa o
// storage de live-matches do TF (data/profile-<id>/live-matches/).
// Nunca cadastrado em profiles.json — não aparece no kanban do TF.
export const SCOUTING_PROFILE_ID = 'scouting';
