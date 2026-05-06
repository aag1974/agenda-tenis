// CLI utilitário pra ações administrativas que não cabem na UI.
// Uso (no Render shell, a partir do diretório do projeto):
//   node backend/admin-cli.js list-users
//   node backend/admin-cli.js delete-user <email>
//   node backend/admin-cli.js reset-password <email> <novaSenha>
//   node backend/admin-cli.js show-household <email>

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

const cmd = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

function findUser(email) {
  const users = readJson(USERS_FILE, []);
  return users.find(u => u.email?.toLowerCase() === email?.toLowerCase());
}

if (cmd === 'list-users') {
  const users = readJson(USERS_FILE, []);
  console.log(`${users.length} usuário(s):`);
  for (const u of users) {
    console.log(`  ${u.email}  id=${u.id}  household=${u.householdId || '?'}  criado=${u.createdAt}`);
  }
} else if (cmd === 'delete-user') {
  if (!arg1) { console.error('uso: delete-user <email>'); process.exit(1); }
  const u = findUser(arg1);
  if (!u) { console.error('Usuário não encontrado'); process.exit(1); }
  const users = readJson(USERS_FILE, []).filter(x => x.id !== u.id);
  writeJson(USERS_FILE, users);
  const invites = readJson(INVITES_FILE, []).filter(i => i.acceptedBy !== u.id);
  writeJson(INVITES_FILE, invites);
  console.log(`✓ Removido: ${u.email} (id=${u.id})`);
  console.log(`  Convites aceitos por ele resetados (voltam a ficar pendentes)`);
  console.log(`  Atletas (profiles) NÃO foram tocados — continuam na household ${u.householdId}`);
} else if (cmd === 'reset-password') {
  if (!arg1 || !arg2) { console.error('uso: reset-password <email> <novaSenha>'); process.exit(1); }
  if (arg2.length < 6) { console.error('Senha precisa ter pelo menos 6 caracteres'); process.exit(1); }
  const users = readJson(USERS_FILE, []);
  const u = users.find(x => x.email?.toLowerCase() === arg1.toLowerCase());
  if (!u) { console.error('Usuário não encontrado'); process.exit(1); }
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(arg2, salt, 64).toString('hex');
  u.passwordHash = salt + ':' + hash;
  writeJson(USERS_FILE, users);
  console.log(`✓ Senha resetada para: ${u.email}`);
  console.log(`  Nova senha: ${arg2}`);
} else if (cmd === 'show-household') {
  if (!arg1) { console.error('uso: show-household <email>'); process.exit(1); }
  const u = findUser(arg1);
  if (!u) { console.error('Usuário não encontrado'); process.exit(1); }
  const users = readJson(USERS_FILE, []);
  const profiles = readJson(PROFILES_FILE, []);
  const members = users.filter(x => x.householdId === u.householdId);
  const atletas = profiles.filter(p => (p.householdId || p.userId) === u.householdId);
  console.log(`Household ${u.householdId}`);
  console.log(`  Membros (${members.length}):`);
  members.forEach(m => console.log(`    ${m.email}${m.id === u.householdId ? ' (dono)' : ''}`));
  console.log(`  Atletas (${atletas.length}):`);
  atletas.forEach(a => console.log(`    ${a.athleteName || a.tiEmail}  id=${a.id}`));
} else {
  console.log('Comandos:');
  console.log('  list-users');
  console.log('  delete-user <email>');
  console.log('  reset-password <email> <novaSenha>');
  console.log('  show-household <email>');
}
