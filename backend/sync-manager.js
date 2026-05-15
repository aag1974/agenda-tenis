import { syncAthlete } from './scraper.js';
import {
  listProfiles, getProfile, getProfileCredentials, getSyncedData, saveSyncedData,
  updateProfile, getNotes, updateTournamentNotes, addAutoActivity,
  getAlertRules, addAlertEvents, getAlertEvents,
  getMatchesData, upsertYearMatches,
} from './storage.js';
import { cleanupExpiredReceipts } from './receipts.js';
import { diffTournamentForActivity } from './board.js';
import { evaluateRules } from './alerts.js';
import { sendPushToUsers } from './push.js';
import { listHouseholdMembers } from './household.js';

const inFlight = new Map(); // profileId -> Promise
const status = new Map();   // profileId -> { state, startedAt, finishedAt, error }

export function getSyncStatus(profileId) {
  return status.get(profileId) || { state: 'idle' };
}

export async function syncProfile(profileId) {
  if (inFlight.has(profileId)) return inFlight.get(profileId);

  const creds = getProfileCredentials(profileId);
  if (!creds) throw new Error('Perfil não encontrado');

  status.set(profileId, { state: 'running', startedAt: new Date().toISOString() });

  const promise = (async () => {
    try {
      const notes = getNotes(profileId);
      const starredIds = Object.entries(notes)
        .filter(([, n]) => n?.selected || n?.manualInscribed)
        .map(([id]) => id);

      // Decide quais anos de matches scrappear:
      // - Sempre o ano atual (jogos novos podem aparecer)
      // - Os 2 anos anteriores se nunca foram scrapeados (backfill one-time)
      const currentYear = new Date().getFullYear();
      const matchesData = getMatchesData(profileId);
      const lastScraped = matchesData.lastScraped || {};
      const yearsToScrape = [currentYear];
      for (let y = currentYear - 1; y >= currentYear - 2; y--) {
        if (!lastScraped[y]) yearsToScrape.push(y);
      }

      // Lê previous AGORA (antes do sync) pra passar pro scraper —
      // permite skip de inscritos check em torneios passados já confirmados.
      const previous = getSyncedData(profileId);
      const result = await syncAthlete({
        ...creds,
        starredIds,
        yearsToScrape,
        previousTournaments: previous?.tournaments || null,
      });
      // Preserve firstSeenAt per tournament across syncs (used by "🆕" badge for 7 days)
      const firstSeenById = new Map(
        (previous?.tournaments || []).map(t => [t.id, t.firstSeenAt]).filter(([_, ts]) => ts)
      );
      const nowIso = new Date().toISOString();
      const FAR_PAST = '2020-01-01T00:00:00.000Z';

      // Migration detection — don't mark anything as "new" if:
      //   - First-ever sync (no previous data), OR
      //   - Previous data had no firstSeenAt at all, OR
      //   - >= 80% de firstSeenAt REAIS clusterizam em 5 min (sugere que foram
      //     todos setados juntos, ou seja, sync anterior foi a baseline)
      // FAR_PAST é o sentinel "já baselinado" — não conta como cluster real,
      // senão toda sync subsequente parece baseline (bug).
      const FAR_PAST_MS = new Date(FAR_PAST).getTime();
      const times = [...firstSeenById.values()]
        .map(ts => new Date(ts).getTime())
        .filter(ts => ts !== FAR_PAST_MS)
        .sort((a, b) => a - b);
      const WINDOW_MS = 5 * 60 * 1000;
      let maxCluster = 0;
      for (let i = 0; i < times.length; i++) {
        let j = i;
        while (j < times.length && times[j] - times[i] <= WINDOW_MS) j++;
        if (j - i > maxCluster) maxCluster = j - i;
      }
      const isBaselineEstablishment =
        !previous?.tournaments?.length ||
        firstSeenById.size === 0 ||
        (times.length > 0 && maxCluster / times.length >= 0.8);

      result.tournaments = (result.tournaments || []).map(t => {
        const known = firstSeenById.get(t.id);
        if (known) {
          // Override clustered firstSeenAt during baseline establishment
          if (isBaselineEstablishment) return { ...t, firstSeenAt: FAR_PAST };
          return { ...t, firstSeenAt: known };
        }
        // Tournament not seen before
        return { ...t, firstSeenAt: isBaselineEstablishment ? FAR_PAST : nowIso };
      });

      // Diff against previous to log auto-activity per card AND build a sync summary
      // for the UI ("X novos, Y atualizações"). Baseline establishment is the first
      // real sync — we still report counts but flag it so the UI can frame appropriately.
      const summary = {
        baseline: isBaselineEstablishment,
        totalTournaments: result.tournaments.length,
        newTournaments: [],         // [{ id, name, startDate, state, tier }]
        updatedTournaments: [],     // [{ id, name, events: [{ type, message }] }]
        eventCounts: {},            // { boleto_detected: 2, inscribed: 1, ... }
      };
      if (previous?.tournaments) {
        const prevById = new Map(previous.tournaments.map(t => [t.id, t]));
        for (const t of result.tournaments) {
          const events = diffTournamentForActivity(prevById.get(t.id), t);
          if (!events.length) continue;
          if (!isBaselineEstablishment) addAutoActivity(profileId, t.id, events);
          for (const ev of events) {
            summary.eventCounts[ev.type] = (summary.eventCounts[ev.type] || 0) + 1;
          }
          if (!prevById.has(t.id)) {
            summary.newTournaments.push({
              id: t.id, name: t.name, startDate: t.startDate || null,
              state: t.state || null, tier: t.tier || null,
            });
          } else {
            summary.updatedTournaments.push({
              id: t.id, name: t.name,
              events: events.map(e => ({ type: e.type, message: e.message })),
            });
          }
        }
      }

      // Avalia regras de alerta — só dispara depois que o baseline já foi
      // estabelecido (senão a primeira sincronização gera dezenas de alertas).
      let triggeredAlerts = [];
      if (!isBaselineEstablishment) {
        try {
          const rules = getAlertRules(profileId);
          const events = evaluateRules({
            rules,
            prevTournaments: previous?.tournaments,
            currTournaments: result.tournaments,
            prevAthlete: previous?.athlete,
            currAthlete: result.athlete,
          });
          triggeredAlerts = addAlertEvents(profileId, events);
        } catch (err) {
          console.error(`[alerts ${profileId}]`, err.message);
        }
      }
      summary.newAlerts = triggeredAlerts.length;

      // Push notifications — manda pra todos os membros do household.
      // Falha silenciosa: erro no push não derruba o sync.
      if (triggeredAlerts.length > 0) {
        try {
          const profile = getProfile(profileId);
          const householdId = profile?.householdId || profile?.userId;
          const members = householdId ? listHouseholdMembers(householdId) : [];
          const userIds = members.map(m => m.id);
          const unseenCount = getAlertEvents(profileId).filter(e => !e.seen).length;
          // Resumo curto pro título; primeiro alerta vira o body.
          const first = triggeredAlerts[0];
          const more = triggeredAlerts.length - 1;
          const title = triggeredAlerts.length === 1
            ? '🎾 Tennis Flow'
            : `🎾 ${triggeredAlerts.length} novos alertas`;
          const body = more > 0
            ? `${first.message} (+${more} outro${more > 1 ? 's' : ''})`
            : first.message;
          await sendPushToUsers(userIds, {
            title,
            body,
            badge: unseenCount,
            tag: 'alerts',
            url: '/?openAlerts=1',
          });
        } catch (err) {
          console.error(`[push ${profileId}]`, err.message);
        }
      }

      saveSyncedData(profileId, result);

      // Persist matches por ano (idempotente — re-scrape do mesmo ano substitui)
      if (result.matchesByYear) {
        let totalNew = 0;
        for (const [yearStr, matches] of Object.entries(result.matchesByYear)) {
          const year = parseInt(yearStr, 10);
          upsertYearMatches(profileId, year, matches);
          totalNew += matches.length;
        }
        console.log(`[sync ${profileId}] ${totalNew} matches em ${Object.keys(result.matchesByYear).length} ano(s)`);
      }

      const p = getProfile(profileId);
      if (p && (!p.athleteName || p.athleteName === 'Atleta') && result.athlete?.name) {
        updateProfile(profileId, { athleteName: result.athlete.name });
      }
      autoStarInscribed(profileId, result.tournaments || []);
      status.set(profileId, {
        state: 'success',
        startedAt: status.get(profileId).startedAt,
        finishedAt: new Date().toISOString(),
        summary,
      });
      return result;
    } catch (err) {
      status.set(profileId, {
        state: 'error',
        error: err.message,
        startedAt: status.get(profileId).startedAt,
        finishedAt: new Date().toISOString(),
      });
      throw err;
    } finally {
      inFlight.delete(profileId);
    }
  })();

  inFlight.set(profileId, promise);
  return promise;
}

