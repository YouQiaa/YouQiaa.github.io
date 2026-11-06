import { createHash } from "node:crypto";
import { getJSON, setJSON, del, listJSON, listKeys } from "./db.js";
import { newToken } from "./password.js";

const SESSION_TTL = 30 * 86400e3; // 30 天
export const COOKIE_NAME = "wfu_session";

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function tokenKey(token) {
  return `sessions/${createHash("sha256").update(token).digest("hex")}.json`;
}

export async function createSession(email) {
  const token = newToken();
  await setJSON(tokenKey(token), { email, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

export function sessionCookie(request, token) {
  const secure = request.url.startsWith("https:") ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}`;
}

export function clearSessionCookie(request) {
  const secure = request.url.startsWith("https:") ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export async function destroySession(request) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (token) await del(tokenKey(token));
}

export async function destroyUserSessions(email) {
  const keys = await listKeys("sessions/");
  for (const key of keys) {
    const s = await getJSON(key);
    if (s && s.email === email) await del(key);
  }
}

export async function getUser(email) {
  if (!email) return null;
  return getJSON(`users/${normalizeEmail(email)}.json`);
}

export function isAdmin(email) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
  return list.includes(normalizeEmail(email));
}

/* 返回 { user, admin } 或 null；封禁/过期一律视为未登录 */
export async function getSessionUser(request) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return null;
  const session = await getJSON(tokenKey(token));
  if (!session || session.expiresAt < Date.now()) return null;
  const user = await getUser(session.email);
  if (!user || user.banned) return null;
  return { email: session.email, nickname: user.nickname, admin: isAdmin(session.email) };
}

/* 简单速率限制：内存 Map，同一 key 每分钟最多 max 次 */
const buckets = new Map();
export function rateLimit(key, max = 10, windowMs = 60e3) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}
