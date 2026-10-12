// MARS MIND API (Netlify Function). Sign in with X (OAuth 2.0 + PKCE) and every MARS reward,
// stored in Supabase. Routes:
//   GET  /api/config              public game settings (X handle, quest post)
//   GET  /api/auth/login          → redirect to X
//   GET  /api/auth/callback       ← X redirects back here
//   POST /api/auth/logout
//   GET  /api/me                  player, quests, balance, ledger, achievements, stats
//   POST /api/quest               { quest, action: "open" | "claim" }
//   POST /api/earn                { event, key }
//   POST /api/achievement         { id }
//   POST /api/stats               { bestSol, bestScore, bestStage, colonists }

import {
  HttpError, SESSION_COOKIE, cookie, env, envNum, json, randomToken, readCookies, readJson, redirect,
  requireSameOrigin, requireSession, rpc, sha256b64url, sign, siteOrigin, verify,
} from '../lib/server';
import { ACH_REWARD, EARN_RULES, QUEST_IDS, QUEST_LABEL, type EarnEvent, type QuestId } from '../../src/account/rewards';

const X_AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const X_TOKEN = 'https://api.x.com/2/oauth2/token';
const X_ME = 'https://api.x.com/2/users/me?user.fields=profile_image_url,name,username';
const OAUTH_COOKIE = 'mm_oauth';
const SESSION_DAYS = 30;

declare const process: { env: Record<string, string | undefined> };
const gameConfig = () => ({
  login: 'x',
  xHandle: (process.env.X_HANDLE || 'MarsMindGame').replace(/^@/, ''),
  postUrl: process.env.POST_URL || '',
  questDelaySec: envNum('QUEST_DELAY_SEC', 5),
  questReward: envNum('QUEST_REWARD', 1000),
});

const safeReturn = (r: string | null) => (r && r.startsWith('/') && !r.startsWith('//') ? r.slice(0, 200) : '/');
const withParam = (path: string, kv: string) => `${path}${path.includes('?') ? '&' : '?'}${kv}`;

// ---------------------------------------------------------------- auth
async function login(req: Request) {
  const url = new URL(req.url);
  const verifier = randomToken(48);
  const state = randomToken(24);
  const ref = (url.searchParams.get('ref') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
  const oauth = await sign({ s: state, v: verifier, r: ref, ret: safeReturn(url.searchParams.get('return')) }, 600);
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: env('X_CLIENT_ID'),
    redirect_uri: `${siteOrigin(req)}/api/auth/callback`,
    scope: 'users.read tweet.read',
    state,
    code_challenge: await sha256b64url(verifier),
    code_challenge_method: 'S256',
  });
  return redirect(`${X_AUTHORIZE}?${q}`, [cookie(OAUTH_COOKIE, oauth, 600, '/api/auth')]);
}

