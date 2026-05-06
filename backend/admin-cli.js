// Operações administrativas — usadas tanto pelo CLI (Render shell) quanto
// pelo endpoint /api/admin protegido por ADMIN_TOKEN.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');
const INVITES_FILE = join(DATA_DIR, 'invites.json');

function readJson(file, def) {
  if (!existsSync(file)) return def;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2));
}
function findUser(email) {
  const users = readJson(USERS_FILE, []);
  return users.find(u => u.email?.toLowerCase() === email?.toLowerCase());
}

export function listUsers() {
  const users = readJson(USERS_FILE, []);
  return users.map(u => ({
    email: u.email, id: u.id, householdId: u.householdId, createdAt: u.createdAt,
  }));
}

export function deleteUser(email) {
  const u = findUser(email);
  if (!u) throw new Error('Usuário não encontrado');
  const users = readJson(USERS_FILE, []).filter(x => x.id !== u.id);
  writeJson(USERS_FILE, users);
  const invites = readJson(INVITES_FILE, []).filter(i => i.acceptedBy !== u.id);
  writeJson(INVITES_FILE, invites);
  return { removed: u.email, id: u.id, householdId: u.householdId };
}

export function resetPassword(email, novaSenha) {
  if (!novaSenha || novaSenha.length < 6) throw new Error('Senha precisa ter pelo menos 6 caracteres');
  const users = readJson(USERS_FILE, []);
  const u = users.find(x => x.email?.toLowerCase() === email?.toLowerCase());
  if (!u) throw new Error('Usuário não encontrado');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(novaSenha, salt, 64).toString('hex');
  u.passwordHash = salt + ':' + hash;
  writeJson(USERS_FILE, users);
  return { email: u.email };
}

export function showHousehold(email) {
  const u = findUser(email);
  if (!u) throw new Error('Usuário não encontrado');
  const users = readJson(USERS_FILE, []);
  const profiles = readJson(PROFILES_FILE, []);
  return {
    householdId: u.householdId,
    members: users.filter(x => x.householdId === u.householdId).map(m => ({
      email: m.email, id: m.id, isFounder: m.id === u.householdId,
    })),
    athletes: profiles.filter(p => (p.householdId || p.userId) === u.householdId).map(a => ({
      id: a.id, athleteName: a.athleteName, tiEmail: a.tiEmail,
    })),
  };
}

// ===== CLI runner =====
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const cmd = process.argv[2];
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];
  try {
    if (cmd === 'list-users') {
      const list = listUsers();
      console.log(`${list.length} usuário(s):`);
      list.forEach(u => console.log(`  ${u.email}  id=${u.id}  household=${u.householdId}`));
    } else if (cmd === 'delete-user') {
      console.log('✓', deleteUser(arg1));
    } else if (cmd === 'reset-password') {
      console.log('✓', resetPassword(arg1, arg2));
    } else if (cmd === 'show-household') {
      console.log(JSON.stringify(showHousehold(arg1), null, 2));
    } else {
      console.log('Comandos: list-users | delete-user <email> | reset-password <email> <novaSenha> | show-household <email>');
    }
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  }
}
