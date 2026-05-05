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

export function createUser({ email, password }) {
  if (!email || !password) throw new Error('email e senha obrigatórios');
  if (password.length < 6) throw new Error('senha precisa ter pelo menos 6 caracteres');
  const users = readUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('Já existe uma conta com este email');
  }
  const id = randomBytes(8).toString('hex');
  const user = {
    id,
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);
  return { id, email: user.email, createdAt: user.createdAt, isFirst: users.length === 1 };
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
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Não autenticado' });
  next();
}
