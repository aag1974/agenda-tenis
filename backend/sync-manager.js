import { syncAthlete } from './scraper.js';
import {
  listProfiles, getProfile, getProfileCredentials, getSyncedData, saveSyncedData,
  updateProfile, getNotes, updateTournamentNotes,
} from './storage.js';

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
      const result = await syncAthlete({ ...creds, starredIds });
      // Preserve firstSeenAt per tournament across syncs (used by "🆕" badge for 7 days)
      const previous = getSyncedData(profileId);
      const firstSeenById = new Map(
        (previous?.tournaments || []).map(t => [t.id, t.firstSeenAt]).filter(([_, ts]) => ts)
      );
      const nowIso = new Date().toISOString();
      const FAR_PAST = '2020-01-01T00:00:00.000Z';

      // Migration detection — don't mark anything as "new" if:
      //   - First-ever sync (no previous data), OR
      //   - Previous data had no firstSeenAt at all, OR
      //   - >= 80% of previous firstSeenAt cluster within a 5-min window (= they were
      //     all set together, meaning a previous sync was the baseline)
      const times = [...firstSeenById.values()]
        .map(ts => new Date(ts).getTime())
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
      saveSyncedData(profileId, result);
      const p = getProfile(profileId);
      if (p && (!p.athleteName || p.athleteName === 'Atleta') && result.athlete?.name) {
        updateProfile(profileId, { athleteName: result.athlete.name });
      }
      autoStarInscribed(profileId, result.tournaments || []);
      status.set(profileId, {
        state: 'success',
        startedAt: status.get(profileId).startedAt,
        finishedAt: new Date().toISOString(),
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

export function startAutoSync() {
  // Defer the first tick by 5 minutes after boot so server has time to settle.
  setTimeout(() => {
    runAutoSyncTick();
    setInterval(runAutoSyncTick, SYNC_INTERVAL_MS);
  }, 5 * 60 * 1000);
  console.log(`[auto-sync] agendado a cada ${SYNC_INTERVAL_MS / 3600000}h (primeiro tick em 5 min)`);
}
