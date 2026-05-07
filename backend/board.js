// Board model — colunas do Kanban + lógica de auto-placement.
// Cada torneio tem um "card" representado pelas notes daquele torneio
// estendidas com: column, cardOrder, comments[], activity[].

import { deriveStatus } from './scraper.js';

// IDs das colunas se mantêm pra preservar compatibilidade com notes existentes.
// Ordem segue o ciclo de vida natural do card (esquerda → direita):
// descoberta → decisão → ação → execução → estados finais.
// Emojis alinhados ao significado de cada coluna.
export const COLUMNS = [
  { id: 'vou_jogar',           label: 'Monitorar',          icon: '🔭', auto: true,  manual: true },
  { id: 'inscricoes_abertas', label: 'Inscrições Abertas', icon: '🌟', auto: true,  manual: true },
  { id: 'pagar_inscricao',     label: 'Pagar inscrição',    icon: '💰', auto: true,  manual: true },
  { id: 'confirmado',          label: 'Confirmado',         icon: '🎾', auto: true,  manual: true },
  { id: 'viagem_comprada',     label: 'Viagem comprada',    icon: '✈️', auto: false, manual: true },
  { id: 'torneios',            label: 'Não vou jogar',      icon: '❌', auto: true,  manual: true },
  { id: 'historico',           label: 'Arquivados',         icon: '📦', auto: true,  manual: true },
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

// Helper: parse "DD/MM/YYYY" → Date (00:00) ou null
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
  const regOpens = parseBrDate(t.registrationOpensAt);
  const regDeadline = parseBrDate(t.registrationDeadline);

  // Datas vencem o texto: se temos a janela completa e ela está vigente,
  // é 'open' independente de TI dizer "Confirmado" ou outro texto vago.
  if (regOpens && regDeadline) {
    if (regDeadline < today) return 'closed';
    if (regOpens > today) return 'pending';
    return 'open';
  }
  // Só temos o fim do prazo
  if (regDeadline) {
    if (regDeadline < today) return 'closed';
    if (!isRegistrationClosed(s)) return 'open';
  }
  // Fallback cancelDeadline (sem registrationDeadline disponível)
  if (!regDeadline) {
    const cancel = parseBrDate(t.cancelDeadline);
    if (cancel && cancel < today) return 'closed';
  }
  // Só temos o início → pending se ainda não chegou
  if (regOpens && !regDeadline) {
    if (regOpens > today) return 'pending';
  }
  // Texto-only fallback
  if (isRegistrationClosed(s)) return 'closed';
  if (/a\s*iniciar/i.test(s)) return 'pending';
  if (/Aberto|aberta|inicia/i.test(s)) return 'open';
  return 'unknown';
}

