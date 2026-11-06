import { blob } from "@iga-pages/blob";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  normalizeEmail,
  createSession,
  destroySession,
  destroyUserSessions,
  getSessionUser,
  getUser,
  isAdmin,
  sessionCookie,
  clearSessionCookie,
  rateLimit
} from "../lib/auth.js";
import { getJSON, setJSON, getPet, savePet, allPets, publicPet, del, listKeys } from "../lib/db.js";
import { sendVerifyMail } from "../lib/email.js";
import { randomInt } from "node:crypto";

const VALID_TAGS = new Set(["社牛", "安静派", "黏人精", "运动型", "适合新手", "公寓友好"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function err(status, message) {
  return json({ ok: false, error: message }, status);
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function clientKey(request, extra = "") {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return `${ip}|${extra}`;
}

function text(v, max) {
  return String(v ?? "").trim().slice(0, max);
}

/* ---------------- auth ---------------- */

const CODE_TTL = 10 * 60e3; // 验证码 10 分钟有效
const CODE_RESEND_GAP = 60e3; // 同一邮箱 60 秒内不许重发

async function handleSendCode(request) {
  if (!rateLimit(clientKey(request, "send-code"), 10)) return err(429, "操作太频繁，请稍后再试");
  const data = await body(request);
  if (!data) return err(400, "请求格式错误");
  const email = normalizeEmail(data.email);
  if (!EMAIL_RE.test(email)) return err(400, "邮箱格式不正确");
  if (await getUser(email)) return err(409, "这个邮箱已经注册过了，直接登录试试");
  const key = `codes/${email}.json`;
  const old = await getJSON(key);
  if (old && Date.now() - old.sentAt < CODE_RESEND_GAP) {
    const wait = Math.ceil((CODE_RESEND_GAP - (Date.now() - old.sentAt)) / 1000);
    return err(429, `发送太频繁，${wait} 秒后再试`);
  }
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  await setJSON(key, { code, sentAt: Date.now(), expiresAt: Date.now() + CODE_TTL, attempts: 0 });
  let provider;
  try {
    provider = await sendVerifyMail(email, code);
  } catch (e) {
    console.error("[mail]", e && e.message);
    return err(500, "验证码发送失败，请稍后再试");
  }
  if (!provider) return json({ ok: true, devCode: code }); // 未配置邮件服务：测试模式，验证码直接回显
  return json({ ok: true });
}

async function handleRegister(request) {
  if (!rateLimit(clientKey(request, "register"), 10)) return err(429, "操作太频繁，请稍后再试");
  const data = await request.json().catch(() => null);
  if (!data) return err(400, "请求格式错误");
  const email = normalizeEmail(data.email);
  const nickname = text(data.nickname, 12);
  const password = String(data.password || "");
  if (!EMAIL_RE.test(email)) return err(400, "邮箱格式不正确");
  if (password.length < 8) return err(400, "密码至少 8 位");
  if (!nickname) return err(400, "给自己起个名字吧");
  if (await getUser(email)) return err(409, "这个邮箱已经注册过了，直接登录试试");
  const codeKey = `codes/${email}.json`;
  const rec = await getJSON(codeKey);
  if (!rec) return err(400, "请先获取邮箱验证码");
  if (rec.expiresAt < Date.now()) return err(400, "验证码已过期，点「发送验证码」重新获取");
  if (rec.attempts >= 5) return err(400, "验证码错误次数太多，请重新获取");
  if (rec.code !== text(data.code, 6)) {
    rec.attempts += 1;
    await setJSON(codeKey, rec);
    return err(400, "验证码不正确");
  }
  await del(codeKey);
  const { salt, hash } = await hashPassword(password);
  await setJSON(`users/${email}.json`, { email, nickname, salt, passHash: hash, banned: false, createdAt: Date.now() });
  const token = await createSession(email);
  return json(
    { ok: true, user: { email, nickname, admin: isAdmin(email) } },
    200,
    { "Set-Cookie": sessionCookie(request, token) }
  );
}

async function handleLogin(request) {
  if (!rateLimit(clientKey(request, "login"), 10)) return err(429, "尝试太频繁，请一分钟后再试");
  const data = await body(request);
  if (!data) return err(400, "请求格式错误");
  const email = normalizeEmail(data.email);
  const user = await getUser(email);
  if (!user) return err(401, "邮箱或密码不对");
  if (user.banned) return err(403, "该账号因发布不实信息已被永久封禁");
  const okPass = await verifyPassword(String(data.password || ""), user.salt, user.passHash);
  if (!okPass) return err(401, "邮箱或密码不对");
  const token = await createSession(email);
  const me = { email, nickname: user.nickname, admin: isAdmin(email) };
  return json({ ok: true, user: me }, 200, { "Set-Cookie": sessionCookie(request, token) });
}

async function handleLogout(request) {
  await destroySession(request);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
}

async function handleMe(request) {
  const me = await getSessionUser(request);
  return json({ ok: true, user: me });
}

/* ---------------- pets ---------------- */

async function handleListPets(request, url) {
  const area = url.searchParams.get("area") || "official";
  const me = await getSessionUser(request);
  const pets = await allPets();
  let list;
  if (area === "adopted") {
    list = pets.filter((p) => p.status === "adopted");
  } else if (area === "user") {
    list = pets.filter((p) => p.source === "user" && p.status === "approved");
  } else {
    list = pets.filter((p) => p.source === "official" && p.status === "approved");
  }
  list.sort((a, b) => a.createdAt - b.createdAt);
  return json({ ok: true, pets: list.map((p) => publicPet(p, { viewerLoggedIn: !!me })) });
}

function validatePetInput(data) {
  const name = text(data.name, 8);
  const species = text(data.species, 10) || "猫咪";
  const age = text(data.age, 10);
  const sex = data.sex === "母" ? "母" : "公";
  const neuter = text(data.neuter, 10);
  const vaccine = text(data.vaccine, 16);
  const city = text(data.city, 10);
  const quote = text(data.quote, 40);
  const contact = text(data.contact, 40);
  const tags = Array.isArray(data.tags) ? [...new Set(data.tags.filter((t) => VALID_TAGS.has(t)))].slice(0, 3) : [];
  const photoKeys = Array.isArray(data.photoKeys) ? data.photoKeys.filter((k) => typeof k === "string").slice(0, 3) : [];
  if (!name) return { error: "给猫咪写个名字吧" };
  if (!age) return { error: "写一下它多大啦" };
  if (!city) return { error: "写一下它在哪座城市" };
  if (!quote) return { error: "替它写一句自我介绍吧" };
  if (!contact) return { error: "留个联系方式，意向人才找得到你" };
  if (!tags.length) return { error: "至少选一个性格标签" };
  if (!photoKeys.length) return { error: "至少上传一张照片" };
  return { name, species, age, sex, neuter, vaccine, city, quote, contact, tags, photoKeys };
}

async function handleCreatePet(request, me) {
  const data = await body(request);
  if (!data) return err(400, "请求格式错误");
  const id = text(data.id, 48);
  if (!ID_RE.test(id)) return err(400, "编号格式不正确");
  const v = validatePetInput(data);
  if (v.error) return err(400, v.error);
  if (!v.photoKeys.every((k) => k.startsWith(`photos/${id}-`))) return err(400, "照片与信息不匹配");
  if (await getJSON(`pets/${id}.json`)) return err(409, "编号被占用了，刷新后再试");
  const pet = {
    id,
    source: "user",
    ownerEmail: me.email,
    ownerName: me.nickname,
    name: v.name,
    species: v.species,
    age: v.age,
    sex: v.sex,
    neuter: v.neuter || "未知",
    vaccine: v.vaccine || "未知",
    city: v.city,
    shelter: null,
    coords: null,
    label: null,
    tags: v.tags,
    quote: v.quote,
    contact: v.contact,
    photo: null,
    alt: `${v.city}待领养的${v.species}${v.name}`,
    photoKeys: v.photoKeys,
    flag: null,
    status: "pending",
    stage: "waiting",
    createdAt: Date.now(),
    adoptedAt: null,
    rejectReason: null
  };
  await savePet(pet);
  return json({ ok: true, id });
}

async function handlePatchPet(request, me, id) {
  const pet = await getPet(id);
  if (!pet) return err(404, "没有找到这只猫咪");
  const mine = pet.ownerEmail === me.email;
  if (!mine && !me.admin) return err(403, "只能操作自己发布的猫咪");
  const data = await body(request);
  if (!data) return err(400, "请求格式错误");

  if (data.action === "adopt") {
    if (pet.status !== "approved") return err(400, "只有展示中的猫咪才能标记回家");
    pet.status = "adopted";
    pet.adoptedAt = Date.now();
    await savePet(pet);
    return json({ ok: true });
  }

  if (pet.status !== "pending") return err(400, "只有待审核的信息可以修改");
  const v = validatePetInput({ ...pet, ...data, photoKeys: data.photoKeys || pet.photoKeys });
  if (v.error) return err(400, v.error);
  if (!v.photoKeys.every((k) => k.startsWith(`photos/${id}-`))) return err(400, "照片与信息不匹配");
  const oldKeys = pet.photoKeys || [];
  Object.assign(pet, {
    name: v.name, species: v.species, age: v.age, sex: v.sex, neuter: v.neuter,
    vaccine: v.vaccine, city: v.city, quote: v.quote, contact: v.contact,
    tags: v.tags, photoKeys: v.photoKeys
  });
  for (const k of oldKeys) if (!v.photoKeys.includes(k)) await del(k);
  await savePet(pet);
  return json({ ok: true });
}

async function handleDeletePet(request, me, id) {
  const pet = await getPet(id);
  if (!pet) return err(404, "没有找到这只猫咪");
  if (pet.ownerEmail !== me.email && !me.admin) return err(403, "只能删除自己发布的猫咪");
  if (pet.source === "official") return err(403, "官方数据不能删除");
  for (const key of pet.photoKeys || []) await del(key);
  await del(`pets/${id}.json`);
  return json({ ok: true });
}

/* ---------------- photos ---------------- */

async function handleUploadTicket(request, me) {
  const data = await body(request);
  if (!data) return err(400, "请求格式错误");
  const petId = text(data.petId, 48);
  const n = Number(data.n);
  if (!ID_RE.test(petId) || !(n >= 0 && n <= 2)) return err(400, "参数不正确");
  const key = `photos/${petId}-${n}`;
  let ticket;
  try {
    ticket = await blob.createUploadUrl(key, { onlyIfNew: true });
  } catch (e) {
    if (e && (e.code === 409 || e.status === 409 || /already exists/i.test(String(e.message)))) {
      return err(409, "这个照片位置已被占用，换个序号或先删掉旧的");
    }
    throw e;
  }
  return json({ ok: true, key, url: ticket.url, expiresAt: ticket.expiresAt });
}

async function handlePhoto(request, key) {
  if (!/^photos\/[\w.-]+$/.test(key)) return err(400, "参数不正确");
  const buf = await blob.get(key, { format: "arrayBuffer" });
  if (!buf) return err(404, "照片不存在");
  const meta = await blob.info(key);
  const type = meta?.contentType || "image/jpeg";
  return new Response(buf, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}

/* ---------------- favorites ---------------- */

function favKey(email, petId) {
  return `favorites/${normalizeEmail(email)}/${petId}`;
}

async function handleFav(me, petId, on) {
  const pet = await getPet(petId);
  if (!pet || (pet.status !== "approved" && pet.status !== "adopted")) return err(404, "没有找到这只猫咪");
  if (on) await setJSON(favKey(me.email, petId), { petId, createdAt: Date.now() });
  else await del(favKey(me.email, petId));
  return json({ ok: true });
}

async function handleMyFavorites(request, me) {
  const favs = await listJSONSafe(`favorites/${me.email}/`);
  const out = [];
  for (const f of favs) {
    const pet = await getPet(f.petId);
    if (pet && (pet.status === "approved" || pet.status === "adopted")) {
      out.push(publicPet(pet, { viewerLoggedIn: true }));
    }
  }
  return json({ ok: true, pets: out, ids: out.map((p) => p.id) });
}

async function listJSONSafe(prefix) {
  try {
    const keys = await listKeys(prefix);
    const out = [];
    for (const k of keys) {
      const v = await getJSON(k);
      if (v) out.push(v);
    }
    return out;
  } catch {
    return [];
  }
}

async function handleMyPets(request, me) {
  const pets = await allPets();
  const mine = pets.filter((p) => p.ownerEmail === me.email);
  mine.sort((a, b) => b.createdAt - a.createdAt);
  return json({ ok: true, pets: mine.map((p) => ({ ...publicPet(p, { viewerLoggedIn: true }), rejectReason: p.rejectReason })) });
}

/* ---------------- admin ---------------- */

async function handleAdminPending(request, me) {
  const pets = await allPets();
  const pending = pets.filter((p) => p.status === "pending").sort((a, b) => a.createdAt - b.createdAt);
  return json({ ok: true, pets: pending.map((p) => ({ ...publicPet(p, { viewerLoggedIn: true }), ownerEmail: p.ownerEmail })) });
}

async function handleAdminReview(request, me) {
  const data = await body(request);
  if (!data) return err(400, "请求格式错误");
  const pet = await getPet(text(data.id, 48));
  if (!pet) return err(404, "没有找到这只猫咪");
  if (pet.status !== "pending") return err(400, "这条信息已经审核过了");
  if (data.action === "approve") {
    const owner = await getUser(pet.ownerEmail);
    if (owner?.banned) return err(400, "发布者已被封禁，不能通过");
    pet.status = "approved";
    pet.rejectReason = null;
  } else if (data.action === "reject") {
    pet.status = "rejected";
    pet.rejectReason = text(data.reason, 60) || "信息不完整，请补充后再提交";
  } else {
    return err(400, "未知操作");
  }
  await savePet(pet);
  return json({ ok: true });
}

async function handleAdminBan(request, me) {
  const data = await body(request);
  if (!data) return err(400, "请求格式错误");
  const email = normalizeEmail(data.email);
  if (email === me.email) return err(400, "不能封禁自己");
  const user = await getUser(email);
  if (!user) return err(404, "没有找到这个账号");
  user.banned = true;
  await setJSON(`users/${email}.json`, user);
  const pets = await allPets();
  for (const p of pets) {
    // 骗子发布的所有信息都不可信，含"已回家"，一并下架
    if (p.ownerEmail === email && p.status !== "rejected") {
      p.status = "rejected";
      p.rejectReason = "账号因不实信息被永久封禁";
      await savePet(p);
    }
  }
  await destroyUserSessions(email);
  return json({ ok: true });
}

/* ---------------- router ---------------- */

export default {
  async fetch(request) {
    return await handle(request);
  }
};

async function handle(request) {
  const url = new URL(request.url, "http://localhost");
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const seg = path.split("/").filter(Boolean);
  const method = request.method;

  try {
    if (seg[0] === "health") {
      if (url.searchParams.get("plain") === "1") return json({ ok: true, plain: true });
      const { blob } = await import("@iga-pages/blob");
      const t = Date.now();
      if (url.searchParams.get("ticket") === "1") {
        try {
          const tk = await blob.createUploadUrl("photos/healthcheck-0", { onlyIfNew: false, abortSignal: AbortSignal.timeout(8000) });
          return json({ ok: true, ms: Date.now() - t, ticketKey: tk.key, hasUrl: !!tk.url, method: tk.method });
        } catch (e) {
          return json({ ok: false, ms: Date.now() - t, err: String(e && e.message || e), code: e && e.code, stack: String(e && e.stack || "").slice(0, 500) });
        }
      }
      try {
        const r = await blob.list({ prefix: "pets/", abortSignal: AbortSignal.timeout(8000) });
        return json({ ok: true, ms: Date.now() - t, keys: (r.blobs || []).length });
      } catch (e) {
        return json({ ok: false, ms: Date.now() - t, err: String(e && e.message || e), code: e && e.code });
      }
    }

    if (seg[0] === "auth") {
      if (method === "POST" && seg[1] === "send-code") return await handleSendCode(request);
      if (method === "POST" && seg[1] === "register") return await handleRegister(request);
      if (method === "POST" && seg[1] === "login") return await handleLogin(request);
      if (method === "POST" && seg[1] === "logout") return await handleLogout(request);
      if (method === "GET" && seg[1] === "me") return await handleMe(request);
    }

    if (seg[0] === "photos" && seg[1] && method === "GET") return await handlePhoto(request, seg.slice(1).join("/"));

    if (seg[0] === "pets" && !seg[1]) {
      if (method === "GET") return await handleListPets(request, url);
      if (method === "POST") {
        const me = await getSessionUser(request);
        if (!me) return err(401, "先登录，再发布");
        return await handleCreatePet(request, me);
      }
    }

    if (seg[0] === "pets" && seg[1]) {
      const me = await getSessionUser(request);
      if (!me) return err(401, "先登录");
      if (method === "PATCH") return await handlePatchPet(request, me, seg[1]);
      if (method === "DELETE") return await handleDeletePet(request, me, seg[1]);
    }

    if (seg[0] === "upload-ticket" && method === "POST") {
      const me = await getSessionUser(request);
      if (!me) return err(401, "先登录");
      return await handleUploadTicket(request, me);
    }

    if (seg[0] === "favorites" && seg[1]) {
      const me = await getSessionUser(request);
      if (!me) return err(401, "先登录，再收藏");
      if (method === "POST") return await handleFav(me, seg[1], true);
      if (method === "DELETE") return await handleFav(me, seg[1], false);
    }

    if (seg[0] === "my") {
      const me = await getSessionUser(request);
      if (!me) return err(401, "先登录");
      if (method === "GET" && seg[1] === "pets") return await handleMyPets(request, me);
      if (method === "GET" && seg[1] === "favorites") return await handleMyFavorites(request, me);
    }

    if (seg[0] === "admin") {
      const me = await getSessionUser(request);
      if (!me) return err(401, "先登录");
      if (!me.admin) return err(403, "这里只有审核员能进");
      if (method === "GET" && seg[1] === "pending") return await handleAdminPending(request, me);
      if (method === "POST" && seg[1] === "review") return await handleAdminReview(request, me);
      if (method === "POST" && seg[1] === "ban") return await handleAdminBan(request, me);
    }

    return err(404, "接口不存在");
  } catch (e) {
    console.error("[api] unhandled:", e && e.message);
    return err(500, "服务器出了点小状况，稍后再试");
  }
}
