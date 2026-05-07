// Board model — colunas do Kanban + lógica de auto-placement.
// Cada torneio tem um "card" representado pelas notes daquele torneio
// estendidas com: column, cardOrder, comments[], activity[].

import { deriveStatus } from './scraper.js';

// IDs dos colunas se mantêm pra preservar compatibilidade com notes existentes.
// Labels mudaram conforme spec (07/05/2026):
// - 'torneios' → "Concluídos" (inclui janela encerrada + boleto vencido + givenUp)
// - 'vou_jogar' → "Monitorar" (manual + auto pra A_INICIAR/UNKNOWN)
export const COLUMNS = [
  { id: 'torneios',            label: 'Concluídos',         icon: '🔒', auto: true,  manual: true },
  { id: 'inscricoes_abertas', label: 'Inscrições Abertas', icon: '🌟', auto: true,  manual: true },
  { id: 'vou_jogar',           label: 'Monitorar',          icon: '⭐', auto: true,  manual: true },
  { id: 'pagar_inscricao',     label: 'Pagar inscrição',    icon: '💰', auto: true,  manual: true },
  { id: 'confirmado',          label: 'Confirmado',         icon: '✅', auto: true,  manual: true },
  { id: 'viagem_comprada',     label: 'Viagem comprada',    icon: '✈️', auto: false, manual: true },
  { id: 'historico',           label: 'Encerrados',         icon: '🎾', auto: true,  manual: true },
];

export const COLUMN_IDS = COLUMNS.map(c => c.id);

// Estado de inscrição extraído do registrationStatus do TI.
// O TI usa textos variados: "Aberta até DD/MM", "Aberta", "Iniciado",
// "Encerrada em DD/MM", "Finalizado", etc. Centralizado aqui pra
// frontend e backend usarem a mesma regra.
export function isRegistrationClosed(status) {
  if (!status) return false;
  return /encerrad|finalizad/i.test(status);
}

// Convenience: "está aberta?" — wrapper sobre getRegistrationWindowState
export function isRegistrationOpen(t) {
  return getRegistrationWindowState(t) === 'open';
}

// Helper: parse "DD/MM/YYYY" → Date ou null
function parseBrDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
}

// Estado da janela de inscrição.
// 'closed' — passou o prazo ou status TI explícito (Encerrada/Finalizado)
// 'pending' — janela ainda vai abrir (status "A iniciar" / "Confirmado" + regOpensAt futuro)
// 'open' — janela aberta agora
// 'unknown' — sem informação suficiente
//
// Prioridade dos sinais:
// 1. registrationDeadline ≠ cancelDeadline. registrationDeadline é o
//    prazo real de fechamento de inscrições. cancelDeadline é prazo
//    de cancelamento de inscrição já feita (geralmente 1 dia depois).
//    Se registrationDeadline disponível, usa ele.
// 2. Texto explícito do TI ("Encerrada", "Aberta", etc)
// 3. registrationOpensAt no futuro → pending
export function getRegistrationWindowState(t) {
  if (!t) return 'unknown';
  const s = t.registrationStatus || '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Prioridade 1: prazo de inscrição (registrationDeadline) já passou
  const regDeadline = parseBrDate(t.registrationDeadline);
  if (regDeadline && regDeadline < today) return 'closed';
  // Prioridade 2: cancelDeadline já passou (fallback quando não temos
  // registrationDeadline). Geralmente 1 dia após o regDeadline real.
  if (!regDeadline) {
    const cancel = parseBrDate(t.cancelDeadline);
    if (cancel && cancel < today) return 'closed';
  }
  // Prioridade 3: texto explícito de fechamento
  if (isRegistrationClosed(s)) return 'closed';
  // Prioridade 4: registrationOpensAt no futuro → pending (ainda vai abrir)
  const regOpens = parseBrDate(t.registrationOpensAt);
  if (regOpens && regOpens > today) return 'pending';
  // Prioridade 5: "a iniciar" textual
  if (/a\s*iniciar/i.test(s)) return 'pending';
  // Prioridade 6: aberta explícita ou "Iniciado" (já passou pelos checks de prazo)
  if (/Aberto|aberta|inicia/i.test(s)) return 'open';
  // Resto: "Confirmado" sem datas confiáveis, vazio, etc → desconhecida
  return 'unknown';
}

