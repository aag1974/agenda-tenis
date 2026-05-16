// Auth pró-forma do /scouting — não é segurança real.
// Tem 1 coach hardcoded (via env vars no Render). Login compara strings,
// gera cookie assinado. Sem registro, sem reset, sem nada elaborado.
// Validação real virá quando o produto provar valor.

import { createHmac, randomBytes } from 'node:crypto';

const COACH_EMAIL = (process.env.SCOUTING_COACH_EMAIL || 'coach@dumonttennis.com').toLowerCase();
const COACH_PASSWORD = process.env.SCOUTING_COACH_PASSWORD || 'Itajai2026!';

// Segredo pra assinar o cookie. Em produção é env var; em dev usa random.
// Não reusa o do TF pra não misturar sessões (decisão 1 do design).
const SECRET = process.env.SCOUTING_SECRET || randomBytes(32).toString('hex');

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(data).digest('hex').slice(0, 32);
  return `${data}.${sig}`;
}

function verify(cookie) {
  if (!cookie || !cookie.includes('.')) return null;
  const [data, sig] = cookie.split('.');
  const expected = createHmac('sha256', SECRET).update(data).digest('hex').slice(0, 32);
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch { return null; }
}

export function tryLogin(email, password) {
  if (!email || !password) return null;
  if (email.trim().toLowerCase() !== COACH_EMAIL) return null;
  if (password !== COACH_PASSWORD) return null;
  return { email: COACH_EMAIL, signedAt: new Date().toISOString() };
}

export function makeCookie(payload) {
  return sign(payload);
}

// Lê cookie scoutsess do header e popula req.scoutingUser
export function scoutingAuthMiddleware(req, res, next) {
  req.scoutingUser = null;
  const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
    const [k, ...v] = c.trim().split('=');
    if (k) acc[k] = v.join('=');
    return acc;
  }, {});
  const tok = cookies['scoutsess'];
  if (tok) {
    const payload = verify(tok);
    if (payload && payload.email === COACH_EMAIL) {
      req.scoutingUser = payload;
    }
  }
  next();
}

export function requireScoutingAuth(req, res, next) {
  if (!req.scoutingUser) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

export const SCOUTING_COACH_EMAIL = COACH_EMAIL;
