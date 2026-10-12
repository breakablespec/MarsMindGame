// Shared helpers for the API: env, cookies, signed sessions, Supabase RPC.

declare const process: { env: Record<string, string | undefined> };

export const env = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === '') throw new HttpError(500, 'server_misconfigured', `Missing environment variable ${k}`);
  return v;
};
export const envNum = (k: string, fallback: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : fallback;
};

export class HttpError extends Error {
  constructor(public status: number, public code: string, msg?: string) { super(msg ?? code); }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const redirect = (location: string, cookies: string[] = []) => {
  const h = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
};

// ---------------------------------------------------------------- cookies
export function readCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function cookie(name: string, value: string, maxAge: number, path = '/') {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

// ---------------------------------------------------------------- signing (HMAC-SHA256)
const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function hmacKey() {
  return crypto.subtle.importKey('raw', enc.encode(env('SESSION_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function sign(payload: Record<string, unknown>, ttlSec: number): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}
export async function verify<T extends Record<string, unknown>>(token: string | undefined): Promise<T | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T & { exp: number };
    return data.exp > Date.now() / 1000 ? data : null;
  } catch { return null; }
}
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256b64url = async (s: string) => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));

// ---------------------------------------------------------------- session
export const SESSION_COOKIE = 'mm_session';
export interface Session { pid: string; xid: string; h: string }
export async function session(req: Request): Promise<Session | null> {
  return verify<Session & Record<string, unknown>>(readCookies(req)[SESSION_COOKIE]);
}
export async function requireSession(req: Request): Promise<Session> {
  const s = await session(req);
  if (!s) throw new HttpError(401, 'signed_out');
  return s;
}

/** POSTs must come from our own pages (the session cookie is SameSite=Lax as well). */
export function requireSameOrigin(req: Request) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw new HttpError(403, 'cross_site');
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) throw new HttpError(403, 'cross_site');
}

export function siteOrigin(req: Request) {
  return (process.env.SITE_URL || new URL(req.url).origin).replace(/\/$/, '');
}

// ---------------------------------------------------------------- Supabase (PostgREST RPC, service role)
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const url = `${env('SUPABASE_URL').replace(/\/$/, '')}/rest/v1/rpc/${fn}`;
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  // legacy service_role keys are JWTs (eyJ…) and go in both headers; new sb_secret_… keys only in apikey
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`Supabase ${fn} failed`, res.status, text.slice(0, 300));
    throw new HttpError(502, 'database_error');
  }
  return res.json() as Promise<T>;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try { const v = await req.json(); return v && typeof v === 'object' ? v as Record<string, unknown> : {}; } catch { return {}; }
}
