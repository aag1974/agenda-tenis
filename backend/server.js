import 'dotenv/config';
import express from 'express';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import archiver from 'archiver';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  listProfiles, getProfile, createProfile, updateProfile, deleteProfile,
  getSyncedData, getNotes, updateTournamentNotes,
  ensureCalendarToken, findProfileByCalendarToken, claimOrphanProfiles,
  setCardColumn, addCardComment, updateCardComment, deleteCardComment, getCardActivity,
  getAlertRules, addAlertRule, updateAlertRule, deleteAlertRule,
  getAlertEvents, addAlertEvents, markAlertsSeen, markAllAlertsSeen, deleteAlertEvent,
  getReportRequests, addReportRequest, updateReportRequest,
  saveDeliveredReport, getDeliveredReport, listDeliveredReports,
  findOrCreateShareToken, getShareLink,
  clearColumnOverrides, saveSyncedData, resetProfileData,
  getMatchesData, upsertYearMatches,
} from './storage.js';
import { COLUMNS, COLUMN_IDS, computeAutoColumn, effectiveColumn, isRegistrationOpen, isRegistrationClosed, getRegistrationWindowState } from './board.js';
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
import { deriveStatus, fetchTournamentDetails, debugAthleteInscriptions, getAthleteStatusInTournament } from './scraper.js';
import { evaluateRules } from './alerts.js';
import { getProfileCredentials } from './storage.js';
import {
  createUser, authenticate, signCookie, authMiddleware, requireAuth, requireEditor, requireAdmin,
  userCount, listUsers, findUserById, getPlanInfo, migrateUsersAddPlan, updateUserName,
  isAdminEmail, listAdminUserIds,
} from './auth.js';
import {
  migrateHouseholdsOnBoot, listHouseholdMembers, profileBelongsToHousehold,
  createInvite, getInvite, listInvitesByHousehold, revokeInvite, acceptInvite,
  removeHouseholdMember, setMemberRole, MEMBER_ROLES,
  getHouseholdBoardConfig, setHouseholdBoardConfig,
} from './household.js';
import * as admin from './admin-cli.js';
import {
  pushIsConfigured, getVapidPublicKey,
  saveSubscription, removeSubscription, listSubscriptionsForUser,
  sendPushToUsers,
} from './push.js';

migrateHouseholdsOnBoot();
migrateUsersAddPlan();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
// JSON limit raised so receipt uploads (image as base64 data URL) fit
app.use(express.json({ limit: '5mb' }));
// Body parser pra upload de relatório HTML (text/html ou application/octet-stream).
// 8MB acomoda relatórios mais ricos (média Rafael ~170KB; Anna ~100KB).
app.use(express.text({ type: ['text/html', 'text/plain'], limit: '8mb' }));
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

// Versão do app — lê package.json no boot. Commit hash vem do Render
// (env var RENDER_GIT_COMMIT setada automaticamente em deploy) ou 'dev' local.
const VERSION_INFO = (() => {
  let version = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    version = pkg.version || version;
  } catch {}
  const commit = (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || 'dev';
  return { version, commit };
})();

app.get('/api/version', (req, res) => res.json(VERSION_INFO));

// ===== Auth =====
app.get('/api/auth/me', (req, res) => {
  const householdId = req.householdId || null;
  const members = householdId ? listHouseholdMembers(householdId) : [];
  const user = req.userId ? findUserById(req.userId) : null;
  res.json({
    userId: req.userId || null,
    email: req.userEmail || null,
    firstName: user?.firstName || null,
    lastName: user?.lastName || null,
    householdId,
    members,
    hasUsers: userCount() > 0,
    plan: user ? getPlanInfo(user) : null,
    role: req.userRole || null,
    isFounder: req.userId && req.userId === householdId,
    isAdmin: isAdminEmail(req.userEmail),
    needsProfile: user ? !(user.firstName && user.lastName) : false,
  });
});

