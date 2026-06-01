import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ADMIN_COOKIE = "lte_intercom_admin";

export function createAdminAuth(options = {}) {
  const password = String((options.password ?? process.env.ADMIN_PASSWORD) || "admin");
  const configPath = options.configPath === undefined
    ? (options.password === undefined ? resolve(process.cwd(), "config", "admin-auth.json") : null)
    : options.configPath;
  const storedPasswordHash = loadAdminPasswordHash(configPath);
  let hasStoredPassword = Boolean(storedPasswordHash);
  let adminPasswordHash = storedPasswordHash || createPasswordHash(password);
  const token = randomBytes(32).toString("hex");

  function verifyPassword(input) {
    return verifyPasswordHash(input, adminPasswordHash);
  }

  function changePassword(currentPassword, nextPassword) {
    const next = String(nextPassword || "");
    if (!verifyPassword(currentPassword)) {
      const error = new Error("current_password_invalid");
      error.statusCode = 401;
      throw error;
    }
    if (next.trim().length < 4) {
      const error = new Error("new_password_too_short");
      error.statusCode = 400;
      throw error;
    }
    adminPasswordHash = createPasswordHash(next);
    saveAdminPasswordHash(configPath, adminPasswordHash);
    hasStoredPassword = Boolean(configPath);
  }

  function isAuthenticated(req) {
    return parseCookies(req.headers.cookie || "")[ADMIN_COOKIE] === token;
  }

  function setSessionCookie(res) {
    res.setHeader("set-cookie", `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
  }

  function clearSessionCookie(res) {
    res.setHeader("set-cookie", `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }

  return {
    get isDefaultPassword() {
      return !hasStoredPassword && password === "admin";
    },
    verifyPassword,
    changePassword,
    isAuthenticated,
    setSessionCookie,
    clearSessionCookie
  };
}

export function createPasswordHash(password) {
  const value = String(password || "");
  if (!value) return null;
  const salt = randomBytes(16).toString("hex");
  return {
    salt,
    hash: hashPassword(value, salt)
  };
}

export function verifyPasswordHash(password, stored) {
  if (!stored?.salt || !stored?.hash) return true;
  return safeEqual(hashPassword(String(password || ""), stored.salt), stored.hash);
}

function hashPassword(password, salt) {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function loadAdminPasswordHash(configPath) {
  if (!configPath || !existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (parsed?.passwordHash?.salt && parsed?.passwordHash?.hash) {
      return parsed.passwordHash;
    }
  } catch {
    return null;
  }
  return null;
}

function saveAdminPasswordHash(configPath, passwordHash) {
  if (!configPath) return;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({ passwordHash, updatedAt: new Date().toISOString() }, null, 2)
  );
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join("=") || "");
  }
  return cookies;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
