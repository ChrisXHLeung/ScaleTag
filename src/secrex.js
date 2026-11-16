import { Router } from "express";
import { AppError } from "./validation.js";

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
    const input = readFields(req.body, {
      id: [16], claim: [32], body: [17, 12016], bodyNonce: [12], wrapped: [48], wrapNonce: [12],
    });
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
    await store.create(input);
    res.status(201).json({ id: input.id });
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
  return router;
}