app.post('/api/auth/signup', (req, res) => {
  const { email, password, firstName, lastName } = req.body || {};
  try {
    const user = createUser({ email, password, firstName, lastName });
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

// Pra usuários antigos que não tinham nome — modal "Complete seu cadastro"
app.post('/api/auth/complete-profile', requireAuth, (req, res) => {
  const { firstName, lastName } = req.body || {};
  try {
    const result = updateUserName(req.userId, { firstName, lastName });
    res.json(result);
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

app.patch('/api/household/board-config', requireAuth, requireEditor, (req, res) => {
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

app.patch('/api/household/members/:userId/role', requireAuth, (req, res) => {
  try {
    const result = setMemberRole({
      householdId: req.householdId,
      requesterId: req.userId,
      targetUserId: req.params.userId,
      role: req.body?.role,
    });
    res.json(result);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.get('/api/household/invites', requireAuth, (req, res) => {
  res.json({ invites: listInvitesByHousehold(req.householdId) });
});

app.post('/api/household/invites', requireAuth, requireEditor, (req, res) => {
  const { label, role } = req.body || {};
  const safeRole = MEMBER_ROLES.includes(role) ? role : 'editor';
  try {
    const inv = createInvite({
      householdId: req.householdId,
      invitedBy: req.userId,
      label: label || null,
      role: safeRole,
    });
    res.status(201).json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/household/invites/:token', requireAuth, requireEditor, (req, res) => {
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

// ===== Web Push =====
app.get('/api/push/info', requireAuth, (req, res) => {
  const subs = listSubscriptionsForUser(req.userId);
  res.json({
    enabled: pushIsConfigured(),
    publicKey: getVapidPublicKey(),
    subscriptionCount: subs.length,
  });
});

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys) {
    return res.status(400).json({ error: 'subscription inválida' });
  }
  const entry = saveSubscription(req.userId, sub);
  res.status(201).json({ id: entry.id });
});

app.delete('/api/push/subscribe', requireAuth, (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'endpoint obrigatório' });
  removeSubscription(req.userId, endpoint);
  res.status(204).end();
});

// Botão "testar" no frontend — envia push de teste pro próprio user
app.post('/api/push/test', requireAuth, async (req, res) => {
  const sent = await sendPushToUsers([req.userId], {
    title: '🎾 Tennis Flow',
    body: 'Notificações ativadas. Você vai receber alertas aqui quando algo importante acontecer.',
    tag: 'test',
    url: '/',
  });
  res.json({ sent });
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
    else if (cmd === 'set-name') result = admin.setName(args[0], args[1], args[2]);
    else if (cmd === 'activate-pro') result = admin.activatePro(args[0], args[1]);
    else if (cmd === 'set-plan-trial') result = admin.setPlanTrial(args[0]);
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
app.get('/upgrade', (req, res) => res.sendFile(join(__dirname, '..', 'frontend', 'upgrade.html')));

// ===== Card público compartilhado =====
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSharePage(tournament, details) {
  const t = tournament;
  const merged = details
    ? { ...t, hotels: details.hotels || t.hotels || [], venues: details.venues || t.venues || [], observations: details.observations || t.observations, cancelDeadline: details.cancelDeadline || t.cancelDeadline }
    : t;
  const name = escapeHtml(t.name || 'Torneio');
  const where = [t.city, t.state].filter(Boolean).join(' / ');
  const dates = t.startDate
    ? (t.endDate && t.endDate !== t.startDate ? `${t.startDate} a ${t.endDate}` : t.startDate)
    : null;
  const tiers = (t.tiers && t.tiers.length) ? t.tiers : (t.tier ? [t.tier] : []);
  const win = getRegistrationWindowState(merged);
  const regOpen = win === 'open';
  const regClosed = win === 'closed';
  const regDateText = (t.registrationStatus || '').match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || null;
  const closeDate = merged.registrationDeadline || regDateText || merged.cancelDeadline;
  let regLine = null;
  if (regOpen) regLine = closeDate ? `Inscrições abertas até ${closeDate}` : 'Inscrições abertas';
  else if (regClosed) regLine = closeDate ? `Inscrições encerraram em ${closeDate}` : 'Inscrições encerradas';
  else if (win === 'pending') regLine = merged.registrationOpensAt ? `Inscrições abrem em ${merged.registrationOpensAt}` : 'Inscrições a iniciar';
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
  :root { --navy:#0e3a4d; --navy-dark:#0a2e3d; --teal:#1f5b75; --cyan:#22d3ee; --cyan-deep:#00a3e0; --emerald:#10b981; --slate-100:#f1f5f9; --slate-200:#e2e8f0; --slate-300:#cbd5e1; --slate-500:#64748b; --slate-600:#475569; --slate-700:#334155; --slate-900:#0f172a; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, var(--navy-dark) 0%, var(--navy) 50%, var(--teal) 100%);
    background-attachment: fixed;
    color: var(--slate-900);
    min-height: 100vh; line-height: 1.5;
  }
  body::before, body::after {
    content:'🎾'; position:fixed; font-size:14rem; opacity:0.05; pointer-events:none; z-index:0;
  }
  body::before { top:-3rem; left:-3rem; transform:rotate(-15deg); }
  body::after { bottom:-3rem; right:-3rem; transform:rotate(20deg); }
  .wrap {
    max-width: 720px; margin: 0 auto; padding: 1.25rem 1rem 2rem;
    position: relative; z-index: 1;
  }
  /* Brand bar */
  .brand-bar {
    display:flex; align-items:center; justify-content:center; gap:0.6rem;
    color: white; padding: 0.5rem 0 1rem; opacity: 0.95;
  }
  .brand-mark {
    width: 36px; height: 36px; background: var(--navy-dark); border-radius: 8px;
    display:inline-flex; align-items:center; justify-content:center;
    font-size: 18px; position: relative;
  }
  .brand-mark .tf { position:absolute; bottom:1px; right:1px; font-size:9px; font-weight:900; line-height:1; letter-spacing:-0.5px; }
  .brand-mark .tf .t { color:white; }
  .brand-mark .tf .f { color: var(--cyan); }
  .brand-name { font-weight: 800; font-size: 1.1rem; }
  .brand-name .f { color: var(--cyan); }
  .shared-by {
    text-align:center; color: rgba(255,255,255,0.75); font-size:0.85rem;
    margin-bottom: 1rem;
  }
  /* Modal-like card */
  .modal-card {
    background: white; border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.3);
    overflow: hidden;
    margin-bottom: 1rem;
  }
  .modal-header {
    background: var(--navy);
    padding: 0.75rem 1.25rem;
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    color: white;
  }
  .modal-header .col-pill {
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    padding: 0.35rem 0.85rem; border-radius: 8px; font-size: 0.9rem; font-weight: 600;
    display: inline-flex; align-items: center; gap: 0.4rem;
  }
  .modal-header .ti-link {
    color: rgba(255,255,255,0.85); text-decoration: none; font-size: 0.85rem;
    white-space: nowrap;
  }
  .modal-header .ti-link:hover { color: white; text-decoration: underline; }
  .title-block {
    padding: 1rem 1.25rem; border-bottom: 1px solid var(--slate-200);
  }
  .title-block h1 {
    margin: 0 0 0.25rem; font-size: 1.25rem; line-height: 1.3; color: var(--navy);
    font-weight: 700;
  }
  .title-block .loc { color: var(--slate-600); font-size: 0.95rem; margin: 0; }
  .body { padding: 1rem 1.25rem; }
  .section { margin-bottom: 1.25rem; }
  .section:last-child { margin-bottom: 0; }
  .section-title {
    font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--slate-600); margin: 0 0 0.4rem;
  }
  /* Tier badges */
  .tier-badges { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .tier-badge {
    background: var(--emerald); color: white; font-size: 0.75rem;
    font-weight: 700; padding: 0.25rem 0.6rem; border-radius: 4px;
    letter-spacing: 0.02em;
  }
  /* Datas */
  .dates-main { font-size: 1.05rem; color: var(--slate-900); }
  .dates-sub { font-size: 0.85rem; color: var(--slate-600); margin-top: 0.15rem; }
  .dates-sub.open { color: #047857; font-weight: 600; }
  /* Lists (hotels, venues) */
  .info-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .info-item {
    border: 1px solid var(--slate-200); border-radius: 8px;
    padding: 0.65rem 0.85rem;
  }
  .info-item .name { font-weight: 600; font-size: 0.95rem; color: var(--slate-900); }
  .info-item .addr { font-size: 0.8rem; color: var(--slate-600); margin-top: 0.15rem; }
  .info-item .meta { font-size: 0.78rem; color: var(--slate-500); margin-top: 0.15rem; }
  /* Observations */
  details.obs { background: var(--slate-100); border-radius: 8px; padding: 0.6rem 0.85rem; }
  details.obs summary { cursor: pointer; font-size: 0.85rem; color: var(--slate-700); font-weight: 600; }
  details.obs pre {
    margin: 0.5rem 0 0; white-space: pre-wrap; font-family: inherit;
    font-size: 0.82rem; color: var(--slate-700); max-height: 240px; overflow-y: auto;
  }
  /* CTA */
  .cta {
    background: white; border-radius: 14px; padding: 1.5rem 1.25rem;
    text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  }
  .cta h2 { margin: 0 0 0.5rem; color: var(--navy); font-size: 1.2rem; }
  .cta .cta-lead { margin: 0 0 1.25rem; color: var(--slate-600); font-size: 0.95rem; }
  .why { list-style: none; padding: 0; margin: 1rem 0 1.25rem; text-align: left; }
  .why li {
    display: grid; grid-template-columns: 24px 1fr; gap: 0.5rem;
    padding: 0.35rem 0; font-size: 0.88rem; color: var(--slate-700);
  }
  .why li::before { content:'✓'; color: var(--cyan-deep); font-weight: 800; }
  .cta-btn {
    display:block; width:100%; padding: 0.85rem;
    background: var(--cyan-deep); color: white; text-decoration: none;
    border-radius: 10px; font-weight: 700; font-size: 1rem;
  }
  .cta-btn:hover { background: var(--navy); }
  .cta-btn-secondary {
    display:block; text-align:center; padding: 0.7rem;
    color: var(--navy); text-decoration: none;
    font-size: 0.9rem; margin-top: 0.5rem;
  }
  .cta-btn-secondary:hover { text-decoration: underline; }
  .footer {
    text-align:center; color: rgba(255,255,255,0.6); font-size: 0.78rem;
    margin-top: 1.25rem;
  }
</style>
</head>
<body>
<div class="wrap">

  <div class="brand-bar">
    <span class="brand-mark">🎾<span class="tf"><span class="t">T</span><span class="f">F</span></span></span>
    <span class="brand-name">Tennis<span class="f">Flow</span></span>
  </div>

  <div class="shared-by">Compartilhado via Tennis Flow</div>

  <div class="modal-card">
    <div class="modal-header">
      <span class="col-pill">${regOpen ? '🌟 Inscrições Abertas' : (regClosed ? '🔒 Inscrições Encerradas' : '🎾 Torneio')}</span>
      ${t.url ? `<a class="ti-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">Ver no Tênis Integrado ↗</a>` : ''}
    </div>

    <div class="title-block">
      <h1>${name}</h1>
      ${where ? `<p class="loc">${escapeHtml(where)}</p>` : ''}
    </div>

    <div class="body">

      ${tiers.length ? `
      <section class="section">
        <h3 class="section-title">Etiquetas</h3>
        <div class="tier-badges">
          ${tiers.map(x => `<span class="tier-badge">${escapeHtml(x)}</span>`).join('')}
        </div>
      </section>` : ''}

      ${dates ? `
      <section class="section">
        <h3 class="section-title">Datas</h3>
        <div class="dates-main">${escapeHtml(dates)}</div>
        ${regLine ? `<div class="dates-sub ${regOpen ? 'open' : ''}">${escapeHtml(regLine)}</div>` : ''}
        ${merged.cancelDeadline ? `<div class="dates-sub">Cancelamento até ${escapeHtml(merged.cancelDeadline)}</div>` : ''}
      </section>` : ''}

      ${(merged.hotels && merged.hotels.length) ? `
      <section class="section">
        <h3 class="section-title">🏨 Hotéis oficiais (${merged.hotels.length})</h3>
        <ul class="info-list">
          ${merged.hotels.map(h => `
            <li class="info-item">
              <div class="name">${escapeHtml(h.name || '')}</div>
              ${h.address ? `<div class="addr">${escapeHtml(h.address)}</div>` : ''}
              ${(h.phone || h.email) ? `<div class="meta">${escapeHtml([h.phone, h.email].filter(Boolean).join(' · '))}</div>` : ''}
            </li>`).join('')}
        </ul>
      </section>` : ''}

      ${(merged.venues && merged.venues.length) ? `
      <section class="section">
        <h3 class="section-title">📍 Locais dos jogos</h3>
        <ul class="info-list">
          ${merged.venues.map(v => `
            <li class="info-item">
              <div class="name">${escapeHtml(v.name || '')}</div>
              ${v.address ? `<div class="addr">${escapeHtml(v.address)}</div>` : ''}
              ${(v.phone || v.surface) ? `<div class="meta">${escapeHtml([v.phone, v.surface].filter(Boolean).join(' · '))}</div>` : ''}
            </li>`).join('')}
        </ul>
      </section>` : ''}

      ${merged.observations ? `
      <section class="section">
        <details class="obs">
          <summary>Observações do torneio ▾</summary>
          <pre>${escapeHtml(merged.observations)}</pre>
        </details>
      </section>` : ''}

    </div>
  </div>

  <div class="cta">
    <h2>Quer organizar a agenda do seu atleta também?</h2>
    <p class="cta-lead">Tennis Flow lê o Tênis Integrado e organiza tudo num quadro Kanban com alertas de boletos, inscrições, mudanças de ranking e agenda integrada.</p>
    <ul class="why">
      <li>Sincronização automática a cada 6 horas</li>
      <li>Boletos detectados com lembrete de vencimento</li>
      <li>Agenda integrada (iPhone, Google, Outlook)</li>
      <li>Quadro compartilhado com o resto da família</li>
      <li>Alertas customizados (novos torneios, ranking)</li>
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

app.post('/api/profiles/:id/tournaments/:tid/share', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  const data = getSyncedData(req.params.id);
  const t = (data?.tournaments || []).find(x => x.id === req.params.tid);
  if (!t) return res.status(404).json({ error: 'Torneio não encontrado' });
  const link = findOrCreateShareToken(req.params.id, req.params.tid, req.user?.id || null);
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  res.json({ token: link.token, url: `${proto}://${host}/share/${link.token}` });
});

app.get('/share/:token', async (req, res) => {
  const link = getShareLink(req.params.token);
  if (!link) return res.status(404).type('html').send('<h1>Link inválido ou expirado</h1>');
  const data = getSyncedData(link.profileId);
  const t = (data?.tournaments || []).find(x => x.id === link.tournamentId);
  if (!t) return res.status(404).type('html').send('<h1>Torneio não encontrado</h1>');
  // Tenta buscar detalhes (hotéis, locais, observações) do TI — mesmo cache
  // do endpoint de detalhes. Falha silenciosa se TI offline.
  let details = null;
  try { details = await loadTournamentDetailsCached(t.id); } catch {}
  // Evita cache de CDN servir versões antigas do layout
  res.set('Cache-Control', 'no-cache, must-revalidate').type('html').send(renderSharePage(t, details));
});

// Profiles — escopados pela household do usuário
app.get('/api/profiles', requireAuth, (req, res) => {
  res.json(listProfiles({ householdId: req.householdId }));
});

app.post('/api/profiles', requireAuth, requireEditor, (req, res) => {
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

app.patch('/api/profiles/:id', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  const updated = updateProfile(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Perfil não encontrado' });
  res.json(updated);
});

app.delete('/api/profiles/:id', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  deleteProfile(req.params.id);
  res.status(204).end();
});

// Sync — só dispara quando o usuário pede explicitamente
app.post('/api/profiles/:id/sync', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });
  syncProfile(req.params.id).catch(err => console.error(`[sync ${req.params.id}]`, err.message));
  res.json({ status: 'started' });
});

// Sync de todos os atletas da household — uma chamada, dispara em paralelo.
// Retorna a lista dos profileIds disparados pra o frontend acompanhar.
app.post('/api/sync-all', requireAuth, requireEditor, (req, res) => {
  const profiles = listProfiles({ householdId: req.householdId });
  const ids = profiles.map(p => p.id);
  for (const id of ids) {
    syncProfile(id).catch(err => console.error(`[sync ${id}]`, err.message));
  }
  res.json({ profileIds: ids });
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

app.post('/api/profiles/:id/alert-rules', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  const { type, params, label, enabled } = req.body || {};
  if (!VALID_ALERT_TYPES.has(type)) return res.status(400).json({ error: 'Tipo inválido' });
  const rule = addAlertRule(req.params.id, { type, params: params || {}, label: label || null, enabled: enabled !== false });
  res.json(rule);
});

app.patch('/api/profiles/:id/alert-rules/:ruleId', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
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

app.delete('/api/profiles/:id/alert-rules/:ruleId', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  deleteAlertRule(req.params.id, req.params.ruleId);
  res.status(204).end();
});

app.get('/api/profiles/:id/alerts', requireAuth, ensureOwnedProfile, (req, res) => {
  const onlyUnseen = req.query.unseen === '1';
  const events = getAlertEvents(req.params.id);
  res.json(onlyUnseen ? events.filter(e => !e.seen) : events);
});

app.post('/api/profiles/:id/alerts/seen', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids[] obrigatório' });
  res.json(markAlertsSeen(req.params.id, ids));
});

app.post('/api/profiles/:id/alerts/seen-all', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  res.json(markAllAlertsSeen(req.params.id));
});

app.delete('/api/profiles/:id/alerts/:eventId', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  deleteAlertEvent(req.params.id, req.params.eventId);
  res.status(204).end();
});

// Admin: re-avalia regras retroativamente contra TODOS os torneios atuais
// (passa prevTournaments=[]). Útil quando regra/lógica mudou e queremos
// disparar alertas que deveriam ter disparado no passado. Dedupe natural
// via dedupeKey — eventos já existentes não são recriados.
app.post('/api/profiles/:id/alerts/reevaluate', requireAuth, requireAdmin, (req, res) => {
  const profileId = req.params.id;
  const synced = getSyncedData(profileId);
  if (!synced) return res.status(404).json({ error: 'Sem dados sincronizados' });
  const rules = getAlertRules(profileId);
  const events = evaluateRules({
    rules,
    prevTournaments: [],                  // tudo vira "novo"
    currTournaments: synced.tournaments || [],
    prevAthlete: null,                    // ranking_change não avalia retroativo
    currAthlete: synced.athlete,
  });
  const added = addAlertEvents(profileId, events);
  res.json({ evaluated: events.length, added: added.length });
});

// ===== Solicitação de relatório completo (LGPD) =====
// Disparado pelo botão "Enviar solicitação" no modal de consentimento.
// Registra no servidor a autorização — evidência redundante alongside o email.
// O texto exato exibido ao usuário vai pro registro pra provar o que foi consentido.
app.post('/api/profiles/:id/report-request', requireAuth, ensureOwnedProfile, (req, res) => {
  const { consentText, athleteName: bodyAthleteName } = req.body || {};
  if (!consentText || typeof consentText !== 'string') {
    return res.status(400).json({ error: 'consentText obrigatório' });
  }
  const profile = getProfile(req.params.id);
  const user = findUserById(req.userId);
  const ip = (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').toString().split(',')[0].trim();
  const entry = addReportRequest(req.params.id, {
    athleteName: bodyAthleteName || profile?.athleteName || null,
    requesterUserId: req.userId,
    requesterEmail: user?.email || null,
    requesterFirstName: user?.firstName || null,
    requesterLastName: user?.lastName || null,
    consentText,
    ip,
    userAgent: req.headers['user-agent'] || null,
    status: 'pending',
  });

  // Notifica admins via push (não bloqueia response — falha não rolla back).
  // Tag única evita stack de notificações se cliente clicar várias vezes.
  const adminIds = listAdminUserIds();
  if (adminIds.length) {
    const requesterLabel = entry.requesterEmail || 'sem email';
    sendPushToUsers(adminIds, {
      title: '📬 Novo pedido de relatório',
      body: `${entry.athleteName || 'Atleta'} · ${requesterLabel}`,
      tag: `report-request-${entry.id}`,
      url: '/?admin=requests',
    }).catch(err => console.error('[report-request push]', err.message || err));
  }

  res.json(entry);
});

// Admin entrega o relatório final: recebe HTML, salva no perfil, marca o
// request como 'delivered', notifica o dono do perfil (alerta + push).
app.post('/api/admin/report-requests/:profileId/:requestId/deliver', requireAuth, requireAdmin, (req, res) => {
  const { profileId, requestId } = req.params;
  const html = typeof req.body === 'string' ? req.body : null;
  if (!html || html.length < 500) {
    return res.status(400).json({ error: 'HTML do relatório obrigatório (text/html no body)' });
  }
  const requests = getReportRequests(profileId);
  const requestEntry = requests.find(r => r.id === requestId);
  if (!requestEntry) return res.status(404).json({ error: 'Pedido não encontrado' });

  // Salva HTML em disco usando reportId determinístico (= requestId)
  const reportId = requestId;
  saveDeliveredReport(profileId, reportId, html);

  // Atualiza status do pedido
  const updated = updateReportRequest(profileId, requestId, {
    status: 'delivered',
    deliveredAt: new Date().toISOString(),
    deliveredBy: req.userEmail,
    reportId,
  });

  // Cria alerta no painel do dono — aparece no sino com botão "Ver relatório"
  const profile = getProfile(profileId);
  const athleteName = profile?.athleteName || 'atleta';
  addAlertEvents(profileId, [{
    type: 'report_delivered',
    message: `📊 Seu Relatório de Performance ${G_GENDER_PARTICLE(profile)} ${athleteName} está pronto!`,
    reportId,
    dedupeKey: `report-delivered-${reportId}`,
  }]);

  // Push pro dono do perfil (não pros admins)
  if (profile?.userId) {
    sendPushToUsers([profile.userId], {
      title: '✨ Seu Relatório de Performance está pronto',
      body: `Análise completa de ${athleteName} disponível no app.`,
      tag: `report-delivered-${reportId}`,
      url: '/?reportReady=1',
    }).catch(err => console.error('[deliver push]', err.message || err));
  }

  res.json(updated);
});

// Helper: artigo+nome do atleta ("de Anna" / "do Rafael"). Sem gênero
// detectado, fica "de" — soa neutro o suficiente.
function G_GENDER_PARTICLE() { return 'de'; }

// Cliente lista relatórios entregues do próprio perfil (acesso autenticado)
app.get('/api/profiles/:id/reports', requireAuth, ensureOwnedProfile, (req, res) => {
  res.json(listDeliveredReports(req.params.id));
});

// Cliente baixa/visualiza um relatório específico (HTML inline)
app.get('/api/profiles/:id/reports/:reportId', requireAuth, ensureOwnedProfile, (req, res) => {
  const html = getDeliveredReport(req.params.id, req.params.reportId);
  if (!html) return res.status(404).send('Relatório não encontrado');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Admin atualiza status de um pedido (pipeline pending → in_progress → delivered)
app.patch('/api/admin/report-requests/:profileId/:requestId', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'in_progress', 'delivered'].includes(status)) {
    return res.status(400).json({ error: 'status deve ser pending, in_progress ou delivered' });
  }
  const updated = updateReportRequest(req.params.profileId, req.params.requestId, {
    status,
    statusUpdatedBy: req.userEmail,
  });
  if (!updated) return res.status(404).json({ error: 'Pedido não encontrado' });
  res.json(updated);
});

// Admin: lista todas as solicitações através de todos os perfis.
// Visão pipeline: pending → in_progress → delivered.
app.get('/api/admin/report-requests', requireAuth, requireAdmin, (req, res) => {
  const all = [];
  for (const p of listProfiles({})) {
    const requests = getReportRequests(p.id);
    for (const r of requests) {
      all.push({ ...r, profileId: p.id });
    }
  }
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(all);
});

// ===== Admin: cross-household pra suporte e geração de relatório =====
// Após autorização do responsável via email (consentimento LGPD registrado),
// admin precisa acessar dados de qualquer atleta pra elaborar o relatório
// técnico assinado. Endpoints separados de `/api/profiles/:id/*` pra deixar
// claro o gate de privilégio (não é dono → precisa ser admin).

app.get('/api/admin/profiles', requireAuth, requireAdmin, (req, res) => {
  const profiles = listProfiles({});
  const enriched = profiles.map(p => {
    const owner = p.userId ? findUserById(p.userId) : null;
    const synced = getSyncedData(p.id);
    const matches = getMatchesData(p.id);
    return {
      id: p.id,
      athleteName: p.athleteName,
      tiEmail: p.tiEmail,
      ownerEmail: owner?.email || null,
      ownerName: owner ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() : null,
      tournamentCount: (synced?.tournaments || []).length,
      matchCount: (matches?.matches || []).length,
      lastSync: synced?.syncedAt || null,
    };
  });
  enriched.sort((a, b) => (a.athleteName || '').localeCompare(b.athleteName || '', 'pt-BR'));
  res.json(enriched);
});

app.get('/api/admin/profiles/:id/report', requireAuth, requireAdmin, async (req, res) => {
  const p = getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado' });
  const { generateReportHtml } = await import('./report.js');
  const html = generateReportHtml(req.params.id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/api/admin/profiles/:id/export', requireAuth, requireAdmin, (req, res) => {
  const profileId = req.params.id;
  const profile = getProfile(profileId);
  if (!profile) return res.status(404).json({ error: 'Perfil não encontrado' });

  const synced = getSyncedData(profileId);
  const matches = getMatchesData(profileId);
  const alerts = getAlertEvents(profileId);
  const consent = getReportRequests(profileId);
  const owner = profile.userId ? findUserById(profile.userId) : null;

  const safeName = (profile.athleteName || 'atleta').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `tennis-flow-export_${safeName}_${stamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { try { res.status(500).end(err.message); } catch {} });
  archive.pipe(res);

  // meta.json — quem é, quem é o dono, quem exportou (audit trail)
  const meta = {
    profile: {
      id: profile.id,
      athleteName: profile.athleteName,
      tiEmail: profile.tiEmail,
      originAirport: profile.originAirport,
      originCity: profile.originCity,
      createdAt: profile.createdAt,
    },
    owner: owner ? { email: owner.email, firstName: owner.firstName, lastName: owner.lastName } : null,
    exportedAt: new Date().toISOString(),
    exportedBy: req.userEmail,
  };
  archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' });
  archive.append(JSON.stringify(consent || [], null, 2), { name: 'consent.json' });
  if (synced) archive.append(JSON.stringify(synced, null, 2), { name: 'synced.json' });
  if (matches) archive.append(JSON.stringify(matches, null, 2), { name: 'matches.json' });
  archive.append(JSON.stringify(alerts || [], null, 2), { name: 'alerts.json' });

  archive.finalize();
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

app.patch('/api/profiles/:id/tournaments/:tid/notes', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  const updated = updateTournamentNotes(req.params.id, req.params.tid, req.body || {});
  res.json(updated);
});

// Relatório PDF-friendly — HTML standalone otimizado pra impressão A4.
// Linguagem ELI5, traduz "Glicko/z-score/IC" em narrativa de coach.
// User abre em nova aba e usa ⌘+P pra salvar como PDF.
app.get('/api/profiles/:id/report', requireAuth, ensureOwnedProfile, async (req, res) => {
  const { generateReportHtml } = await import('./report.js');
  const html = generateReportHtml(req.params.id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Analytics — Glicko-2 + Expected vs Realized + bucket performance + top surprises.
// Roda sobre matches.json (já scrapeado). Exclui WOs e duplas das estatísticas.
// Inclui narrativas ELI5 prontas pra serem renderizadas no frontend.
app.get('/api/profiles/:id/analytics', requireAuth, ensureOwnedProfile, async (req, res) => {
  const { analyzeMatches } = await import('./analytics.js');
  const { generateAllNarratives } = await import('./narrative.js');
  const data = getMatchesData(req.params.id);
  const result = analyzeMatches(data.matches || [], req.params.id);
  const profile = getProfile(req.params.id);
  const synced = getSyncedData(req.params.id);
  const fullName = synced?.athlete?.name || profile?.athleteName || 'Atleta';
  const firstName = fullName.split(' ')[0];
  result.narratives = generateAllNarratives(result, firstName);
  res.json(result);
});

// Histórico de matches (jogos disputados pelo atleta).
// Foundation pra Performance/Scouting — alimenta Glicko, win prob, Markov.
app.get('/api/profiles/:id/matches', requireAuth, ensureOwnedProfile, (req, res) => {
  const data = getMatchesData(req.params.id);
  res.json({
    matches: data.matches || [],
    lastScraped: data.lastScraped || {},
    count: (data.matches || []).length,
  });
});

// Refresh só matches — sem rodar sync completa de 30-200s. Só ~3s.
// Útil pra corrigir dados de matches quando o scraper tiver bug, ou pra
// atualizar histórico depois de torneio sem precisar pular pra agenda.
app.post('/api/profiles/:id/matches/refresh', requireAuth, requireEditor, ensureOwnedProfile, async (req, res) => {
  const creds = getProfileCredentials(req.params.id);
  if (!creds) return res.status(404).json({ error: 'Perfil não encontrado' });
  try {
    const { TIClient } = await import('./ti-client.js');
    const { fetchAthleteMatches } = await import('./match-scraper.js');
    const client = new TIClient();
    await client.login(creds.email, creds.password);
    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1, currentYear - 2];
    const totals = {};
    for (const y of years) {
      try {
        const matches = await fetchAthleteMatches(client, client.athleteId, y);
        upsertYearMatches(req.params.id, y, matches);
        totals[y] = matches.length;
      } catch (err) {
        totals[y] = `erro: ${err.message}`;
      }
    }
    const data = getMatchesData(req.params.id);
    res.json({ totals, totalUnique: data.matches?.length || 0, lastScraped: data.lastScraped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export CSV de matches — Excel-friendly. UTF-8 BOM pra Excel BR ler acentos.
app.get('/api/profiles/:id/matches.csv', requireAuth, ensureOwnedProfile, (req, res) => {
  const data = getMatchesData(req.params.id);
  const matches = data.matches || [];
  const cols = [
    'id', 'year', 'date', 'tournamentId', 'tournamentName', 'tier', 'category',
    'isDoubles', 'round', 'roundRaw', 'city', 'state', 'startDate', 'endDate',
    'opponentId', 'opponentName', 'result', 'scoreRaw',
    'setsWonAthlete', 'setsWonOpponent', 'gamesWonAthlete', 'gamesWonOpponent',
    'hasSuperTiebreak', 'wo', 'scrapedAt',
  ];
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(';')];
  for (const m of matches) lines.push(cols.map(c => escape(m[c])).join(';'));
  const csv = '﻿' + lines.join('\n');  // BOM pra Excel reconhecer UTF-8
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="matches-${req.params.id}.csv"`);
  res.send(csv);
});

// Reset apenas das movimentações manuais (column + cardOrder).
// Preserva comentários, etiquetas, anexos, agenda, alertas, pin etc.
app.post('/api/profiles/:id/reset-board-overrides', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  const cleared = clearColumnOverrides(req.params.id);
  res.json({ cleared });
});

// Debug: roda o scrape de inscrições da atleta e retorna pra inspeção.
// Útil pra investigar "por que Anna não aparece como inscrita em X".
app.get('/api/profiles/:id/debug-inscriptions', requireAuth, ensureOwnedProfile, async (req, res) => {
  const creds = getProfileCredentials(req.params.id);
  if (!creds) return res.status(404).json({ error: 'Perfil não encontrado' });
  try {
    const tid = req.query.tid;
    const data = await debugAthleteInscriptions(creds, { tid });
    const found = tid ? data.unionIds.includes(String(tid)) : null;
    res.json({ ...data, queryTid: tid || null, found });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset radical: apaga synced + notes + alertas. Preserva perfil + creds.
// Próxima sync vira baseline novo. Útil pra limpar quadro que ficou
// inconsistente após muitas movimentações + mudanças no app.
app.post('/api/profiles/:id/reset-all', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  resetProfileData(req.params.id);
  res.json({ ok: true });
});

// Lazy-load full tournament details (hotels, venues, observations) — public endpoint, with cache
const detailsCache = new Map(); // tid -> { data, ts }
const DETAILS_TTL = 6 * 60 * 60 * 1000; // 6h
async function loadTournamentDetailsCached(tid) {
  const cached = detailsCache.get(tid);
  if (cached && Date.now() - cached.ts < DETAILS_TTL) return cached.data;
  const data = await fetchTournamentDetails(tid);
  detailsCache.set(tid, { data, ts: Date.now() });
  return data;
}
app.get('/api/tournament-details/:tid', async (req, res) => {
  try {
    const data = await loadTournamentDetailsCached(req.params.tid);
    // Lazy enrichment: persiste tiers + cancelDeadline em synced.json quando
    // a página de detalhes trouxer info nova. Resolve dois casos:
    // 1) Card mostra só "G1+" quando o torneio é multi-chave (G1+ e GA)
    // 2) Status "Iniciado" precisa de cancelDeadline pra saber se já passou
    const pid = req.query.profileId;
    if (pid && req.userId) {
      const p = getProfile(pid);
      if (p && profileBelongsToHousehold(pid, req.householdId)) {
        const synced = getSyncedData(pid);
        const t = (synced?.tournaments || []).find(x => x.id === req.params.tid);
        if (t) {
          let changed = false;
          if (Array.isArray(data?.tiers) && data.tiers.length) {
            const merged = [...new Set([...(t.tiers || []), ...data.tiers])];
            if (merged.length !== (t.tiers || []).length) {
              t.tiers = merged;
              if (!t.tier) t.tier = merged[0];
              changed = true;
            }
          }
          if (data?.cancelDeadline && t.cancelDeadline !== data.cancelDeadline) {
            t.cancelDeadline = data.cancelDeadline;
            changed = true;
          }
          if (data?.registrationOpensAt && t.registrationOpensAt !== data.registrationOpensAt) {
            t.registrationOpensAt = data.registrationOpensAt;
            changed = true;
          }
          if (data?.registrationDeadline && t.registrationDeadline !== data.registrationDeadline) {
            t.registrationDeadline = data.registrationDeadline;
            changed = true;
          }
          if (changed) saveSyncedData(pid, synced);
        }
      }
    }
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
    'PRODID:-//TennisFlow//PT-BR',
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
      `UID:tournament-${t.id}@tennis-flow`,
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
      `UID:payment-${t.id}@tennis-flow`,
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
app.post('/api/profiles/:id/cards/clear-order', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  const { tids } = req.body || {};
  if (!Array.isArray(tids)) return res.status(400).json({ error: 'tids deve ser array' });
  for (const tid of tids) {
    if (typeof tid === 'string') updateTournamentNotes(req.params.id, tid, { cardOrder: null });
  }
  res.json({ ok: true, cleared: tids.length });
});

app.patch('/api/profiles/:id/tournaments/:tid/column', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
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

app.post('/api/profiles/:id/tournaments/:tid/comments', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  try {
    const entry = addCardComment(req.params.id, req.params.tid, req.body?.text);
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/profiles/:id/tournaments/:tid/comments/:cid', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  try {
    const entry = updateCardComment(req.params.id, req.params.tid, req.params.cid, req.body?.text);
    if (!entry) return res.status(404).json({ error: 'Comentário não encontrado' });
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/profiles/:id/tournaments/:tid/comments/:cid', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
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

app.post('/api/profiles/:id/labels', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  try {
    const entry = createManualLabel(req.params.id, req.body || {});
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/profiles/:id/labels/:lid', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  try {
    const entry = updateManualLabel(req.params.id, req.params.lid, req.body || {});
    if (!entry) return res.status(404).json({ error: 'Etiqueta não encontrada' });
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/profiles/:id/labels/:lid', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
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

app.post('/api/profiles/:id/tournaments/:tid/receipts', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
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

app.patch('/api/profiles/:id/tournaments/:tid/receipts/:rid', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
  try {
    const entry = updateReceiptCategory(req.params.id, req.params.tid, req.params.rid, req.body?.category);
    if (!entry) return res.status(404).json({ error: 'Comprovante não encontrado' });
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/profiles/:id/tournaments/:tid/receipts/:rid', requireAuth, requireEditor, ensureOwnedProfile, (req, res) => {
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
  console.log('\n  📅 Tennis Flow rodando em:');
  console.log(`     • http://localhost:${PORT}                 ← este Mac`);
  for (const ip of lanIps) {
    console.log(`     • http://${ip}:${PORT}        ← celular/iPad na mesma WiFi`);
  }
  console.log('');
  startAutoSync();
});
