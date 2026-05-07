import 'dotenv/config';
import express from 'express';
import os from 'node:os';
import archiver from 'archiver';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  listProfiles, getProfile, createProfile, updateProfile, deleteProfile,
  getSyncedData, getNotes, updateTournamentNotes,
  ensureCalendarToken, findProfileByCalendarToken, claimOrphanProfiles,
  setCardColumn, addCardComment, updateCardComment, deleteCardComment, getCardActivity,
  getAlertRules, addAlertRule, updateAlertRule, deleteAlertRule,
  getAlertEvents, markAlertsSeen, markAllAlertsSeen, deleteAlertEvent,
  findOrCreateShareToken, getShareLink,
} from './storage.js';
import { COLUMNS, COLUMN_IDS, computeAutoColumn, effectiveColumn } from './board.js';
import {
  listReceipts, addReceipt, getReceiptFile, updateReceiptCategory, deleteReceipt,
  getQuotaInfo, RECEIPT_CATEGORIES, daysUntilCleanup, CLEANUP_DAYS_AFTER_END,
  receiptsCountByTournament,
} from './receipts.js';
import {
  ensureDefaultLabels, listManualLabels, createManualLabel, updateManualLabel,
  deleteManualLabel, deriveAutoLabels, resolveManualLabels, LABEL_COLORS,
} from './labels.js';
import { syncProfile, getSyncStatus, startAutoSync } from './sync-manager.js';
import { deriveStatus, fetchTournamentDetails } from './scraper.js';
import {
  createUser, authenticate, signCookie, authMiddleware, requireAuth,
  userCount, listUsers,
} from './auth.js';
import {
  migrateHouseholdsOnBoot, listHouseholdMembers, profileBelongsToHousehold,
  createInvite, getInvite, listInvitesByHousehold, revokeInvite, acceptInvite,
  removeHouseholdMember,
  getHouseholdBoardConfig, setHouseholdBoardConfig,
} from './household.js';
import * as admin from './admin-cli.js';

migrateHouseholdsOnBoot();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
// JSON limit raised so receipt uploads (image as base64 data URL) fit
app.use(express.json({ limit: '5mb' }));
app.use(authMiddleware);

const COOKIE_OPTIONS = (req) => {
  const isHttps = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isHttps ? 'Secure' : '',
    'Max-Age=2592000', // 30 days
  ].filter(Boolean).join('; ');
};

// ===== Auth =====
app.get('/api/auth/me', (req, res) => {
  const householdId = req.householdId || null;
  const members = householdId ? listHouseholdMembers(householdId) : [];
  res.json({
    userId: req.userId || null,
    email: req.userEmail || null,
    householdId,
    members,
    hasUsers: userCount() > 0,
  });
});

app.post('/api/auth/signup', (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = createUser({ email, password });
    if (user.isFirst) {
      const claimed = claimOrphanProfiles(user.id);
      if (claimed > 0) console.log(`[auth] Primeiro usuário ${user.email} herdou ${claimed} perfis existentes.`);
    }
    res.setHeader('Set-Cookie', `session=${signCookie(user.id)}; ${COOKIE_OPTIONS(req)}`);
    res.status(201).json({ userId: user.id, email: user.email });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = authenticate(email, password);
  if (!user) return res.status(401).json({ error: 'Email ou senha inválidos' });
  res.setHeader('Set-Cookie', `session=${signCookie(user.id)}; ${COOKIE_OPTIONS(req)}`);
  res.json({ userId: user.id, email: user.email });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `session=; Path=/; HttpOnly; Max-Age=0`);
  res.status(204).end();
});

// ===== Household / convites =====
app.get('/api/household/members', requireAuth, (req, res) => {
  res.json({ members: listHouseholdMembers(req.householdId) });
});

app.get('/api/household/board-config', requireAuth, (req, res) => {
  res.json(getHouseholdBoardConfig(req.householdId));
});

app.patch('/api/household/board-config', requireAuth, (req, res) => {
  res.json(setHouseholdBoardConfig(req.householdId, req.body || {}));
});

