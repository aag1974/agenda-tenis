// Web Push — subscriptions persistidas por user, dispara notificações
// quando alertas são criados durante sync.
//
// VAPID keys vêm de env:
//   VAPID_PUBLIC_KEY  — público, exposto via /api/push/vapid-public
//   VAPID_PRIVATE_KEY — privado, fica só no servidor
//   VAPID_SUBJECT     — mailto:contato@... ou https://... (padrão Web Push)
//
// Subscriptions com 410 (Gone) ou 404 são removidas automaticamente.

import webpush from 'web-push';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SUBS_FILE = join(DATA_DIR, 'push-subscriptions.json');

mkdirSync(DATA_DIR, { recursive: true });

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:alexandre@opiniao.inf.br';

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
} else {
  console.warn('[push] VAPID keys ausentes (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) — push notifications desabilitadas');
}

export function pushIsConfigured() { return configured; }
export function getVapidPublicKey() { return PUBLIC_KEY; }

function readSubs() {
  if (!existsSync(SUBS_FILE)) return [];
  try { return JSON.parse(readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}
function writeSubs(list) { writeFileSync(SUBS_FILE, JSON.stringify(list, null, 2)); }

// Cada subscription guarda: { id, userId, profileId, endpoint, keys, createdAt }
// profileId pode ser null (push é por user, não por atleta), mas guardamos
// pra não disparar push pra atletas que o user não escolhe seguir.
export function saveSubscription(userId, subscription) {
  const list = readSubs();
  // dedup por endpoint — mesmo device/browser sobrescreve
  const idx = list.findIndex(s => s.endpoint === subscription.endpoint);
  const entry = {
    id: idx >= 0 ? list[idx].id : Math.random().toString(36).slice(2, 10),
    userId,
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    createdAt: idx >= 0 ? list[idx].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  writeSubs(list);
  return entry;
}

export function removeSubscription(userId, endpoint) {
  const list = readSubs();
  const filtered = list.filter(s => !(s.userId === userId && s.endpoint === endpoint));
  if (filtered.length !== list.length) {
    writeSubs(filtered);
    return true;
  }
  return false;
}

export function listSubscriptionsForUser(userId) {
  return readSubs().filter(s => s.userId === userId);
}

// Envia payload pra todas as subscriptions de uma lista de userIds.
// Retorna nº de devices que receberam. Subscriptions inválidas (410/404)
// são removidas automaticamente.
export async function sendPushToAll(payload) {
  const list = readSubs();
  const userIds = [...new Set(list.map(s => s.userId))];
  return sendPushToUsers(userIds, payload);
}

export async function sendPushToUsers(userIds, payload) {
  if (!configured) return 0;
  if (!userIds?.length) return 0;
  const list = readSubs();
  const targets = list.filter(s => userIds.includes(s.userId));
  if (!targets.length) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;
  const stale = [];

  await Promise.all(targets.map(async (sub) => {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: sub.keys,
      }, body);
      sent++;
    } catch (err) {
      // 404 / 410 = subscription expirada/revogada — limpa
      if (err.statusCode === 404 || err.statusCode === 410) {
        stale.push(sub.endpoint);
      } else {
        console.error('[push] erro:', err.statusCode || err.message);
      }
    }
  }));

  if (stale.length) {
    const filtered = list.filter(s => !stale.includes(s.endpoint));
    writeSubs(filtered);
  }
  return sent;
}