// Compute the "natural" column based on tournament state alone (TI signals + notes).
// User can override via notes.column; this function does NOT consider override.
//
// Priority order (regra fechada com user em 07/05/2026):
//   1. status === 'past'                       → historico
//   2. manualGiveUp                             → torneios (Concluídos)
//   3. inscrita + boleto vencido                → torneios (Concluídos)
//   4. confirmada no TI (sit. financeira OK)    → confirmado
//   5. inscrita + boleto pendente               → pagar_inscricao
//   6. inscrita (sem boleto, mas não confirmada) → pagar_inscricao (esperando boleto)
//   7. não inscrita + janela 'open'             → inscricoes_abertas
//   8. não inscrita + janela 'closed'           → torneios (Concluídos)
//   9. não inscrita + janela 'pending/unknown'  → vou_jogar (Monitorar)
//
// Sinais (definidos pelo scraper):
// - isAnnaInscribed: ID da atleta na página /torneio_painel_inscritos
// - isAnnaConfirmada: status "Confirmado" na mesma página
// - pendingPayment: boleto na aba do perfil dela
export function computeAutoColumn(t, notes = {}) {
  const status = deriveStatus(t);
  if (status === 'past') return 'historico';

  if (notes.manualGiveUp) return 'torneios';

  const pp = t.pendingPayment;
  const inscribed = t.isAnnaInscribed || notes.manualInscribed;
  const confirmed = t.isAnnaConfirmada;

  // Boleto vencido com inscrição — perdeu o prazo
  if (inscribed && pp?.dueDate) {
    const [d, m, y] = pp.dueDate.split('/').map(Number);
    const due = new Date(y, m - 1, d);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (due < today) return 'torneios';
  }

  // Boleto pendente (não vencido) tem prioridade sobre "Confirmada" — o
  // TI às vezes marca isAnnaConfirmada=true mesmo sem pagamento (registro
  // administrativo). Pra o usuário a ação relevante é pagar o boleto.
  // Quando user pagar, próxima sync remove pp e card auto-promove pra confirmado.
  if (inscribed && pp) return 'pagar_inscricao';

  // Confirmada no TI E sem boleto pendente — tudo certo
  if (confirmed) return 'confirmado';

  // Inscrita sem boleto e sem confirmação — esperando TI emitir boleto
  if (inscribed) return 'pagar_inscricao';

  // Não inscrita: olha estado da janela
  const win = getRegistrationWindowState(t);
  if (win === 'open') return 'inscricoes_abertas';
  if (win === 'closed') return 'torneios';
  // pending / unknown → "Monitorar" (ação manual: aguardar e decidir)
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
// Cada event vai pro log do card (notes.activity) E é contado no
// summary do sync (eventCounts) pra aparecer no modal pós-sync.
export function diffTournamentForActivity(prev, curr) {
  const events = [];
  const now = new Date().toISOString();
  const evt = (type, message) => events.push({ id: newId(), type, message, createdAt: now, auto: true });

  const prevPP = prev?.pendingPayment;
  const currPP = curr?.pendingPayment;

  if (!prevPP && currPP) {
    const value = currPP.value || 's/valor';
    const due = currPP.dueDate || '?';
    evt('boleto_detected', `💰 Boleto detectado: ${value}, vence ${due}`);
  }
  if (prevPP && !currPP) evt('boleto_cleared', `✅ Pagamento confirmado pelo Tênis Integrado`);

  if (!prev?.isAnnaInscribed && curr?.isAnnaInscribed) {
    evt('inscribed', `✓ Inscrição detectada na página do torneio`);
  }
  if (prev?.isAnnaInscribed && !curr?.isAnnaInscribed) {
    evt('uninscribed', `Inscrição removida do Tênis Integrado`);
  }
  if (!prev?.isAnnaConfirmada && curr?.isAnnaConfirmada) {
    evt('confirmed', `✅ Inscrição confirmada (situação financeira OK)`);
  }
  if (prev?.isAnnaConfirmada && !curr?.isAnnaConfirmada) {
    evt('unconfirmed', `Inscrição perdeu confirmação no Tênis Integrado`);
  }

  if (!prev) evt('discovered', `🆕 Torneio descoberto na sincronização`);

  // Datas da janela de inscrição (registrationDeadline / registrationOpensAt /
  // cancelDeadline) — primeira detecção ou mudança.
  if (prev) {
    if (curr?.registrationDeadline && curr.registrationDeadline !== prev.registrationDeadline) {
      const verb = prev.registrationDeadline ? 'atualizado' : 'detectado';
      evt('reg_deadline_changed', `📅 Prazo de inscrição ${verb}: ${curr.registrationDeadline}`);
    }
    if (curr?.registrationOpensAt && curr.registrationOpensAt !== prev.registrationOpensAt) {
      const verb = prev.registrationOpensAt ? 'atualizada' : 'detectada';
      evt('reg_opens_changed', `📅 Abertura de inscrições ${verb}: ${curr.registrationOpensAt}`);
    }
    if (curr?.cancelDeadline && curr.cancelDeadline !== prev.cancelDeadline) {
      const verb = prev.cancelDeadline ? 'atualizado' : 'detectado';
      evt('cancel_deadline_changed', `📅 Prazo de cancelamento ${verb}: ${curr.cancelDeadline}`);
    }

    // Mudança no estado da janela (open ↔ closed ↔ pending ↔ unknown)
    const prevWin = getRegistrationWindowState(prev);
    const currWin = getRegistrationWindowState(curr);
    if (prevWin !== currWin) {
      const labels = { open: 'abertas', closed: 'encerradas', pending: 'a iniciar', unknown: 'status incerto' };
      evt('window_changed', `📌 Inscrições: ${labels[prevWin]} → ${labels[currWin]}`);
    }

    // Chaves (tiers) adicionadas — detecção de torneio multi-chave
    const prevTiers = new Set(prev.tiers || (prev.tier ? [prev.tier] : []));
    const currTiers = new Set(curr?.tiers || (curr?.tier ? [curr.tier] : []));
    const addedTiers = [...currTiers].filter(t => !prevTiers.has(t));
    if (addedTiers.length) {
      evt('tiers_added', `🏆 Chave${addedTiers.length > 1 ? 's' : ''} adicionada${addedTiers.length > 1 ? 's' : ''}: ${addedTiers.join(', ')}`);
    }

    // Status text do TI muda toda hora (Iniciado/Finalizado/etc) e
    // duplica info que o window_changed já cobre semanticamente. Não loga.
  }

  return events;
}
