// Board model — colunas do Kanban + lógica de auto-placement.
// Cada torneio tem um "card" representado pelas notes daquele torneio
// estendidas com: column, cardOrder, comments[], activity[].

import { deriveStatus } from './scraper.js';

export const COLUMNS = [
  { id: 'torneios',            label: 'Inscrições Encerradas', icon: '🔒', auto: true,  manual: true },
  { id: 'inscricoes_abertas', label: 'Inscrições Abertas',   icon: '🌟', auto: true,  manual: true },
  { id: 'vou_jogar',           label: 'No radar',            icon: '⭐', auto: false, manual: true },
  { id: 'pagar_inscricao',     label: 'Pagar inscrição',     icon: '💰', auto: true,  manual: true },
  { id: 'confirmado',          label: 'Confirmado',          icon: '✅', auto: true,  manual: true },
  { id: 'viagem_comprada',     label: 'Viagem comprada',     icon: '✈️', auto: false, manual: true },
  { id: 'historico',           label: 'Encerrados',          icon: '🎾', auto: true,  manual: true },
];

export const COLUMN_IDS = COLUMNS.map(c => c.id);

// Estado de inscrição extraído do registrationStatus do TI.
// O TI usa textos variados: "Aberta até DD/MM", "Aberta", "Iniciado",
// "Encerrada em DD/MM", "Finalizado", etc. Centralizado aqui pra
// frontend e backend usarem a mesma regra.
export function isRegistrationOpen(status) {
  if (!status) return false;
  return /Aberto|aberta|inicia/i.test(status);
}
export function isRegistrationClosed(status) {
  if (!status) return false;
  return /encerrad|finalizad/i.test(status);
}

// Compute the "natural" column based on tournament state alone (TI signals + notes).
// User can override via notes.column; this function does NOT consider override.
export function computeAutoColumn(t, notes = {}) {
  const givenUp = !!notes.manualGiveUp;
  const pp = givenUp ? null : t.pendingPayment;
  const inscribed = givenUp ? false : (t.isAnnaInscribed || notes.manualInscribed);
  const status = deriveStatus(t);

  // Past tournaments always go to history
  if (status === 'past') return 'historico';

  // Active payment due → pay
  if (pp) return 'pagar_inscricao';

  // Confirmed (inscribed and paid, future or ongoing)
  if (inscribed) return 'confirmado';

  // Registration open in TI (no Anna registered yet)
  if (isRegistrationOpen(t.registrationStatus)) return 'inscricoes_abertas';

  // Otherwise: pool of tournaments
  return 'torneios';
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
