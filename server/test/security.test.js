import test from "node:test";
import assert from "node:assert/strict";
import { createAdminAuth, createPasswordHash, verifyPasswordHash } from "../src/security.js";

test("verifies admin password and session cookie", () => {
  const auth = createAdminAuth({ password: "secret" });
  const headers = {};
  const res = { setHeader: (key, value) => { headers[key] = value; } };

  assert.equal(auth.verifyPassword("bad"), false);
  assert.equal(auth.verifyPassword("secret"), true);

  auth.setSessionCookie(res);
  assert.equal(auth.isAuthenticated({ headers: { cookie: headers["set-cookie"] } }), true);
});

test("hashes and verifies room passwords", () => {
  const stored = createPasswordHash("room-pass");

  assert.equal(verifyPasswordHash("wrong", stored), false);
  assert.equal(verifyPasswordHash("room-pass", stored), true);
});