app.delete('/api/household/members/:userId', requireAuth, (req, res) => {
  try {
    const result = removeHouseholdMember({
      householdId: req.householdId,
      requesterId: req.userId,
      targetUserId: req.params.userId,
    });
    res.json(result);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.get('/api/household/invites', requireAuth, (req, res) => {
  res.json({ invites: listInvitesByHousehold(req.householdId) });
});

app.post('/api/household/invites', requireAuth, (req, res) => {
  const { label } = req.body || {};
  const inv = createInvite({ householdId: req.householdId, invitedBy: req.userId, label: label || null });
  res.status(201).json(inv);
});

app.delete('/api/household/invites/:token', requireAuth, (req, res) => {
  const ok = revokeInvite(req.params.token, req.householdId);
  if (!ok) return res.status(404).json({ error: 'Convite não encontrado' });
  res.status(204).end();
});

// Público — usado pela página de aceite pra mostrar quem te convidou
app.get('/api/invite/:token', (req, res) => {
  const inv = getInvite(req.params.token);
  if (!inv) return res.status(404).json({ error: 'Convite inválido' });
  if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
    return res.status(410).json({ error: 'Convite expirado' });
  }
  if (inv.acceptedBy) return res.status(409).json({ error: 'Convite já utilizado' });
  const inviter = listUsers().find(u => u.id === inv.invitedBy);
  res.json({
    token: inv.token,
    inviterEmail: inviter?.email || null,
    householdId: inv.householdId,
    label: inv.label,
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    alreadyMember: req.householdId === inv.householdId,
  });
});

app.post('/api/invite/:token/accept', requireAuth, (req, res) => {
  try {
    const result = acceptInvite(req.params.token, req.userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Endpoint admin — protegido por env var ADMIN_TOKEN.
// curl -X POST https://app/api/admin -H 'Content-Type: application/json' \
//   -d '{"token":"...","cmd":"delete-user","args":["email@x.com"]}'
app.post('/api/admin', (req, res) => {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'ADMIN_TOKEN não configurado' });
  const { token, cmd, args = [] } = req.body || {};
  if (!token || token !== expected) return res.status(401).json({ error: 'Token inválido' });
  try {
    let result;
    if (cmd === 'list-users') result = admin.listUsers();
    else if (cmd === 'delete-user') result = admin.deleteUser(args[0]);
    else if (cmd === 'reset-password') result = admin.resetPassword(args[0], args[1]);
    else if (cmd === 'show-household') result = admin.showHousehold(args[0]);
    else if (cmd === 'find-tournament') result = admin.findTournament(args[0], args[1]);
    else if (cmd === 'normalize-activity-logs') result = admin.normalizeActivityLogs();
    else return res.status(400).json({ error: 'cmd inválido' });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use(express.static(join(__dirname, '..', 'frontend')));

// Alias amigável pro manual público (também acessível em /manual.html)
app.get('/manual', (req, res) => res.sendFile(join(__dirname, '..', 'frontend', 'manual.html')));

// ===== Card público compartilhado =====
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSharePage(tournament) {
  const t = tournament;
  const name = escapeHtml(t.name || 'Torneio');
  const where = [t.city, t.state].filter(Boolean).join('/');
  const dates = t.startDate
    ? (t.endDate && t.endDate !== t.startDate ? `${t.startDate} a ${t.endDate}` : t.startDate)
    : null;
  const tiers = (t.tiers && t.tiers.length) ? t.tiers : (t.tier ? [t.tier] : []);
  const regStatus = t.registrationStatus || null;
  const regOpen = /Aberto|aberta/i.test(regStatus || '');
  const ogDesc = [dates, where, tiers.join(' · ')].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${name} — Tennis Flow</title>
<meta name="theme-color" content="#0e3a4d" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${name}" />
<meta property="og:description" content="${escapeHtml(ogDesc)}" />
<meta property="og:site_name" content="Tennis Flow" />
<link rel="icon" href="/icon-192.svg" />
<style>
  :root { --navy:#0e3a4d; --navy-dark:#0a2e3d; --teal:#1f5b75; --cyan:#22d3ee; --cyan-deep:#00a3e0; --slate-100:#f1f5f9; --slate-200:#e2e8f0; --slate-500:#64748b; --slate-600:#475569; --slate-700:#334155; --slate-900:#0f172a; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, var(--navy-dark) 0%, var(--navy) 50%, var(--teal) 100%);
    background-attachment: fixed;
    color: var(--slate-900);
    min-height: 100vh;
  }
  body::before, body::after {
    content:'🎾'; position:fixed; font-size:14rem; opacity:0.05; pointer-events:none; z-index:0;
  }
  body::before { top:-3rem; left:-3rem; transform:rotate(-15deg); }
  body::after { bottom:-3rem; right:-3rem; transform:rotate(20deg); }
  .wrap {
    max-width: 480px; margin: 0 auto; padding: 1.5rem 1rem 2rem;
    position: relative; z-index: 1;
  }
  .brand-bar {
    display:flex; align-items:center; justify-content:center; gap:0.6rem;
    color: white; padding: 1rem 0 1.5rem; opacity: 0.95;
  }
  .brand-mark {
    width: 36px; height: 36px; background: var(--navy-dark); border-radius: 8px;
    display:inline-flex; align-items:center; justify-content:center;
    font-size: 18px; position: relative;
  }
  .brand-mark .tf {
    position:absolute; bottom:1px; right:1px; font-size:9px; font-weight:900; line-height:1; letter-spacing:-0.5px;
  }
  .brand-mark .tf .t { color:white; }
  .brand-mark .tf .f { color: var(--cyan); }
  .brand-name { font-weight: 800; font-size: 1.1rem; }
  .brand-name .f { color: var(--cyan); }
  .shared-by {
    text-align:center; color: rgba(255,255,255,0.75); font-size:0.85rem;
    margin-bottom: 1rem;
  }
  /* Card */
  .card {
    background: white; border-radius: 16px; padding: 1.25rem;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    margin-bottom: 1rem;
  }
  .badges { display:flex; flex-wrap:wrap; gap:0.4rem; margin-bottom:0.75rem; }
  .badge {
    font-size: 0.7rem; padding: 0.2rem 0.6rem; border-radius: 999px;
    font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;
  }
  .badge-tier { background: var(--navy); color: white; }
  .badge-open { background: #d1fae5; color: #047857; }
  .badge-closed { background: var(--slate-100); color: var(--slate-600); }
  .card h1 {
    margin: 0 0 0.6rem; font-size: 1.35rem; line-height: 1.25; color: var(--navy);
  }
  .meta-row {
    display:flex; align-items:center; gap:0.55rem; padding: 0.5rem 0;
    border-top: 1px solid var(--slate-100); font-size: 0.95rem; color: var(--slate-700);
  }
  .meta-row:first-of-type { border-top: none; }
  .meta-icon { font-size: 1.1rem; width: 1.5rem; text-align: center; }
  .meta-label { color: var(--slate-500); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 0.25rem; }
  .meta-value { font-weight: 600; }
  .ti-link {
    display:block; text-align:center; padding: 0.6rem;
    background: var(--slate-100); color: var(--slate-700);
    text-decoration: none; border-radius: 10px;
    font-size: 0.85rem; margin-top: 0.75rem;
  }
  .ti-link:hover { background: var(--slate-200); }
  /* CTA */
  .cta {
    background: white; border-radius: 16px; padding: 1.5rem 1.25rem;
    text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  }
  .cta h2 {
    margin: 0 0 0.5rem; color: var(--navy); font-size: 1.15rem;
  }
  .cta p {
    margin: 0 0 1.25rem; color: var(--slate-600); font-size: 0.92rem;
    line-height: 1.5;
  }
  .cta-btn {
    display:block; width:100%; padding: 0.85rem;
    background: var(--cyan-deep); color: white; text-decoration: none;
    border-radius: 10px; font-weight: 700; font-size: 1rem;
    transition: background 0.15s;
  }
  .cta-btn:hover { background: var(--navy); }
  .cta-btn-secondary {
    display:block; text-align:center; padding: 0.7rem;
    color: var(--navy); text-decoration: none;
    font-size: 0.9rem; margin-top: 0.5rem;
  }
  .cta-btn-secondary:hover { text-decoration: underline; }
  /* Bullet list */
  .why {
    list-style: none; padding: 0; margin: 1rem 0 1.25rem;
    text-align: left;
  }
  .why li {
    display: grid; grid-template-columns: 24px 1fr; gap: 0.5rem;
    padding: 0.35rem 0; font-size: 0.88rem; color: var(--slate-700);
  }
  .why li::before { content:'✓'; color: var(--cyan-deep); font-weight: 800; }
  .footer {
    text-align:center; color: rgba(255,255,255,0.6); font-size: 0.78rem;
    margin-top: 1.25rem;
  }
</style>
</head>
<body>
<div class="wrap">

  <div class="brand-bar">
    <span class="brand-mark">
      🎾<span class="tf"><span class="t">T</span><span class="f">F</span></span>
    </span>
    <span class="brand-name">Tennis<span class="f">Flow</span></span>
  </div>

  <div class="shared-by">Compartilhado via Tennis Flow</div>

  <div class="card">
    <div class="badges">
      ${tiers.map(t => `<span class="badge badge-tier">${escapeHtml(t)}</span>`).join('')}
      ${regStatus ? `<span class="badge ${regOpen ? 'badge-open' : 'badge-closed'}">${escapeHtml(regStatus)}</span>` : ''}
    </div>
    <h1>${name}</h1>

    ${dates ? `
    <div class="meta-row">
      <span class="meta-icon">📅</span>
      <span class="meta-value">${escapeHtml(dates)}</span>
    </div>` : ''}

    ${where ? `
    <div class="meta-row">
      <span class="meta-icon">📍</span>
      <span class="meta-value">${escapeHtml(where)}</span>
    </div>` : ''}

    ${t.url ? `
    <a class="ti-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">
      Ver no Tênis Integrado →
    </a>` : ''}
  </div>

  <div class="cta">
    <h2>Organize a sua agenda também</h2>
    <p>Tennis Flow lê o Tênis Integrado, organiza tudo num quadro Kanban e avisa de boletos, inscrições e mudanças no ranking.</p>
    <ul class="why">
      <li>Sincronização automática a cada 6h</li>
      <li>Boletos detectados com lembrete de vencimento</li>
      <li>Agenda integrada (iPhone e Google)</li>
      <li>Compartilhamento em família</li>
    </ul>
    <a class="cta-btn" href="/manual">Conhecer o Tennis Flow</a>
    <a class="cta-btn-secondary" href="/">Já tenho conta</a>
  </div>

  <div class="footer">
    🎾 Tennis Flow — agenda de torneios pra famílias e atletas
  </div>
</div>
</body>
</html>`;
}

app.post('/api/profiles/:id/tournaments/:tid/share', requireAuth, ensureOwnedProfile, (req, res) => {
  const data = getSyncedData(req.params.id);
  const t = (data?.tournaments || []).find(x => x.id === req.params.tid);
  if (!t) return res.status(404).json({ error: 'Torneio não encontrado' });
  const link = findOrCreateShareToken(req.params.id, req.params.tid, req.user?.id || null);
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  res.json({ token: link.token, url: `${proto}://${host}/share/${link.token}` });
});

app.get('/share/:token', (req, res) => {
  const link = getShareLink(req.params.token);
  if (!link) return res.status(404).type('html').send('<h1>Link inválido ou expirado</h1>');
  const data = getSyncedData(link.profileId);
  const t = (data?.tournaments || []).find(x => x.id === link.tournamentId);
  if (!t) return res.status(404).type('html').send('<h1>Torneio não encontrado</h1>');
  res.type('html').send(renderSharePage(t));
});

// Profiles — escopados pela household do usuário
app.get('/api/profiles', requireAuth, (req, res) => {
  res.json(listProfiles({ householdId: req.householdId }));
});

app.post('/api/profiles', requireAuth, (req, res) => {
  const { athleteName, tiEmail, tiPassword, originAirport, originCity } = req.body || {};
  if (!tiEmail || !tiPassword) {
    return res.status(400).json({ error: 'tiEmail e tiPassword são obrigatórios' });
  }
  const profile = createProfile({
    userId: req.userId, householdId: req.householdId,
    athleteName, tiEmail, tiPassword, originAirport, originCity,
  });
  res.status(201).json(profile);
});

function ensureOwnedProfile(req, res, next) {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });
  if (!profileBelongsToHousehold(p, req.householdId)) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  next();
}

app.patch('/api/profiles/:id', requireAuth, ensureOwnedProfile, (req, res) => {
  const updated = updateProfile(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Perfil não encontrado' });
  res.json(updated);
});

app.delete('/api/profiles/:id', requireAuth, ensureOwnedProfile, (req, res) => {
  deleteProfile(req.params.id);
  res.status(204).end();
});

// Sync — only triggered explicitly by the user
app.post('/api/profiles/:id/sync', requireAuth, ensureOwnedProfile, (req, res) => {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });
  syncProfile(req.params.id).catch(err => console.error(`[sync ${req.params.id}]`, err.message));
  res.json({ status: 'started' });
});

app.get('/api/profiles/:id/sync-status', requireAuth, ensureOwnedProfile, (req, res) => {
  res.json({
    ...getSyncStatus(req.params.id),
    syncedAt: getSyncedData(req.params.id)?.syncedAt || null,
    unseenAlerts: getAlertEvents(req.params.id).filter(e => !e.seen).length,
  });
});

// ===== Alertas =====
const VALID_ALERT_TYPES = new Set(['new_tournament_location', 'new_tournament_tier', 'ranking_change']);

app.get('/api/profiles/:id/alert-rules', requireAuth, ensureOwnedProfile, (req, res) => {
  res.json(getAlertRules(req.params.id));
});

app.post('/api/profiles/:id/alert-rules', requireAuth, ensureOwnedProfile, (req, res) => {
  const { type, params, label, enabled } = req.body || {};
  if (!VALID_ALERT_TYPES.has(type)) return res.status(400).json({ error: 'Tipo inválido' });
  const rule = addAlertRule(req.params.id, { type, params: params || {}, label: label || null, enabled: enabled !== false });
  res.json(rule);
});

app.patch('/api/profiles/:id/alert-rules/:ruleId', requireAuth, ensureOwnedProfile, (req, res) => {
  const { type, params, label, enabled } = req.body || {};
  if (type && !VALID_ALERT_TYPES.has(type)) return res.status(400).json({ error: 'Tipo inválido' });
  const patch = {};
  if (type !== undefined) patch.type = type;
  if (params !== undefined) patch.params = params;
  if (label !== undefined) patch.label = label;
  if (enabled !== undefined) patch.enabled = enabled;
  const updated = updateAlertRule(req.params.id, req.params.ruleId, patch);
  if (!updated) return res.status(404).json({ error: 'Regra não encontrada' });
  res.json(updated);
});

app.delete('/api/profiles/:id/alert-rules/:ruleId', requireAuth, ensureOwnedProfile, (req, res) => {
  deleteAlertRule(req.params.id, req.params.ruleId);
  res.status(204).end();
});

app.get('/api/profiles/:id/alerts', requireAuth, ensureOwnedProfile, (req, res) => {
  const onlyUnseen = req.query.unseen === '1';
  const events = getAlertEvents(req.params.id);
  res.json(onlyUnseen ? events.filter(e => !e.seen) : events);
});

app.post('/api/profiles/:id/alerts/seen', requireAuth, ensureOwnedProfile, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids[] obrigatório' });
  res.json(markAlertsSeen(req.params.id, ids));
});

app.post('/api/profiles/:id/alerts/seen-all', requireAuth, ensureOwnedProfile, (req, res) => {
  res.json(markAllAlertsSeen(req.params.id));
});

app.delete('/api/profiles/:id/alerts/:eventId', requireAuth, ensureOwnedProfile, (req, res) => {
  deleteAlertEvent(req.params.id, req.params.eventId);
  res.status(204).end();
});

// Tournaments — single source of truth, server applies derivedStatus and merges notes
app.get('/api/profiles/:id/tournaments', requireAuth, ensureOwnedProfile, (req, res) => {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });

  ensureDefaultLabels(req.params.id);
  const data = getSyncedData(req.params.id);
  const notes = getNotes(req.params.id);
  const receiptsCount = receiptsCountByTournament(req.params.id);

  const today = new Date();
  const tournaments = (data?.tournaments || []).map(t => {
    const n = notes[t.id] || null;
    const ts = { ...t, derivedStatus: deriveStatus(t, today), notes: n };
    const autoLabels = deriveAutoLabels(ts, n || {});
    const manualLabels = resolveManualLabels(req.params.id, (n && n.labelIds) || []);
    ts.labels = [...autoLabels, ...manualLabels];
    ts.receiptsCount = receiptsCount[t.id] || 0;
    ts.commentsCount = (n?.comments || []).length;
    return ts;
  });

  res.json({
    athlete: data?.athlete || { name: p.athleteName },
    profile: { id: p.id, originAirport: p.originAirport, originCity: p.originCity, athleteName: p.athleteName },
    tournaments,
    syncedAt: data?.syncedAt || null,
  });
});

app.get('/api/profiles/:id/tournaments/:tid', requireAuth, ensureOwnedProfile, (req, res) => {
  const data = getSyncedData(req.params.id);
  if (!data) return res.status(404).json({ error: 'Sem dados sincronizados' });
  const t = (data.tournaments || []).find(x => x.id === req.params.tid);
  if (!t) return res.status(404).json({ error: 'Torneio não encontrado' });
  const notes = getNotes(req.params.id)[req.params.tid] || null;
  res.json({ ...t, derivedStatus: deriveStatus(t), notes });
});

app.patch('/api/profiles/:id/tournaments/:tid/notes', requireAuth, ensureOwnedProfile, (req, res) => {
  const updated = updateTournamentNotes(req.params.id, req.params.tid, req.body || {});
  res.json(updated);
});

// Lazy-load full tournament details (hotels, venues, observations) — public endpoint, with cache
const detailsCache = new Map(); // tid -> { data, ts }
const DETAILS_TTL = 6 * 60 * 60 * 1000; // 6h
app.get('/api/tournament-details/:tid', async (req, res) => {
  const tid = req.params.tid;
  const cached = detailsCache.get(tid);
  if (cached && Date.now() - cached.ts < DETAILS_TTL) {
    return res.json(cached.data);
  }
  try {
    const data = await fetchTournamentDetails(tid);
    detailsCache.set(tid, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Flight search URL builder — only for future tournaments
app.get('/api/profiles/:id/tournaments/:tid/flight-url', requireAuth, ensureOwnedProfile, (req, res) => {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });
  const data = getSyncedData(req.params.id);
  const t = data?.tournaments?.find(x => x.id === req.params.tid);
  if (!t) return res.status(404).json({ error: 'Torneio não encontrado' });
  if (!t.city || !t.startDate || !t.endDate) {
    return res.status(400).json({ error: 'Torneio sem cidade ou datas' });
  }

  const destAirport = inferAirport(t.city, t.state);
  if (!destAirport) {
    return res.status(400).json({ error: `Aeroporto da cidade "${t.city}" não cadastrado` });
  }
  const origin = (p.originAirport || 'BSB').toUpperCase();
  const dest = destAirport.toUpperCase();

  // Same-city tournaments: skip flight search — return a friendly hint instead.
  if (origin === dest) {
    return res.json({
      origin, dest, sameCity: true,
      message: `Torneio em ${t.city} — mesma cidade do atleta. Sem voo.`,
    });
  }

  const startISO = brToIso(t.startDate);
  const endISO = brToIso(t.endDate);
  const arrival = addDays(startISO, -1);
  const ret = addDays(endISO, 1);

  // Kayak — deep link com pre-fill confiável
  const kayakUrl = `https://www.kayak.com.br/flights/${origin}-${dest}/${arrival}/${ret}`;

  // Skyscanner — yymmdd nas datas
  const yymmdd = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
  const skyUrl = `https://www.skyscanner.com.br/transporte/passagens-aereas/${origin.toLowerCase()}/${dest.toLowerCase()}/${yymmdd(arrival)}/${yymmdd(ret)}/`;

  // Decolar (BR) — formato roundtrip
  const decolarUrl = `https://www.decolar.com/shop/flights-search/roundtrip/${origin}/${dest}/${arrival}/${ret}/1/0/0`;

  res.json({
    origin, dest, arrival, ret,
    links: [
      { name: 'Kayak', url: kayakUrl, primary: true },
      { name: 'Skyscanner', url: skyUrl },
      { name: 'Decolar', url: decolarUrl },
    ],
    url: kayakUrl,
  });
});

function brToIso(s) {
  if (!s) return null;
  const [d, m, y] = s.split('/').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// TI mistura "R$ 217,00" e "R$ 217.00" — sempre exibimos com vírgula (padrão BR).
function normalizeBrCurrency(s) {
  if (!s) return s;
  return String(s).replace(/(\d)\.(\d{2})(?!\d)/, '$1,$2');
}

function addDays(iso, n) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const AIRPORT_BY_CITY = {
  'belo horizonte': 'CNF',
  'sao paulo': 'GRU', 'são paulo': 'GRU',
  'rio de janeiro': 'GIG',
  'brasilia': 'BSB', 'brasília': 'BSB',
  'porto alegre': 'POA',
  'curitiba': 'CWB',
  'recife': 'REC',
  'salvador': 'SSA',
  'fortaleza': 'FOR',
  'natal': 'NAT',
  'manaus': 'MAO',
  'belem': 'BEL', 'belém': 'BEL',
  'goiania': 'GYN', 'goiânia': 'GYN',
  'florianopolis': 'FLN', 'florianópolis': 'FLN',
  'vitoria': 'VIX', 'vitória': 'VIX',
  'cuiaba': 'CGB', 'cuiabá': 'CGB',
  'campo grande': 'CGR',
  'uberlandia': 'UDI', 'uberlândia': 'UDI',
  'londrina': 'LDB',
  'maringa': 'MGF', 'maringá': 'MGF',
  'campinas': 'VCP',
  'joao pessoa': 'JPA', 'joão pessoa': 'JPA',
  'maceio': 'MCZ', 'maceió': 'MCZ',
  'aracaju': 'AJU',
  'sao luis': 'SLZ', 'são luís': 'SLZ',
  'teresina': 'THE',
  'porto velho': 'PVH',
  'rio branco': 'RBR',
  'palmas': 'PMW',
  'macapa': 'MCP', 'macapá': 'MCP',
  'boa vista': 'BVB',
  'sao jose dos campos': 'SJK', 'são josé dos campos': 'SJK',
  'niteroi': 'GIG', 'niterói': 'GIG',
  'colombo': 'CWB',
  'novo hamburgo': 'POA',
  'nova lima': 'CNF',
};

function inferAirport(city, state) {
  if (!city) return null;
  const norm = city.toLowerCase().trim();
  return AIRPORT_BY_CITY[norm] || null;
}

// Public iCal feed — anyone with the token can subscribe
app.get('/calendar/:token.ics', (req, res) => {
  const profile = findProfileByCalendarToken(req.params.token);
  if (!profile) return res.status(404).type('text/plain').send('Calendar não encontrado');
  const synced = getSyncedData(profile.id);
  const notes = getNotes(profile.id);
  const tournaments = (synced?.tournaments || []).map(t => ({
    ...t,
    notes: notes[t.id] || null,
  }));
  const ics = buildIcsFeed(tournaments, profile);
  res.type('text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="agenda-${profile.athleteName || 'tenis'}.ics"`);
  res.send(ics);
});

// Returns the calendar token for a profile (creates one if missing)
app.get('/api/profiles/:id/calendar-token', requireAuth, ensureOwnedProfile, (req, res) => {
  const token = ensureCalendarToken(req.params.id);
  if (!token) return res.status(404).json({ error: 'Perfil não encontrado' });
  res.json({ token });
});

function buildIcsFeed(tournaments, profile) {
  const fmt = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };
  const fmtDateOnly = (s) => {
    if (!s) return null;
    const [d, m, y] = s.split('/');
    return `${y}${m}${d}`;
  };
  const escape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AgendaTenisIntegrado//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(`Tênis - ${profile.athleteName || 'Atleta'}`)}`,
    `X-WR-CALDESC:Torneios e lembretes de pagamento`,
    'X-WR-TIMEZONE:America/Sao_Paulo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  const now = new Date();

  // Tournament events (only starred ones)
  for (const t of tournaments) {
    if (!t.notes?.selected) continue;
    if (!t.startDate || !t.endDate) continue;
    const start = fmtDateOnly(t.startDate);
    const endDate = fmtDateOnly(t.endDate);
    if (!start || !endDate) continue;
    // iCal DTEND for all-day events is exclusive — add 1 day
    const [ey, em, ed] = [endDate.slice(0,4), endDate.slice(4,6), endDate.slice(6,8)].map(Number);
    const endNext = new Date(Date.UTC(ey, em - 1, ed + 1));
    const endStr = `${endNext.getUTCFullYear()}${String(endNext.getUTCMonth()+1).padStart(2,'0')}${String(endNext.getUTCDate()).padStart(2,'0')}`;

    const tiersList = (t.tiers && t.tiers.length) ? t.tiers.join(', ') : t.tier;
    const hotelLines = (t.hotels && t.hotels.length)
      ? ['Hotéis sugeridos:', ...t.hotels.slice(0, 5).map(h => `  • ${h.name}${h.phone ? ' — ' + h.phone : ''}`)]
      : [];
    const desc = [
      tiersList && `Nível: ${tiersList}`,
      t.isAnnaInscribed && '✓ Inscrito',
      t.cancelDeadline && `Cancelamento até: ${t.cancelDeadline}`,
      t.notes?.flight && `Voo: ${t.notes.flight}`,
      t.notes?.hotel && `Hotel anotado: ${t.notes.hotel}`,
      t.notes?.transport && `Transporte: ${t.notes.transport}`,
      t.notes?.cost && `Custo: ${t.notes.cost}`,
      t.notes?.general && `Notas: ${t.notes.general}`,
      hotelLines.length ? '' : null,
      ...hotelLines,
      '',
      `Detalhes: ${t.url || ''}`,
    ].filter(x => x !== null && x !== undefined && x !== false).join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:tournament-${t.id}@agenda-tenis-integrado`,
      `DTSTAMP:${fmt(now)}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${endStr}`,
      `SUMMARY:🎾 ${escape(t.name || 'Torneio')}`,
      `DESCRIPTION:${escape(desc)}`,
      `LOCATION:${escape([t.city, t.state].filter(Boolean).join(' / '))}`,
      `URL:${t.url || ''}`,
      'BEGIN:VALARM',
      'TRIGGER:-P7D',
      'ACTION:DISPLAY',
      'DESCRIPTION:Torneio em 1 semana',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  // Payment reminders — só para torneios estrelados (mesmo critério do evento principal)
  for (const t of tournaments) {
    if (!t.notes?.selected) continue;
    if (t.notes?.manualGiveUp) continue;
    const pp = t.pendingPayment;
    if (!pp?.dueDate) continue;
    const [d, m, y] = pp.dueDate.split('/').map(Number);
    // Reminder: 09:00 BRT (= 12:00 UTC, BRT é UTC-3 e Brasil não tem mais DST)
    // do dia anterior ao vencimento. Constrói direto em UTC pra não depender
    // do timezone do servidor (Render roda em UTC, setHours daria 9 UTC = 6 BRT).
    const reminder = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
    const end = new Date(reminder.getTime() + 30 * 60 * 1000);

    const desc = [
      pp.category && `Categoria: ${pp.category}`,
      pp.value && `Valor: ${normalizeBrCurrency(pp.value)}`,
      `Vence: ${pp.dueDate} (16h horário de Brasília)`,
      '',
      pp.boletoUrl && `Boleto: ${pp.boletoUrl}`,
    ].filter(Boolean).join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:payment-${t.id}@agenda-tenis-integrado`,
      `DTSTAMP:${fmt(now)}`,
      `DTSTART:${fmt(reminder)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:💰 Pagar inscrição: ${escape(t.name || 'torneio')}`,
      `DESCRIPTION:${escape(desc)}`,
      pp.boletoUrl && `URL:${pp.boletoUrl}`,
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      'DESCRIPTION:Pagar inscrição amanhã',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).join('\r\n');
}

// ===== Kanban =====
app.get('/api/board/columns', (req, res) => {
  res.json({ columns: COLUMNS });
});

app.get('/api/profiles/:id/board', requireAuth, ensureOwnedProfile, (req, res) => {
  ensureDefaultLabels(req.params.id);
  const data = getSyncedData(req.params.id);
  const notes = getNotes(req.params.id);
  const tournaments = (data?.tournaments || []).map(t => {
    const n = notes[t.id] || {};
    const autoCol = computeAutoColumn(t, n);
    const col = effectiveColumn(t, n);
    const autoLabels = deriveAutoLabels(t, n);
    const manualLabels = resolveManualLabels(req.params.id, n.labelIds || []);
    return {
      ...t,
      notes: n,
      autoColumn: autoCol,
      column: col,
      labels: [...autoLabels, ...manualLabels],
    };
  });

  // Group by column
  const byColumn = Object.fromEntries(COLUMN_IDS.map(c => [c, []]));
  for (const t of tournaments) {
    if (!byColumn[t.column]) byColumn[t.column] = [];
    byColumn[t.column].push(t);
  }
  // Sort within each column: by manual cardOrder if set, else by start date
  for (const col of Object.keys(byColumn)) {
    byColumn[col].sort((a, b) => {
      const oa = a.notes?.cardOrder;
      const ob = b.notes?.cardOrder;
      if (typeof oa === 'number' && typeof ob === 'number') return oa - ob;
      if (typeof oa === 'number') return -1;
      if (typeof ob === 'number') return 1;
      // Fallback: chronological by startDate
      const da = (a.startDate || '').split('/').reverse().join('-');
      const db = (b.startDate || '').split('/').reverse().join('-');
      return da.localeCompare(db);
    });
  }

  res.json({
    columns: COLUMNS,
    cardsByColumn: byColumn,
    syncedAt: data?.syncedAt || null,
  });
});

// Limpa cardOrder de uma lista de torneios (usado quando o usuário toca no
// toggle asc/desc de uma coluna — reseta a ordem manual pra que o sort por data
// volte a funcionar).
app.post('/api/profiles/:id/cards/clear-order', requireAuth, ensureOwnedProfile, (req, res) => {
  const { tids } = req.body || {};
  if (!Array.isArray(tids)) return res.status(400).json({ error: 'tids deve ser array' });
  for (const tid of tids) {
    if (typeof tid === 'string') updateTournamentNotes(req.params.id, tid, { cardOrder: null });
  }
  res.json({ ok: true, cleared: tids.length });
});

app.patch('/api/profiles/:id/tournaments/:tid/column', requireAuth, ensureOwnedProfile, (req, res) => {
  const { column, order, siblings, sourceSiblings } = req.body || {};
  if (!COLUMN_IDS.includes(column)) {
    return res.status(400).json({ error: 'Coluna inválida' });
  }
  try {
    setCardColumn(req.params.id, req.params.tid, column);
    if (Array.isArray(siblings)) {
      siblings.forEach((sid, idx) => {
        if (typeof sid === 'string') updateTournamentNotes(req.params.id, sid, { cardOrder: idx });
      });
    } else if (typeof order === 'number') {
      updateTournamentNotes(req.params.id, req.params.tid, { cardOrder: order });
    }
    if (Array.isArray(sourceSiblings)) {
      sourceSiblings.forEach((sid, idx) => {
        if (typeof sid === 'string') updateTournamentNotes(req.params.id, sid, { cardOrder: idx });
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[move-card]', err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/profiles/:id/tournaments/:tid/activity', requireAuth, ensureOwnedProfile, (req, res) => {
  res.json({ items: getCardActivity(req.params.id, req.params.tid) });
});

app.post('/api/profiles/:id/tournaments/:tid/comments', requireAuth, ensureOwnedProfile, (req, res) => {
  try {
    const entry = addCardComment(req.params.id, req.params.tid, req.body?.text);
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/profiles/:id/tournaments/:tid/comments/:cid', requireAuth, ensureOwnedProfile, (req, res) => {
  try {
    const entry = updateCardComment(req.params.id, req.params.tid, req.params.cid, req.body?.text);
    if (!entry) return res.status(404).json({ error: 'Comentário não encontrado' });
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/profiles/:id/tournaments/:tid/comments/:cid', requireAuth, ensureOwnedProfile, (req, res) => {
  const ok = deleteCardComment(req.params.id, req.params.tid, req.params.cid);
  if (!ok) return res.status(404).json({ error: 'Comentário não encontrado' });
  res.status(204).end();
});

// ===== Etiquetas (labels) =====
app.get('/api/label-colors', (req, res) => {
  res.json({ colors: LABEL_COLORS });
});

// Lista etiquetas manuais do perfil (semeando padrão se vazio)
app.get('/api/profiles/:id/labels', requireAuth, ensureOwnedProfile, (req, res) => {
  ensureDefaultLabels(req.params.id);
  res.json({ labels: listManualLabels(req.params.id) });
});

app.post('/api/profiles/:id/labels', requireAuth, ensureOwnedProfile, (req, res) => {
  try {
    const entry = createManualLabel(req.params.id, req.body || {});
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/profiles/:id/labels/:lid', requireAuth, ensureOwnedProfile, (req, res) => {
  try {
    const entry = updateManualLabel(req.params.id, req.params.lid, req.body || {});
    if (!entry) return res.status(404).json({ error: 'Etiqueta não encontrada' });
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/profiles/:id/labels/:lid', requireAuth, ensureOwnedProfile, (req, res) => {
  const ok = deleteManualLabel(req.params.id, req.params.lid);
  if (!ok) return res.status(404).json({ error: 'Etiqueta não encontrada' });
  // (manuais ficam órfãs nas notas — resolveManualLabels filtra automaticamente)
  res.status(204).end();
});

// ===== Comprovantes =====
app.get('/api/receipt-categories', (req, res) => {
  res.json({ categories: RECEIPT_CATEGORIES });
});

app.get('/api/profiles/:id/quota', requireAuth, ensureOwnedProfile, (req, res) => {
  res.json(getQuotaInfo(req.params.id));
});

app.get('/api/profiles/:id/tournaments/:tid/receipts', requireAuth, ensureOwnedProfile, (req, res) => {
  const list = listReceipts(req.params.id, req.params.tid);
  const data = getSyncedData(req.params.id);
  const t = data?.tournaments?.find(x => x.id === req.params.tid);
  res.json({
    receipts: list.map(r => ({ ...r, viewUrl: `/api/profiles/${req.params.id}/tournaments/${req.params.tid}/receipts/${r.id}/file` })),
    daysUntilCleanup: t ? daysUntilCleanup(t) : null,
    cleanupDays: CLEANUP_DAYS_AFTER_END,
  });
});

app.post('/api/profiles/:id/tournaments/:tid/receipts', requireAuth, ensureOwnedProfile, (req, res) => {
  const { category, dataUrl, originalName } = req.body || {};
  try {
    const entry = addReceipt(req.params.id, req.params.tid, { category, dataUrl, originalName });
    res.status(201).json({
      ...entry,
      viewUrl: `/api/profiles/${req.params.id}/tournaments/${req.params.tid}/receipts/${entry.id}/file`,
      quota: getQuotaInfo(req.params.id),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/profiles/:id/tournaments/:tid/receipts/:rid/file', requireAuth, ensureOwnedProfile, (req, res) => {
  const found = getReceiptFile(req.params.id, req.params.tid, req.params.rid);
  if (!found) return res.status(404).json({ error: 'Comprovante não encontrado' });
  res.setHeader('Content-Type', found.entry.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(found.filePath);
});

app.patch('/api/profiles/:id/tournaments/:tid/receipts/:rid', requireAuth, ensureOwnedProfile, (req, res) => {
  try {
    const entry = updateReceiptCategory(req.params.id, req.params.tid, req.params.rid, req.body?.category);
    if (!entry) return res.status(404).json({ error: 'Comprovante não encontrado' });
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/profiles/:id/tournaments/:tid/receipts/:rid', requireAuth, ensureOwnedProfile, (req, res) => {
  const ok = deleteReceipt(req.params.id, req.params.tid, req.params.rid);
  if (!ok) return res.status(404).json({ error: 'Comprovante não encontrado' });
  res.status(204).end();
});

app.get('/api/profiles/:id/tournaments/:tid/receipts.zip', requireAuth, ensureOwnedProfile, (req, res) => {
  const list = listReceipts(req.params.id, req.params.tid);
  if (!list.length) return res.status(404).json({ error: 'Sem comprovantes' });
  const data = getSyncedData(req.params.id);
  const t = data?.tournaments?.find(x => x.id === req.params.tid);
  const safeName = (t?.name || 'torneio').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="comprovantes-${safeName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => res.status(500).end(err.message));
  archive.pipe(res);

  const categoryLabels = {
    food: 'Alimentacao', transport: 'Transporte', lodging: 'Hospedagem',
    registration: 'Inscricao', other: 'Outros',
  };
  for (const r of list) {
    const found = getReceiptFile(req.params.id, req.params.tid, r.id);
    if (!found) continue;
    const ext = r.filename.split('.').pop();
    const folder = categoryLabels[r.category] || 'Outros';
    archive.file(found.filePath, { name: `${folder}/${r.id}.${ext}` });
  }
  archive.finalize();
});

app.post('/api/shutdown', (req, res) => {
  res.json({ status: 'shutting-down' });
  console.log('\n👋 Encerrando o servidor a pedido do app...');
  setTimeout(() => process.exit(0), 200);
});

function getLanIps() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

const PORT = process.env.PORT || 4173;
app.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLanIps();
  console.log('\n  📅 Agenda Tênis Integrado rodando em:');
  console.log(`     • http://localhost:${PORT}                 ← este Mac`);
  for (const ip of lanIps) {
    console.log(`     • http://${ip}:${PORT}        ← celular/iPad na mesma WiFi`);
  }
  console.log('');
  startAutoSync();
});
