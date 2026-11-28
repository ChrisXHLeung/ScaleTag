import { Router } from "express";
import { AppError } from "./validation.js";

const LIFETIME_MINUTES = new Set([15, 60, 1440, 10080]);

export function canonical(value, min, max = min) {
  if (typeof value !== "string" || value.length > Math.ceil(max * 4 / 3) ||
      !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length >= min && bytes.length <= max && bytes.toString("base64url") === value;
}

function readFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== Object.keys(fields).length)
    throw new AppError(400, "Invalid Secrex request.");
  for (const [key, sizes] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key) || !canonical(value[key], ...sizes))
      throw new AppError(400, "Invalid Secrex request.");
  }
  return value;
}

export function createSecrexRouter(store) {
  const router = Router();
  let windowStart = 0;
  let creations = 0;
  router.param("id", (_req, _res, next, id) => {
    if (!canonical(id, 16)) return next(new AppError(404, "Secret not found."));
    next();
  });
  router.post("/", async (req, res) => {
    const { expiresInMinutes, ...envelope } = req.body ?? {};
    const input = readFields(envelope, {
      id: [16], claim: [32], body: [17, 12016], bodyNonce: [12], wrapped: [48], wrapNonce: [12],
    });
    if (expiresInMinutes !== undefined && !LIFETIME_MINUTES.has(expiresInMinutes))
      throw new AppError(400, "Invalid Secrex request.");
    // The legacy request body works with either slot during a rolling release.
    const revokeVerifier = req.get("X-Secrex-Revoke-Verifier");
    if (revokeVerifier !== undefined && !canonical(revokeVerifier, 32))
      throw new AppError(400, "Invalid Secrex request.");
    const now = Date.now();
    if (now - windowStart >= 60000) {
      windowStart = now;
      creations = 0;
    }
    if (creations >= 20) {
      res.set("Retry-After", "60");
      throw new AppError(429, "Too many secrets are being created. Try again shortly.");
    }
    creations++;
    const lifetime = expiresInMinutes === undefined ? undefined : expiresInMinutes * 60000;
    const expiresAt = await store.create(input, revokeVerifier, lifetime);
    res.status(201).json({
      id: input.id,
      ...(revokeVerifier ? { revocable: true } : {}),
      ...(lifetime === undefined ? {} : { expiresAt }),
    });
  });
  router.post("/:id/claim", async (req, res) => {
    const { claim, session } = readFields(req.body, { claim: [32], session: [32] });
    res.json(await store.claim(req.params.id, claim, session));
  });
  router.post("/:id/end", (req, res) => {
    const { session } = readFields(req.body, { session: [32] });
    store.end(req.params.id, session);
    res.sendStatus(204);
  });
  router.post("/:id/revoke", (req, res) => {
    const { revoke } = readFields(req.body, { revoke: [32] });
    store.revoke(req.params.id, revoke);
    res.sendStatus(204);
  });
  return router;
}
