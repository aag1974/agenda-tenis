// Lightweight auth: scrypt password hashing + HMAC-signed session cookies.
// No extra deps — uses Node's built-in crypto.

import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const SESSION_SECRET_FILE = join(DATA_DIR, '.session-secret');

mkdirSync(DATA_DIR, { recursive: true });

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!existsSync(SESSION_SECRET_FILE)) {
    const s = randomBytes(32).toString('hex');
    writeFileSync(SESSION_SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
  return readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
}

const SECRET = getSessionSecret();

function readUsers() {
  if (!existsSync(USERS_FILE)) return [];
  try { return JSON.parse(readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}
function writeUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signCookie(value) {
  const sig = createHmac('sha256', SECRET).update(value).digest('hex');
  return `${value}.${sig}`;
}

export function verifyCookie(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = createHmac('sha256', SECRET).update(value).digest('hex');
  try {
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  return value;
}

export function listUsers() {
  return readUsers().map(u => ({ id: u.id, email: u.email, createdAt: u.createdAt }));
}

export function userCount() {
  return readUsers().length;
}

export function findUserByEmail(email) {
  if (!email) return null;
  return readUsers().find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

export function findUserById(id) {
  return readUsers().find(u => u.id === id) || null;
}

export function createUser({ email, password, firstName, lastName }) {
  if (!email || !password) throw new Error('email e senha obrigatórios');
  if (password.length < 6) throw new Error('senha precisa ter pelo menos 6 caracteres');
  const fn = (firstName || '').trim();
  const ln = (lastName || '').trim();
  if (!fn) throw new Error('Nome obrigatório');
  if (!ln) throw new Error('Sobrenome obrigatório');
  if (fn.length > 40 || ln.length > 60) throw new Error('Nome ou sobrenome muito longos');
  const users = readUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('Já existe uma conta com este email');
  }
  const id = randomBytes(8).toString('hex');
  const now = new Date().toISOString();
  const isFirstUser = users.length === 0;
  const user = {
    id,
    email: email.toLowerCase(),
    firstName: fn,
    lastName: ln,
    passwordHash: hashPassword(password),
    householdId: id, // solo household por default — invite muda isso
    createdAt: now,
    // Plano de acesso. Primeiro usuário (admin) entra Pro permanente;
    // demais entram em trial de 15 dias.
    plan: isFirstUser ? 'pro' : 'trial',
    trialStartedAt: now,
    planActivatedAt: isFirstUser ? now : null,
    planNote: isFirstUser ? 'admin (founder)' : null,
  };
  users.push(user);
  writeUsers(users);
  return { id, email: user.email, householdId: user.householdId, createdAt: user.createdAt, isFirst: isFirstUser };
}

// Atualiza nome/sobrenome de um user (usado pelo modal "complete seu cadastro"
// pra usuários que existiam antes do campo virar obrigatório).
export function updateUserName(userId, { firstName, lastName }) {
  const fn = (firstName || '').trim();
  const ln = (lastName || '').trim();
  if (!fn) throw new Error('Nome obrigatório');
  if (!ln) throw new Error('Sobrenome obrigatório');
  if (fn.length > 40 || ln.length > 60) throw new Error('Nome ou sobrenome muito longos');
  const users = readUsers();
  const u = users.find(x => x.id === userId);
  if (!u) throw new Error('Usuário não encontrado');
  u.firstName = fn;
  u.lastName = ln;
  writeUsers(users);
  return { id: u.id, firstName: u.firstName, lastName: u.lastName };
}

// ===== Planos =====
export const TRIAL_DAYS = 15;

// Calcula o estado real considerando trial vs pro vs free degradado.
export function effectivePlan(user) {
  if (!user) return 'free';
  if (user.plan === 'pro') return 'pro';
  if (user.plan === 'trial' && user.trialStartedAt) {
    const elapsed = Date.now() - new Date(user.trialStartedAt).getTime();
    const limit = TRIAL_DAYS * 24 * 60 * 60 * 1000;
    if (elapsed < limit) return 'trial';
  }
  return 'free';
}

// Info completa pro UI (banner, menu "Meu plano", etc)
export function getPlanInfo(user) {
  if (!user) return null;
  const effective = effectivePlan(user);
  const info = { plan: user.plan, effective, planActivatedAt: user.planActivatedAt };
  if (user.plan === 'trial' && user.trialStartedAt) {
    const trialEnd = new Date(user.trialStartedAt).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000;
    info.trialStartedAt = user.trialStartedAt;
    info.trialEndsAt = new Date(trialEnd).toISOString();
    info.trialDaysLeft = Math.max(0, Math.ceil((trialEnd - Date.now()) / (24 * 60 * 60 * 1000)));
  }
  return info;
}

// Migração: adiciona campos de plano em users existentes (sem plan field).
// Roda no boot do server. Usuários antigos viram 'pro' automaticamente
// porque foram criados antes da monetização — não seria justo cobrá-los.
export function migrateUsersAddPlan() {
  const users = readUsers();
  let changed = false;
  const now = new Date().toISOString();
  for (const u of users) {
    if (!u.plan) {
      u.plan = 'pro';
      u.planActivatedAt = now;
      u.planNote = 'pre-monetization grandfather';
      u.trialStartedAt = u.createdAt || now;
      changed = true;
    }
  }
  if (changed) writeUsers(users);
}

export function activateProByEmail(email, note = null) {
  const users = readUsers();
  const u = users.find(x => x.email.toLowerCase() === (email || '').toLowerCase());
  if (!u) throw new Error(`Usuário não encontrado: ${email}`);
  u.plan = 'pro';
  u.planActivatedAt = new Date().toISOString();
  if (note) u.planNote = note;
  writeUsers(users);
  return { id: u.id, email: u.email, plan: u.plan, planActivatedAt: u.planActivatedAt, planNote: u.planNote };
}

export function authenticate(email, password) {
  const user = findUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email };
}

// Express middleware: parse session cookie → req.userId
export function authMiddleware(req, res, next) {
  const cookie = (req.headers.cookie || '')
    .split(';').map(s => s.trim())
    .find(s => s.startsWith('session='));
  if (!cookie) return next();
  const value = verifyCookie(cookie.slice('session='.length));
  if (!value) return next();
  const user = findUserById(value);
  if (user) {
    req.userId = user.id;
    req.userEmail = user.email;
    req.householdId = user.householdId || user.id;
    // Founder (criador da household) = sempre editor. Outros usam o
    // role gravado, default 'editor' pra manter compat com membros legados.
    const isFounder = user.id === (user.householdId || user.id);
    req.userRole = isFounder ? 'editor' : (user.role || 'editor');
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

export function requireEditor(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  if (req.userRole === 'viewer') {
    return res.status(403).json({ error: 'Acesso somente leitura. Peça ao dono da família para promover sua conta a Editor.' });
  }
  next();
}
