// Household — agrupa usuários (família/co-gestores) que enxergam os mesmos atletas.
// Cada usuário e cada perfil têm um householdId. Convidado aceita convite,
// passa a integrar a household do convidante (e leva os perfis dele junto).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');
const INVITES_FILE = join(DATA_DIR, 'invites.json');

mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, def) {
  if (!existsSync(file)) return def;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2));
}

// Migração idempotente — roda no boot do servidor.
// Garante que todo user tenha householdId (default = user.id) e propaga
// pra cada profile via creator (profile.userId).
export function migrateHouseholdsOnBoot() {
  const users = readJson(USERS_FILE, []);
  const profiles = readJson(PROFILES_FILE, []);
  let usersChanged = 0, profilesChanged = 0;

  for (const u of users) {
    if (!u.householdId) { u.householdId = u.id; usersChanged++; }
  }
  if (usersChanged) writeJson(USERS_FILE, users);

  const userById = new Map(users.map(u => [u.id, u]));
  for (const p of profiles) {
    if (!p.householdId) {
      const owner = p.userId ? userById.get(p.userId) : null;
      p.householdId = owner?.householdId || p.userId || null;
      profilesChanged++;
    }
  }
  if (profilesChanged) writeJson(PROFILES_FILE, profiles);

  if (usersChanged || profilesChanged) {
    console.log(`[migration] households: users=${usersChanged}, profiles=${profilesChanged}`);
  }
}

export function getUserHouseholdId(userId) {
  const users = readJson(USERS_FILE, []);
  const u = users.find(x => x.id === userId);
  return u?.householdId || null;
}

export function listHouseholdMembers(householdId) {
  const users = readJson(USERS_FILE, []);
  return users
    .filter(u => u.householdId === householdId)
    .map(u => ({
      id: u.id, email: u.email, name: u.name || null,
      joinedAt: u.householdJoinedAt || u.createdAt,
      isFounder: u.id === householdId,
    }));
}

// Remove um membro da household — volta a ser household solo (id própria).
// Só o "fundador" (user cujo id === householdId) pode remover.
// Os perfis (atletas) permanecem no household original.
export function removeHouseholdMember({ householdId, requesterId, targetUserId }) {
  if (requesterId !== householdId) {
    throw new Error('Apenas o dono da família pode remover membros');
  }
  if (targetUserId === householdId) {
    throw new Error('O dono não pode se remover; transfira a propriedade primeiro');
  }
  const users = readJson(USERS_FILE, []);
  const target = users.find(u => u.id === targetUserId);
  if (!target) throw new Error('Membro não encontrado');
  if (target.householdId !== householdId) throw new Error('Membro não pertence à família');
  target.householdId = target.id;
  target.householdLeftAt = new Date().toISOString();
  delete target.householdJoinedAt;
  writeJson(USERS_FILE, users);
  return { id: target.id, email: target.email };
}

// Verifica se um perfil pertence à household. Profiles sem householdId
// ainda são tratados como do owner original (user.id).
export function profileBelongsToHousehold(profile, householdId) {
  if (!profile) return false;
  if (profile.householdId) return profile.householdId === householdId;
  return profile.userId === householdId;
}

// ===== Invites =====

export function createInvite({ householdId, invitedBy, label = null, ttlHours = 168 }) {
  const list = readJson(INVITES_FILE, []);
  const token = randomBytes(18).toString('base64url');
  const entry = {
    token,
    householdId,
    invitedBy,
    label,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000).toISOString(),
    acceptedBy: null,
    acceptedAt: null,
  };
  list.push(entry);
  writeJson(INVITES_FILE, list);
  return entry;
}

export function getInvite(token) {
  const list = readJson(INVITES_FILE, []);
  return list.find(i => i.token === token) || null;
}

export function listInvitesByHousehold(householdId) {
  return readJson(INVITES_FILE, []).filter(i => i.householdId === householdId);
}

export function revokeInvite(token, householdId) {
  const list = readJson(INVITES_FILE, []);
  const idx = list.findIndex(i => i.token === token && i.householdId === householdId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  writeJson(INVITES_FILE, list);
  return true;
}

// Aceita convite — usuário entra na household do convidante.
// Os perfis criados por esse usuário (no household antigo) são realocados
// pro novo household, pra que ele não perca seus dados.
// Throws on: convite inválido, expirado, já aceito.
export function acceptInvite(token, userId) {
  const invites = readJson(INVITES_FILE, []);
  const inv = invites.find(i => i.token === token);
  if (!inv) throw new Error('Convite inválido');
  if (inv.acceptedBy) throw new Error('Convite já utilizado');
  if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
    throw new Error('Convite expirado');
  }

  const users = readJson(USERS_FILE, []);
  const user = users.find(u => u.id === userId);
  if (!user) throw new Error('Usuário não encontrado');
  if (user.householdId === inv.householdId) {
    // já é membro — só marca convite como aceito
    inv.acceptedBy = userId;
    inv.acceptedAt = new Date().toISOString();
    writeJson(INVITES_FILE, invites);
    return { householdId: inv.householdId, alreadyMember: true };
  }

  const oldHouseholdId = user.householdId || user.id;
  user.householdId = inv.householdId;
  user.householdJoinedAt = new Date().toISOString();
  writeJson(USERS_FILE, users);

  // Migra perfis do household antigo pro novo (se a pessoa já tinha atletas)
  const profiles = readJson(PROFILES_FILE, []);
  let moved = 0;
  for (const p of profiles) {
    if (p.householdId === oldHouseholdId || (!p.householdId && p.userId === userId)) {
      p.householdId = inv.householdId;
      moved++;
    }
  }
  if (moved) writeJson(PROFILES_FILE, profiles);

  inv.acceptedBy = userId;
  inv.acceptedAt = new Date().toISOString();
  writeJson(INVITES_FILE, invites);

  return { householdId: inv.householdId, profilesMoved: moved };
}