async function callback(req: Request) {
  const url = new URL(req.url);
  const clear = cookie(OAUTH_COOKIE, '', 0, '/api/auth');
  const fail = (reason: string) => redirect(`/?auth=error&reason=${encodeURIComponent(reason)}`, [clear]);
  const oauth = await verify<{ s: string; v: string; r: string; ret: string }>(readCookies(req)[OAUTH_COOKIE]);
  if (url.searchParams.get('error')) return fail(url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'x_error');
  if (!oauth || oauth.s !== url.searchParams.get('state')) return fail('expired');
  const code = url.searchParams.get('code');
  if (!code) return fail('no_code');

  // exchange the code for a short-lived access token (used once, never stored)
  const clientId = env('X_CLIENT_ID');
  const secret = process.env.X_CLIENT_SECRET;
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (secret) headers.authorization = `Basic ${btoa(`${clientId}:${secret}`)}`;
  const tokenRes = await fetch(X_TOKEN, {
    method: 'POST', headers,
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${siteOrigin(req)}/api/auth/callback`, code_verifier: oauth.v, client_id: clientId }),
  });
  if (!tokenRes.ok) { console.error('X token exchange failed', tokenRes.status, (await tokenRes.text()).slice(0, 300)); return fail('token'); }
  const token = await tokenRes.json() as { access_token?: string };
  if (!token.access_token) return fail('token');

  const meRes = await fetch(X_ME, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!meRes.ok) { console.error('X users/me failed', meRes.status, (await meRes.text()).slice(0, 300)); return fail('profile'); }
  const me = (await meRes.json() as { data?: { id: string; username: string; name?: string; profile_image_url?: string } }).data;
  if (!me?.id) return fail('profile');

  let player: { id: string; handle: string };
  try {
    player = await rpc<{ id: string; handle: string }>('mm_upsert_player', {
      p_x_id: me.id, p_handle: me.username, p_name: me.name ?? null,
      p_avatar: me.profile_image_url ? me.profile_image_url.replace('_normal.', '_200x200.') : null, p_ref: oauth.r || null,
    });
  } catch { return fail('database'); }
  const sess = await sign({ pid: player.id, xid: me.id, h: me.username }, SESSION_DAYS * 86400);
  return redirect(withParam(oauth.ret, 'auth=ok'), [clear, cookie(SESSION_COOKIE, sess, SESSION_DAYS * 86400)]);
}

// ---------------------------------------------------------------- player
async function me(req: Request) {
  const s = await requireSession(req);
  const summary = await rpc<Record<string, unknown> | null>('mm_summary', { p_player: s.pid });
  if (!summary) throw new HttpError(401, 'signed_out');
  return json({ ...summary, config: gameConfig() });
}

async function quest(req: Request) {
  requireSameOrigin(req);
  const s = await requireSession(req);
  const b = await readJson(req);
  const id = String(b.quest) as QuestId;
  if (!QUEST_IDS.includes(id)) throw new HttpError(400, 'unknown_quest');
  if (b.action === 'open') return json(await rpc('mm_quest_open', { p_player: s.pid, p_quest: id }));
  if (b.action === 'claim') {
    const c = gameConfig();
    return json(await rpc('mm_quest_claim', { p_player: s.pid, p_quest: id, p_delay: c.questDelaySec, p_reward: c.questReward, p_label: QUEST_LABEL[id], p_ref_reward: envNum('REF_REWARD', 0) }));
  }
  throw new HttpError(400, 'unknown_action');
}

async function earn(req: Request) {
  requireSameOrigin(req);
  const s = await requireSession(req);
  const b = await readJson(req);
  const event = String(b.event) as EarnEvent;
  const rule = EARN_RULES[event];
  const key = String(b.key ?? '');
  if (!rule) throw new HttpError(400, 'unknown_event');
  if (!/^[A-Za-z0-9:_.,-]{1,80}$/.test(key)) throw new HttpError(400, 'bad_key');
  return json(await rpc('mm_earn', { p_player: s.pid, p_event: event, p_key: key, p_amount: rule.amount, p_reason: rule.label, p_cap: rule.cap }));
}

async function achievement(req: Request) {
  requireSameOrigin(req);
  const s = await requireSession(req);
  const id = String((await readJson(req)).id);
  const a = ACH_REWARD[id];
  if (!a) throw new HttpError(400, 'unknown_achievement');
  return json(await rpc('mm_award', { p_player: s.pid, p_amount: a.reward, p_reason: `Achievement: ${a.name}`, p_key: `ach:${id}` }));
}

async function stats(req: Request) {
  requireSameOrigin(req);
  const s = await requireSession(req);
  const b = await readJson(req);
  const best = { bestSol: Number(b.bestSol) | 0, bestScore: Number(b.bestScore) | 0, colonists: Number(b.colonists) | 0, bestStage: String(b.bestStage || 'outpost') };
  return json({ best: await rpc('mm_best', { p_player: s.pid, p_best: best }) });
}

// ---------------------------------------------------------------- router
export default async (req: Request) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  try {
    if (req.method === 'GET' && path === '/api/config') return json(gameConfig());
    if (req.method === 'GET' && path === '/api/auth/login') return await login(req).catch((e) => { console.error(e); return redirect('/?auth=error&reason=server'); });
    if (req.method === 'GET' && path === '/api/auth/callback') return await callback(req);
    if (req.method === 'POST' && path === '/api/auth/logout') { requireSameOrigin(req); return json({ ok: true }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', 0) }); }
    if (req.method === 'GET' && path === '/api/me') return await me(req);
    if (req.method === 'POST' && path === '/api/quest') return await quest(req);
    if (req.method === 'POST' && path === '/api/earn') return await earn(req);
    if (req.method === 'POST' && path === '/api/achievement') return await achievement(req);
    if (req.method === 'POST' && path === '/api/stats') return await stats(req);
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status);
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
};

export const config = { path: '/api/*' };
