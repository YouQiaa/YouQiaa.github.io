import { blob } from "@iga-pages/blob";
import { OFFICIAL_PETS } from "./official-pets.js";

export async function getJSON(key) {
  return (await blob.get(key, { format: "json" })) ?? null;
}

export async function setJSON(key, value) {
  await blob.setJSON(key, value);
}

export async function del(key) {
  try {
    await blob.delete(key);
  } catch {
    /* 不存在也视为成功 */
  }
}

export async function listKeys(prefix) {
  const res = await blob.list({ prefix });
  return (res.blobs || []).map((b) => b.key);
}

export async function listJSON(prefix) {
  const keys = await listKeys(prefix);
  const out = [];
  for (const key of keys) {
    const value = await getJSON(key);
    if (value) out.push(value);
  }
  return out;
}

let seeded = false;

/* 官方数据幂等 seed：固定 id，缺失才写入 */
export async function ensureSeed() {
  if (seeded) return;
  const existing = new Set(await listKeys("pets/"));
  for (const p of OFFICIAL_PETS) {
    if (existing.has(`pets/${p.id}.json`)) continue;
    const status = p.stage === "adopted" ? "adopted" : "approved";
    const now = Date.now();
    await setJSON(`pets/${p.id}.json`, {
      id: p.id,
      source: "official",
      ownerEmail: null,
      ownerName: p.shelter,
      name: p.name,
      species: p.species,
      age: p.age,
      sex: p.sex,
      neuter: p.neuter,
      vaccine: p.vaccine,
      city: p.city,
      shelter: p.shelter,
      coords: p.coords,
      label: p.label,
      tags: p.tags,
      quote: p.quote,
      contact: null,
      photo: p.photo,
      alt: p.alt,
      photoKeys: [],
      flag: p.flag || null,
      status,
      stage: status === "approved" ? p.stage : null,
      days: p.days,
      createdAt: now - p.days * 86400e3,
      adoptedAt: status === "adopted" ? now - p.days * 86400e3 : null,
      rejectReason: null
    });
  }
  seeded = true;
}

export async function allPets() {
  await ensureSeed();
  return listJSON("pets/");
}

export async function getPet(id) {
  await ensureSeed();
  return getJSON(`pets/${id}.json`);
}

export async function savePet(pet) {
  await setJSON(`pets/${pet.id}.json`, pet);
}

const DAY = 86400e3;

/* 对外序列化：脱敏 + 计算展示字段 */
export function publicPet(pet, { viewerLoggedIn = false } = {}) {
  const now = Date.now();
  const days =
    pet.status === "adopted"
      ? Math.max(0, Math.floor((now - (pet.adoptedAt || now)) / DAY))
      : Math.max(0, Math.floor((now - pet.createdAt) / DAY));
  return {
    id: pet.id,
    source: pet.source,
    ownerName: pet.source === "official" ? pet.shelter : pet.ownerName,
    name: pet.name,
    species: pet.species,
    age: pet.age,
    sex: pet.sex,
    neuter: pet.neuter,
    vaccine: pet.vaccine,
    city: pet.city,
    coords: pet.coords || null,
    label: pet.label || null,
    tags: pet.tags || [],
    quote: pet.quote,
    alt: pet.alt || `${pet.city}的${pet.name}`,
    photo: pet.photo || (pet.photoKeys && pet.photoKeys[0] ? `/api/photos/${pet.photoKeys[0]}` : null),
    photos: (pet.photoKeys || []).map((k) => `/api/photos/${k}`),
    _photoKeys: pet.photoKeys || [],
    flag: pet.flag || null,
    status: pet.status,
    stage: pet.stage,
    days,
    contact: viewerLoggedIn ? pet.contact || null : null
  };
}