// Compute the "natural" column based on tournament state alone (TI signals + notes).
// User can override via notes.column; this function does NOT consider override.
//
// Priority order (regra fechada com user em 07/05/2026):
//   1. status === 'past'                       → historico
//   2. manualGiveUp                             → torneios (Concluídos)
//   3. inscrita + boleto vencido                → torneios (Concluídos)
//   4. inscrita + boleto pendente               → pagar_inscricao
//   5. inscrita (heurística: confirmada)        → confirmado
//   6. não inscrita + janela 'open'             → inscricoes_abertas
//   7. não inscrita + janela 'closed'           → torneios (Concluídos)
//   8. não inscrita + janela 'pending/unknown'  → vou_jogar (Monitorar)
//
// Nota: ideal é scrapar `isAnnaConfirmada` da página do torneio pra
// distinguir "inscrita esperando boleto" de "confirmada". Por ora, mantém
// heurística "inscrita + sem boleto = confirmada".
export function computeAutoColumn(t, notes = {}) {
  const status = deriveStatus(t);
  if (status === 'past') return 'historico';

  if (notes.manualGiveUp) return 'torneios';

  const pp = t.pendingPayment;
  const inscribed = t.isAnnaInscribed || notes.manualInscribed;

  // Boleto vencido (com inscrição registrada) — perdeu o prazo
  if (inscribed && pp?.dueDate) {
    const [d, m, y] = pp.dueDate.split('/').map(Number);
    const due = new Date(y, m - 1, d);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (due < today) return 'torneios';
  }

  if (inscribed && pp) return 'pagar_inscricao';
  if (inscribed) return 'confirmado'; // heurística — sem boleto = pago/confirmada

  // Não inscrita: olha estado da janela
  const win = getRegistrationWindowState(t);
  if (win === 'open') return 'inscricoes_abertas';
  if (win === 'closed') return 'torneios';
  // pending / unknown → "Monitorar" (precisa ação manual: aguardar e decidir)
  return 'vou_jogar';
}

// Effective column: user override (if set and valid) else auto.
// Some auto columns force themselves (e.g., 'historico' wins always).
export function effectiveColumn(t, notes = {}) {
  const auto = computeAutoColumn(t, notes);
  if (auto === 'historico') return 'historico'; // past always wins

  const userColumn = notes.column;
  if (userColumn && COLUMN_IDS.includes(userColumn)) return userColumn;
  return auto;
}

// Generate a stable id for activity entries / comments
export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Create a fresh notes object preserving fields when promoting.
// Used when an action requires notes[tid] to exist but it's currently null.
export function ensureNotesShape(existing) {
  const n = existing && typeof existing === 'object' ? { ...existing } : {};
  if (!Array.isArray(n.comments)) n.comments = [];
  if (!Array.isArray(n.activity)) n.activity = [];
  return n;
}

// Diff between two synced tournament snapshots → returns activity entries.
// Used by sync-manager to log changes automatically.
export function diffTournamentForActivity(prev, curr) {
  const events = [];
  const prevPP = prev?.pendingPayment;
  const currPP = curr?.pendingPayment;

  // Boleto detected (new pendingPayment)
  if (!prevPP && currPP) {
    const value = currPP.value || 's/valor';
    const due = currPP.dueDate || '?';
    events.push({
      id: newId(),
      type: 'boleto_detected',
      message: `💰 Boleto detectado: ${value}, vence ${due}`,
      createdAt: new Date().toISOString(),
      auto: true,
    });
  }

  // Boleto cleared (was pendingPayment, now isn't)
  if (prevPP && !currPP) {
    events.push({
      id: newId(),
      type: 'boleto_cleared',
      message: `✅ Pagamento confirmado pelo Tênis Integrado`,
      createdAt: new Date().toISOString(),
      auto: true,
    });
  }

  // isAnnaInscribed transitions
  if (!prev?.isAnnaInscribed && curr?.isAnnaInscribed) {
    events.push({
      id: newId(),
      type: 'inscribed',
      message: `✓ Inscrição confirmada pelo Tênis Integrado`,
      createdAt: new Date().toISOString(),
      auto: true,
    });
  }
  if (prev?.isAnnaInscribed && !curr?.isAnnaInscribed) {
    events.push({
      id: newId(),
      type: 'uninscribed',
      message: `Inscrição removida do Tênis Integrado`,
      createdAt: new Date().toISOString(),
      auto: true,
    });
  }

  // First time appearing
  if (!prev) {
    events.push({
      id: newId(),
      type: 'discovered',
      message: `🆕 Torneio descoberto na sincronização`,
      createdAt: new Date().toISOString(),
      auto: true,
    });
  }

  return events;
}
