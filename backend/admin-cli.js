// Operações administrativas — usadas tanto pelo CLI (Render shell) quanto
// pelo endpoint /api/admin protegido por ADMIN_TOKEN.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes } from 'node:crypto';
import { COLUMNS } from './board.js';

const COLUMN_LABEL_BY_ID = Object.fromEntries(COLUMNS.map(c => [c.id, c.label]));

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
    firstName: u.firstName || null, lastName: u.lastName || null,
    plan: u.plan || 'pro', planActivatedAt: u.planActivatedAt, planNote: u.planNote,
    trialStartedAt: u.trialStartedAt,
  }));
}

// Ativa Pro vitalício pra um usuário (após confirmação de Pix).
// Use: node backend/admin-cli.js activate-pro user@email.com "Pix R$297 em 07/05/2026"
export function activatePro(email, note = null) {
  const users = readJson(USERS_FILE, []);
  const u = users.find(x => x.email?.toLowerCase() === email?.toLowerCase());
  if (!u) throw new Error(`Usuário não encontrado: ${email}`);
  u.plan = 'pro';
  u.planActivatedAt = new Date().toISOString();
  if (note) u.planNote = note;
  writeJson(USERS_FILE, users);
  return { email: u.email, plan: u.plan, planActivatedAt: u.planActivatedAt, planNote: u.planNote };
}

// Volta usuário pra trial (raro — usado em refund ou ajuste manual)
export function setPlanTrial(email) {
  const users = readJson(USERS_FILE, []);
  const u = users.find(x => x.email?.toLowerCase() === email?.toLowerCase());
  if (!u) throw new Error(`Usuário não encontrado: ${email}`);
  u.plan = 'trial';
  u.planActivatedAt = null;
  u.trialStartedAt = u.trialStartedAt || new Date().toISOString();
  writeJson(USERS_FILE, users);
  return { email: u.email, plan: u.plan, trialStartedAt: u.trialStartedAt };
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

// Define firstName/lastName de um usuário existente. Usado pra
// preencher os campos retroativamente em users criados antes do
// signup exigir nome+sobrenome.
// CLI: node backend/admin-cli.js set-name user@email.com "Anna Cláudia" "Garcia"
export function setName(email, firstName, lastName) {
  if (!firstName?.trim() || !lastName?.trim()) {
    throw new Error('firstName e lastName obrigatórios');
  }
  const users = readJson(USERS_FILE, []);
  const u = users.find(x => x.email?.toLowerCase() === email?.toLowerCase());
  if (!u) throw new Error(`Usuário não encontrado: ${email}`);
  u.firstName = firstName.trim();
  u.lastName = lastName.trim();
  writeJson(USERS_FILE, users);
  return { email: u.email, firstName: u.firstName, lastName: u.lastName };
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

// Reescreve mensagens antigas do tipo `Movido para "pagar_inscricao"` pra
// `Movido para "Pagar inscrição"` em todas as notes.json.
export function normalizeActivityLogs() {
  if (!existsSync(DATA_DIR)) return { profiles: 0, rewritten: 0 };
  let profilesTouched = 0;
  let rewritten = 0;
  for (const dir of readdirSync(DATA_DIR)) {
    if (!dir.startsWith('profile-')) continue;
    const file = join(DATA_DIR, dir, 'notes.json');
    if (!existsSync(file)) continue;
    let notes;
    try { notes = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    let touched = false;
    for (const tid of Object.keys(notes)) {
      const acts = notes[tid]?.activity;
      if (!Array.isArray(acts)) continue;
      for (const a of acts) {
        if (a.type !== 'column_change' || !a.message) continue;
        const newMsg = a.message.replace(/"([a-z_]+)"/g, (_, id) => `"${COLUMN_LABEL_BY_ID[id] || id}"`);
        if (newMsg !== a.message) { a.message = newMsg; rewritten++; touched = true; }
      }
    }
    if (touched) {
      writeFileSync(file, JSON.stringify(notes, null, 2));
      profilesTouched++;
    }
  }
  return { profiles: profilesTouched, rewritten };
}

export function findTournament(email, namePartial) {
  const u = findUser(email);
  if (!u) throw new Error('Usuário não encontrado');
  const profiles = readJson(PROFILES_FILE, []);
  const myProfiles = profiles.filter(p => (p.householdId || p.userId) === u.householdId);
  const needle = (namePartial || '').toLowerCase();
  const matches = [];
  for (const p of myProfiles) {
    const synced = readJson(join(DATA_DIR, `profile-${p.id}`, 'synced.json'), null);
    if (!synced?.tournaments) continue;
    for (const t of synced.tournaments) {
      if (!needle || (t.name || '').toLowerCase().includes(needle) || (t.city || '').toLowerCase().includes(needle)) {
        matches.push({
          athleteName: p.athleteName,
          id: t.id,
          name: t.name,
          city: t.city,
          state: t.state,
          startDate: t.startDate,
          endDate: t.endDate,
          registrationStatus: t.registrationStatus,
          isAnnaInscribed: t.isAnnaInscribed,
          pendingPayment: t.pendingPayment,
          tier: t.tier,
          tiers: t.tiers,
          firstSeenAt: t.firstSeenAt,
        });
      }
    }
  }
  return matches;
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
      list.forEach(u => {
        const plan = u.plan === 'pro' ? 'PRO' : (u.plan === 'trial' ? `trial (desde ${u.trialStartedAt?.slice(0,10)})` : u.plan);
        const name = (u.firstName && u.lastName) ? `${u.firstName} ${u.lastName}` : '(sem nome)';
        console.log(`  ${u.email}  → ${name}  [${plan}]  id=${u.id}  household=${u.householdId}`);
      });
    } else if (cmd === 'delete-user') {
      console.log('✓', deleteUser(arg1));
    } else if (cmd === 'reset-password') {
      console.log('✓', resetPassword(arg1, arg2));
    } else if (cmd === 'set-name') {
      // node backend/admin-cli.js set-name user@email.com "Anna Cláudia" "Garcia"
      console.log('✓', setName(arg1, arg2, process.argv[5]));
    } else if (cmd === 'activate-pro') {
      // node backend/admin-cli.js activate-pro user@email.com "Pix R$297 em 07/05/2026"
      console.log('✓ Ativado:', activatePro(arg1, arg2));
    } else if (cmd === 'set-plan-trial') {
      console.log('✓', setPlanTrial(arg1));
    } else if (cmd === 'show-household') {
      console.log(JSON.stringify(showHousehold(arg1), null, 2));
    } else if (cmd === 'find-tournament') {
      console.log(JSON.stringify(findTournament(arg1, arg2), null, 2));
    } else if (cmd === 'normalize-activity-logs') {
      console.log('✓', normalizeActivityLogs());
    } else {
      console.log('Comandos: list-users | delete-user | reset-password | set-name | activate-pro | set-plan-trial | show-household | find-tournament | normalize-activity-logs');
    }
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  }
}
