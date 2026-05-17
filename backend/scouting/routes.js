// Endpoints do /scouting — montados sob /api/scouting/* no server principal.

import express from 'express';
import {
  tryLogin, makeCookie, scoutingAuthMiddleware, requireScoutingAuth,
} from './auth.js';
import {
  getRoster, saveRoster, createInvite, getInvite, listInvites,
  markInviteCompleted, deleteInvite, SCOUTING_PROFILE_ID,
} from './storage.js';
import {
  saveLiveMatch, newMatchId, createLiveMatchTokens, getLiveMatchTokens,
} from '../storage.js';
import { createMatch as createMatchState } from '../tennis-score.js';
import { attachScore } from '../match-score.js';
import { getLiveMatch, listLiveMatches } from '../storage.js';

export const scoutingRouter = express.Router();
scoutingRouter.use(express.json({ limit: '2mb' }));
scoutingRouter.use(scoutingAuthMiddleware);

// ===== Auth =====
scoutingRouter.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = tryLogin(email, password);
  if (!user) return res.status(401).json({ error: 'Email ou senha inválidos' });
  const cookie = makeCookie(user);
  const isHttps = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `scoutsess=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`);
  res.json({ email: user.email });
});

scoutingRouter.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'scoutsess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

scoutingRouter.get('/me', (req, res) => {
  if (!req.scoutingUser) return res.status(401).json({ error: 'Não autenticado' });
  res.json({ email: req.scoutingUser.email });
});

// ===== Roster (lista de atletas) =====
scoutingRouter.get('/roster', requireScoutingAuth, (req, res) => {
  res.json(getRoster());
});

scoutingRouter.post('/roster', requireScoutingAuth, (req, res) => {
  const { atletas, source } = req.body || {};
  if (!Array.isArray(atletas) || !atletas.length) {
    return res.status(400).json({ error: 'atletas (array) obrigatório' });
  }
  const saved = saveRoster({ atletas, source });
  res.json(saved);
});

// ===== Invites — coach gera links =====
scoutingRouter.post('/invites', requireScoutingAuth, (req, res) => {
  const { atletaId, atletaNome, atletaCategoria,
          opponentId, opponentNome, opponentCategoria } = req.body || {};
  if (!atletaNome || !atletaNome.trim()) {
    return res.status(400).json({ error: 'atletaNome obrigatório' });
  }
  const invite = createInvite({
    atletaId,
    atletaNome: atletaNome.trim(),
    atletaCategoria,
    opponentId,
    opponentNome: opponentNome ? opponentNome.trim() : null,
    opponentCategoria,
    createdBy: req.scoutingUser.email,
  });
  res.status(201).json(invite);
});

scoutingRouter.get('/invites', requireScoutingAuth, (req, res) => {
  // Enriquece com placar quando o invite já tem match associado.
  // Também resolve viewerToken pra invites antigos que só tinham scoutToken.
  const all = listInvites();
  const enriched = all.map(inv => {
    if (!inv.matchId) return inv;
    const m = getLiveMatch(SCOUTING_PROFILE_ID, inv.matchId);
    if (!m) return inv;
    let viewerToken = inv.viewerToken || null;
    if (!viewerToken) {
      // Invite antigo (pré-fix): busca o viewerToken no map global de tokens.
      const t = getLiveMatchTokens(SCOUTING_PROFILE_ID, inv.matchId);
      viewerToken = t?.viewerToken || null;
    }
    const scored = attachScore(m);
    return {
      ...inv,
      viewerToken,
      match: {
        id: scored.id,
        opponentName: scored.opponentName,
        finished: scored.finished,
        winner: scored.winner,
        abandoned: scored.abandoned,
        abandonedBy: scored.abandonedBy,
        startedAt: scored.startedAt,
        setsHistory: scored.setsHistory,
        // Dashboard do coach renderiza mini-placar com set/game atual.
        currentSet: scored.currentSet,
        currentGame: scored.currentGame,
        // pointsCount (não a lista inteira) pra alimentar o polling sem
        // inflar payload.
        pointsCount: scored.points?.length ?? 0,
      },
    };
  });
  res.json(enriched);
});

scoutingRouter.delete('/invites/:token', requireScoutingAuth, (req, res) => {
  const ok = deleteInvite(req.params.token);
  if (!ok) return res.status(404).json({ error: 'Invite não encontrado' });
  res.status(204).end();
});

// ===== Scouter — endpoints públicos (via inviteToken, sem auth) =====
scoutingRouter.get('/start/:token', (req, res) => {
  const invite = getInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Link inválido' });
  if (invite.matchId && invite.matchToken) {
    // Invite já consumido — redireciona pro match
    return res.json({
      invite,
      alreadyStarted: true,
      scoutUrl: `/scout/${invite.matchToken}`,
    });
  }
  const roster = getRoster();
  // Lista de adversários possíveis (exclui o próprio atleta)
  const others = roster.atletas.filter(a => a.id !== invite.atletaId);
  res.json({
    invite: {
      atletaId: invite.atletaId,
      atletaNome: invite.atletaNome,
      atletaCategoria: invite.atletaCategoria,
      opponentId: invite.opponentId,
      opponentNome: invite.opponentNome,
      opponentCategoria: invite.opponentCategoria,
    },
    roster: others,
  });
});

scoutingRouter.post('/start/:token/begin', (req, res) => {
  const invite = getInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Link inválido' });
  if (invite.matchId) {
    return res.status(409).json({ error: 'Esse link já iniciou um scout. Use o link do match.', matchToken: invite.matchToken });
  }
  const { opponentName, opponentId, config = {} } = req.body || {};
  if (!opponentName || !opponentName.trim()) {
    return res.status(400).json({ error: 'opponentName obrigatório' });
  }
  // Cria o match reusando o storage do TF (profileId fixo 'scouting').
  const matchId = newMatchId();
  const state = createMatchState({
    format: config.format || 'best_of_3',
    ad: config.ad !== false,
    firstServer: config.firstServer === 'o' ? 'o' : 'a',
  });
  const match = {
    id: matchId,
    profileId: SCOUTING_PROFILE_ID,
    athleteName: invite.atletaNome,
    opponentName: opponentName.trim(),
    opponentId: opponentId || null,
    atletaId: invite.atletaId || null,
    tournamentName: invite.atletaCategoria ? `Itajaí · ${invite.atletaCategoria}` : 'Itajaí',
    source: 'scouting',
    createdBy: 'scouter',
    notes: [],
    ...state,
  };
  saveLiveMatch(SCOUTING_PROFILE_ID, match);
  const tokens = createLiveMatchTokens(SCOUTING_PROFILE_ID, matchId);
  markInviteCompleted(req.params.token, {
    matchId,
    matchToken: tokens.scoutToken,    // scouter usa pra marcar
    viewerToken: tokens.viewerToken,  // coach acompanha em modo leitura
  });
  res.status(201).json({
    matchId,
    scoutToken: tokens.scoutToken,
    viewerToken: tokens.viewerToken,
    scoutUrl: `/scout/${tokens.scoutToken}`,
  });
});

// ===== Dashboard — lista matches do scouting (pro coach ver) =====
scoutingRouter.get('/matches', requireScoutingAuth, (req, res) => {
  const matches = listLiveMatches(SCOUTING_PROFILE_ID).map(attachScore);
  res.json(matches);
});
