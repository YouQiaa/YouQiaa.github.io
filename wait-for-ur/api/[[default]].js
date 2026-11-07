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
  const counts = await commentCounts();
  return json({
    ok: true,
    pets: list.map((p) => ({ ...publicPet(p, { viewerLoggedIn: !!me }), commentCount: counts[p.id] || 0 }))
  });
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