// Auto-star tournaments based on TI signals.
// Rules:
//   - If user marked manualGiveUp → never re-star (respect the give-up)
//   - If pendingPayment exists → always star (financial reminder is non-optional)
//   - Else if isAnnaInscribed and user hasn't decided yet → star
//   - Else: leave whatever the user chose
function autoStarInscribed(profileId, tournaments) {
  const notes = getNotes(profileId);
  for (const t of tournaments) {
    const existing = notes[t.id] || {};
    if (existing.manualGiveUp) continue;
    if (t.pendingPayment) {
      if (existing.selected !== true) {
        updateTournamentNotes(profileId, t.id, { selected: true, autoStarred: true });
      }
      continue;
    }
    if (!t.isAnnaInscribed) continue;
    if ('selected' in existing) continue; // user already decided
    updateTournamentNotes(profileId, t.id, { selected: true, autoStarred: true });
  }
}

// ===== Auto-sync scheduler =====
// Runs every 6 hours for every profile that has any starred tournament
// in the upcoming 90 days (or any starred at all if no startDate).
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEVANT_DAYS_AHEAD = 90;

function profileNeedsAutoSync(profileId) {
  const synced = getSyncedData(profileId);
  if (!synced?.tournaments?.length) return true; // never synced — try at least once
  const notes = getNotes(profileId);
  const now = Date.now();
  const horizon = now + RELEVANT_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  for (const t of synced.tournaments) {
    if (!notes[t.id]?.selected) continue;
    if (!t.startDate) return true;
    const [d, m, y] = t.startDate.split('/').map(Number);
    const ts = new Date(y, m - 1, d).getTime();
    if (ts >= now - 86400000 && ts <= horizon) return true;
  }
  return false;
}

