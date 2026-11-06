import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, SCRYPT_OPTS, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt);
  return { salt, hash: key.toString("hex") };
}

export async function verifyPassword(password, salt, expectedHash) {
  const key = await scryptAsync(password, salt);
  const expected = Buffer.from(expectedHash, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function newToken() {
  return randomBytes(32).toString("hex");
}
