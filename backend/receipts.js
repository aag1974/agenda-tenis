// Comprovantes — uploads de imagem por torneio com categoria.
// Compressão é feita client-side; aqui validamos formato/tamanho e gravamos.
// Cleanup automático: comprovantes de torneios com endDate + 90 dias < hoje.

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, rmdirSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

export const RECEIPT_CATEGORIES = ['food', 'transport', 'lodging', 'registration', 'other'];
export const QUOTA_BYTES = 200 * 1024 * 1024; // 200 MB
export const QUOTA_WARN_BYTES = 150 * 1024 * 1024; // 150 MB
export const CLEANUP_DAYS_AFTER_END = 90;

function profileReceiptsDir(profileId) {
  return join(DATA_DIR, `profile-${profileId}`, 'receipts');
}
function tournamentReceiptsDir(profileId, tournamentId) {
  return join(profileReceiptsDir(profileId), tournamentId);
}
function metadataFile(profileId, tournamentId) {
  return join(tournamentReceiptsDir(profileId, tournamentId), '_meta.json');
}

function readMeta(profileId, tournamentId) {
  const file = metadataFile(profileId, tournamentId);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return []; }
}

function writeMeta(profileId, tournamentId, list) {
  const dir = tournamentReceiptsDir(profileId, tournamentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(metadataFile(profileId, tournamentId), JSON.stringify(list, null, 2));
}

export function listReceipts(profileId, tournamentId) {
  return readMeta(profileId, tournamentId);
}

// Mapa { tournamentId: count } pra mostrar no card do Kanban
export function receiptsCountByTournament(profileId) {
  const dir = profileReceiptsDir(profileId);
  if (!existsSync(dir)) return {};
  const out = {};
  for (const tid of readdirSync(dir)) {
    const meta = readMeta(profileId, tid);
    if (meta.length) out[tid] = meta.length;
  }
  return out;
}

export function getProfileStorageBytes(profileId) {
  const dir = profileReceiptsDir(profileId);
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const tid of readdirSync(dir)) {
    const tdir = join(dir, tid);
    try {
      if (!statSync(tdir).isDirectory()) continue;
      for (const f of readdirSync(tdir)) {
        if (f === '_meta.json') continue; // metadata size doesn't count toward quota
        try { total += statSync(join(tdir, f)).size; } catch {}
      }
    } catch {}
  }
  return total;
}

export function getQuotaInfo(profileId) {
  const used = getProfileStorageBytes(profileId);
  return {
    usedBytes: used,
    quotaBytes: QUOTA_BYTES,
    warnBytes: QUOTA_WARN_BYTES,
    pctUsed: Math.round((used / QUOTA_BYTES) * 100),
    nearLimit: used >= QUOTA_WARN_BYTES,
    atLimit: used >= QUOTA_BYTES,
  };
}

export function addReceipt(profileId, tournamentId, { category, dataUrl, originalName }) {
  if (!RECEIPT_CATEGORIES.includes(category)) {
    throw new Error('Categoria inválida');
  }
  const m = (dataUrl || '').match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/);
  if (!m) throw new Error('Imagem inválida (esperado image/jpeg, png ou webp em base64)');
  const mime = m[1];
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0) throw new Error('Imagem vazia');
  if (buffer.length > 2 * 1024 * 1024) throw new Error('Imagem maior que 2MB — comprime antes');

  const used = getProfileStorageBytes(profileId);
  if (used + buffer.length > QUOTA_BYTES) {
    throw new Error(`Limite de armazenamento atingido (${Math.round(QUOTA_BYTES / 1048576)}MB). Exporte e exclua comprovantes antigos.`);
  }

  const ext = mime === 'image/png' ? 'png' : (mime === 'image/webp' ? 'webp' : 'jpg');
  const id = randomBytes(8).toString('hex');
  const filename = `${id}.${ext}`;

  const dir = tournamentReceiptsDir(profileId, tournamentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), buffer);

  const list = readMeta(profileId, tournamentId);
  const entry = {
    id,
    category,
    filename,
    mime,
    size: buffer.length,
    originalName: originalName || null,
    uploadedAt: new Date().toISOString(),
  };
  list.push(entry);
  writeMeta(profileId, tournamentId, list);
  return entry;
}

export function getReceiptFile(profileId, tournamentId, receiptId) {
  const list = readMeta(profileId, tournamentId);
  const entry = list.find(r => r.id === receiptId);
  if (!entry) return null;
  const filePath = join(tournamentReceiptsDir(profileId, tournamentId), entry.filename);
  if (!existsSync(filePath)) return null;
  return { entry, filePath };
}

export function updateReceiptCategory(profileId, tournamentId, receiptId, category) {
  if (!RECEIPT_CATEGORIES.includes(category)) throw new Error('Categoria inválida');
  const list = readMeta(profileId, tournamentId);
  const entry = list.find(r => r.id === receiptId);
  if (!entry) return null;
  entry.category = category;
  writeMeta(profileId, tournamentId, list);
  return entry;
}

export function deleteReceipt(profileId, tournamentId, receiptId) {
  const list = readMeta(profileId, tournamentId);
  const idx = list.findIndex(r => r.id === receiptId);
  if (idx < 0) return false;
  const entry = list[idx];
  try { unlinkSync(join(tournamentReceiptsDir(profileId, tournamentId), entry.filename)); } catch {}
  list.splice(idx, 1);
  writeMeta(profileId, tournamentId, list);
  return true;
}

// List all tournament IDs that have receipts for this profile
export function listProfileTournamentReceiptDirs(profileId) {
  const dir = profileReceiptsDir(profileId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => {
    try { return statSync(join(dir, name)).isDirectory(); } catch { return false; }
  });
}

// Delete entire tournament receipts dir (used by cleanup)
export function deleteTournamentReceipts(profileId, tournamentId) {
  const dir = tournamentReceiptsDir(profileId, tournamentId);
  if (!existsSync(dir)) return false;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)); } catch {}
  }
  try { rmdirSync(dir); } catch {}
  return true;
}

// Days remaining until cleanup for a given tournament
export function daysUntilCleanup(tournament) {
  if (!tournament?.endDate) return null;
  const [d, m, y] = tournament.endDate.split('/').map(Number);
  const endTs = new Date(y, m - 1, d).getTime();
  const cutoff = endTs + CLEANUP_DAYS_AFTER_END * 24 * 60 * 60 * 1000;
  return Math.ceil((cutoff - Date.now()) / (24 * 60 * 60 * 1000));
}

// Cleanup pass: remove receipts of tournaments past the cutoff
export function cleanupExpiredReceipts(profileId, tournaments) {
  const dirs = listProfileTournamentReceiptDirs(profileId);
  const tournamentMap = new Map((tournaments || []).map(t => [t.id, t]));
  const removed = [];
  for (const tid of dirs) {
    const t = tournamentMap.get(tid);
    if (!t || !t.endDate) continue;
    const remaining = daysUntilCleanup(t);
    if (remaining !== null && remaining < 0) {
      deleteTournamentReceipts(profileId, tid);
      removed.push(tid);
    }
  }
  return removed;
}

export { tournamentReceiptsDir };