async function runAutoSyncTick() {
  const profiles = listProfiles();
  for (const p of profiles) {
    if (!profileNeedsAutoSync(p.id)) continue;
    try {
      await syncProfile(p.id);
      console.log(`[auto-sync] ok: ${p.athleteName || p.id}`);
    } catch (err) {
      console.error(`[auto-sync] erro ${p.athleteName || p.id}: ${err.message}`);
    }
  }
}

// Receipts cleanup — runs once a day, deletes receipts of tournaments
// whose endDate + CLEANUP_DAYS_AFTER_END is past.
function runReceiptsCleanupTick() {
  const profiles = listProfiles();
  for (const p of profiles) {
    const synced = getSyncedData(p.id);
    const tournaments = synced?.tournaments || [];
    try {
      const removed = cleanupExpiredReceipts(p.id, tournaments);
      if (removed.length > 0) {
        console.log(`[receipts-cleanup] ${p.athleteName || p.id}: ${removed.length} torneios arquivados`);
      }
    } catch (err) {
      console.error(`[receipts-cleanup] erro ${p.id}:`, err.message);
    }
  }
}

export function startAutoSync() {
  // Defer the first tick by 5 minutes after boot so server has time to settle.
  setTimeout(() => {
    runAutoSyncTick();
    setInterval(runAutoSyncTick, SYNC_INTERVAL_MS);
  }, 5 * 60 * 1000);
  // Receipts cleanup runs once a day, first run 10 min after boot.
  setTimeout(() => {
    runReceiptsCleanupTick();
    setInterval(runReceiptsCleanupTick, 24 * 60 * 60 * 1000);
  }, 10 * 60 * 1000);
  console.log(`[auto-sync] agendado a cada ${SYNC_INTERVAL_MS / 3600000}h (primeiro tick em 5 min)`);
  console.log(`[receipts-cleanup] agendado a cada 24h (primeiro tick em 10 min)`);
}
