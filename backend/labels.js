// Etiquetas (labels) — auto (do TI) + manuais (criadas pelo usuário).
// Armazenamento: data/profile-{id}/labels.json (apenas etiquetas manuais).
// Auto labels são derivadas em runtime com base no estado do torneio.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { isRegistrationOpen } from './board.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// Paleta fixa — usuário escolhe entre essas cores ao criar/editar etiqueta
export const LABEL_COLORS = [
  'emerald', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo',
  'violet', 'purple', 'pink', 'rose', 'red', 'orange', 'amber', 'yellow',
  'slate', 'gray',
];

// Etiquetas manuais padrão — criadas no primeiro acesso (ou migração)
export const DEFAULT_MANUAL_LABELS = [
  { name: 'Prioridade alta',  color: 'emerald' },
  { name: 'Decidir',          color: 'orange' },
  { name: 'Não vou',          color: 'rose' },
  { name: 'Categoria forte',  color: 'violet' },
  { name: 'Boa chance',       color: 'lime' },
  { name: 'Perto de casa',    color: 'cyan' },
  { name: 'Viagem longa',     color: 'slate' },
];

// Auto labels — não armazenadas, derivadas por torneio. Cada uma tem um
// autoKey estável que serve de "id" para fins de display/filtros.
const AUTO_LABEL_DEFS = {
  inscribed:           { name: 'Inscrito',              color: 'emerald' },
  pendingPayment:      { name: 'Boleto pendente',        color: 'amber' },
  expiredPayment:      { name: 'Boleto vencido',         color: 'red' },
  closedRegistration:  { name: 'Inscrições encerradas',  color: 'slate' },
  newlyAdded:          { name: 'Novo',                   color: 'cyan' },
};

// Tier auto labels — cores específicas por tier (esquema A: frio→quente
// = mais prestígio → menos prestígio). Renderizadas com fundo sólido +
// texto branco pra diferenciar das etiquetas pastel.
const TIER_COLORS = {
  'GA+': 'violet',
  'GA':  'indigo',
  'G1+': 'blue',
  'G1':  'cyan',
  'G2':  'emerald',
  'G3':  'amber',
};

function profileLabelsFile(profileId) {
  return join(DATA_DIR, `profile-${profileId}`, 'labels.json');
}

function readManualLabels(profileId) {
  const file = profileLabelsFile(profileId);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return []; }
}

function writeManualLabels(profileId, list) {
  const file = profileLabelsFile(profileId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(list, null, 2));
}

function newId() {
  return randomBytes(8).toString('hex');
}

// Garante que a lista do perfil tenha as etiquetas padrão (apenas se a lista
// estiver vazia — não sobrescreve nem duplica em re-execução).
export function ensureDefaultLabels(profileId) {
  const cur = readManualLabels(profileId);
  if (cur.length > 0) return cur;
  const seeded = DEFAULT_MANUAL_LABELS.map(l => ({
    id: newId(),
    name: l.name,
    color: l.color,
    createdAt: new Date().toISOString(),
  }));
  writeManualLabels(profileId, seeded);
  return seeded;
}

export function listManualLabels(profileId) {
  return readManualLabels(profileId);
}

export function createManualLabel(profileId, { name, color }) {
  if (!name?.trim()) throw new Error('Nome obrigatório');
  if (!LABEL_COLORS.includes(color)) throw new Error('Cor inválida');
  const list = readManualLabels(profileId);
  const entry = {
    id: newId(),
    name: name.trim().slice(0, 50),
    color,
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  writeManualLabels(profileId, list);
  return entry;
}

export function updateManualLabel(profileId, id, patch) {
  const list = readManualLabels(profileId);
  const entry = list.find(l => l.id === id);
  if (!entry) return null;
  if (patch.name !== undefined) {
    if (!patch.name?.trim()) throw new Error('Nome obrigatório');
    entry.name = patch.name.trim().slice(0, 50);
  }
  if (patch.color !== undefined) {
    if (!LABEL_COLORS.includes(patch.color)) throw new Error('Cor inválida');
    entry.color = patch.color;
  }
  entry.updatedAt = new Date().toISOString();
  writeManualLabels(profileId, list);
  return entry;
}

export function deleteManualLabel(profileId, id) {
  const list = readManualLabels(profileId);
  const before = list.length;
  const filtered = list.filter(l => l.id !== id);
  if (filtered.length === before) return false;
  writeManualLabels(profileId, filtered);
  return true;
}

// Deriva os autoKeys aplicáveis para um torneio com base em estado + notas.
// Retorna lista no formato { autoKey, name, color, auto: true }.
export function deriveAutoLabels(tournament, notes = {}) {
  const out = [];
  const givenUp = !!notes.manualGiveUp;
  const pp = givenUp ? null : tournament.pendingPayment;
  const inscribed = givenUp ? false : (tournament.isAnnaInscribed || notes.manualInscribed);
  const status = tournament.derivedStatus;

  // Boleto vencido > pendente > inscrito (mutualmente exclusivos no display principal)
  let boletoExpired = false;
  if (pp?.dueDate) {
    const [d, m, y] = pp.dueDate.split('/').map(Number);
    const due = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due < today) boletoExpired = true;
  }

  if (boletoExpired) {
    out.push({ autoKey: 'expiredPayment', ...AUTO_LABEL_DEFS.expiredPayment, auto: true });
  } else if (pp) {
    out.push({ autoKey: 'pendingPayment', ...AUTO_LABEL_DEFS.pendingPayment, auto: true });
  } else if (inscribed) {
    out.push({ autoKey: 'inscribed', ...AUTO_LABEL_DEFS.inscribed, auto: true });
  } else if (status !== 'past' && !isRegistrationOpen(tournament.registrationStatus)) {
    // Inscrições encerradas: tudo que não está aberto, não tem boleto e não foi inscrito
    // (mesma regra usada pra montar a coluna "Inscrições Encerradas")
    out.push({ autoKey: 'closedRegistration', ...AUTO_LABEL_DEFS.closedRegistration, auto: true });
  }

  // Novo (últimos 7 dias) — só se não for passado
  if (status !== 'past' && tournament.firstSeenAt) {
    const ms = Date.now() - new Date(tournament.firstSeenAt).getTime();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    if (ms >= 0 && ms < SEVEN_DAYS) {
      out.push({ autoKey: 'newlyAdded', ...AUTO_LABEL_DEFS.newlyAdded, auto: true });
    }
  }

  // Tiers — uma label por tier
  const tiers = (tournament.tiers && tournament.tiers.length)
    ? tournament.tiers
    : (tournament.tier ? [tournament.tier] : []);
  for (const tier of tiers) {
    out.push({
      autoKey: `tier:${tier}`,
      name: tier,
      color: TIER_COLORS[tier] || 'slate',
      auto: true,
      tier: true, // sinaliza pro frontend renderizar como "selo" sólido
    });
  }

  return out;
}

// Resolve etiquetas manuais aplicadas a um torneio (notes.labelIds → objetos completos).
// Filtra IDs órfãos (label deletada).
export function resolveManualLabels(profileId, labelIds = []) {
  if (!labelIds.length) return [];
  const all = readManualLabels(profileId);
  const byId = new Map(all.map(l => [l.id, l]));
  return labelIds.map(id => byId.get(id)).filter(Boolean).map(l => ({ ...l, auto: false }));
}

export { AUTO_LABEL_DEFS };
