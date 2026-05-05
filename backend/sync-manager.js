import { syncAthlete } from './scraper.js';
import { getProfile, getProfileCredentials, getSyncedData, saveSyncedData, updateProfile } from './storage.js';

const inFlight = new Map(); // profileId -> Promise
const status = new Map();   // profileId -> { state, startedAt, finishedAt, error }

export function getSyncStatus(profileId) {
  return status.get(profileId) || { state: 'idle' };
}

// Sync only happens via explicit user action. No auto-trigger.
export async function syncProfile(profileId) {
  if (inFlight.has(profileId)) return inFlight.get(profileId);

  const creds = getProfileCredentials(profileId);
  if (!creds) throw new Error('Perfil não encontrado');

  status.set(profileId, { state: 'running', startedAt: new Date().toISOString() });

  const promise = (async () => {
    try {
      const result = await syncAthlete(creds);
      saveSyncedData(profileId, result);
      const p = getProfile(profileId);
      if (p && (!p.athleteName || p.athleteName === 'Atleta') && result.athlete?.name) {
        updateProfile(profileId, { athleteName: result.athlete.name });
      }
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
