import express from "express";
import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AppError, coordinates, pollInput } from "./validation.js";
import { ID_PATTERN } from "./store.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const COOKIE_PATTERN = /^[a-f0-9]{64}$/;

export function createApp(
  store,
  { origin = "http://127.0.0.1:3000", createLimit = 20 } = {},
) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
    throw Error("PUBLIC_ORIGIN must be an origin without a trailing slash");
  const secure = url.protocol === "https:";
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    });
    if (secure) res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (
      req.method === "POST" &&
      (req.get("origin") !== origin || !req.is("application/json"))
    ) {
      return next(
        new AppError(
          403,
          "Invalid request origin. Please use the ScaleTag website.",
        ),
      );
    }
    next();
  });
  app.use(express.json({ limit: "24kb", strict: true }));
  let windowStart = store.clock();
  let creations = 0;
  app.get("/healthz", (req, res) =>
    res.json({ status: "ok", version: "0.1.0" }),
  );
  app.post("/api/polls", async (req, res) => {
    const input = pollInput(req.body);
    if (store.clock() - windowStart >= 60000) {
      windowStart = store.clock();
      creations = 0;
    }
    if (creations >= createLimit) {
      res.set("Retry-After", "60");
      throw new AppError(
        429,
        "Too many polls are being published. Please try again in a minute.",
      );
    }
    creations++;
    const poll = await store.create(input);
    res.status(201).json(poll);
  });
  function list(req, res) {
    const data = req.method === "POST" ? (req.body ?? {}) : req.query;
    if (data.status && !["all", "open", "closed"].includes(data.status))
      throw new AppError(400, "Invalid filter.");
    if (
      data.cursor &&
      (typeof data.cursor !== "string" || data.cursor.length > 512)
    )
      throw new AppError(400, "Invalid page cursor.");
    const location =
      req.method === "POST" && data.location
        ? coordinates(data.location)
        : undefined;
    res.json(
      store.list({ location, status: data.status, cursor: data.cursor }),
    );
  }
  app.get("/api/polls", list);
  app.post("/api/polls/search", list);

  function cookieName(id) {
    return `st_${id}`;
  }
  function tokenFor(req, id) {
    const item = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName(id)}=`));
    const token = item?.slice(cookieName(id).length + 1);
    return COOKIE_PATTERN.test(token ?? "") ? token : undefined;
  }
  app.param("id", (req, res, next, id) =>
    ID_PATTERN.test(id)
      ? next()
      : next(
          new AppError(
            404,
            "This poll does not exist or has been permanently deleted.",
          ),
        ),
  );
  app.get("/api/polls/:id", async (req, res) => {
    let token = tokenFor(req, req.params.id);
    const poll = await store.get(req.params.id, token);
    if (poll.status === "open" && !token) {
      token = randomBytes(32).toString("hex");
      res.cookie(cookieName(poll.id), token, {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: `/api/polls/${poll.id}`,
        expires: new Date(poll.endsAt),
        maxAge: Math.max(0, poll.endsAt - store.clock()),
      });
    } else if (poll.status === "closed" && token) {
      res.clearCookie(cookieName(poll.id), {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: `/api/polls/${poll.id}`,
      });
    }
    res.json(poll);
  });
  app.post("/api/polls/:id/votes", async (req, res) => {
    const token = tokenFor(req, req.params.id);
    if (!token)
      throw new AppError(
        403,
        "Please allow this poll’s anonymous cookie and reload the page before voting.",
      );
    if (!Number.isInteger(req.body?.optionId))
      throw new AppError(400, "Please select exactly one option.");
    res.json(await store.vote(req.params.id, token, req.body.optionId));
  });
  app.get("/api/polls/:id/qr.png", async (req, res) => {
    const poll = await store.get(req.params.id);
    const png = await QRCode.toBuffer(`${origin}/vote/${poll.id}`, {
      type: "png",
      width: 768,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#173b7a", light: "#ffffff" },
    });
    if (req.query.download === "1")
      res.set(
        "Content-Disposition",
        `attachment; filename="ScaleTag-${poll.id}.png"`,
      );
    res.type("png").send(png);
  });
  app.use("/api", (req, res, next) =>
    next(new AppError(404, "Endpoint not found.")),
  );
  app.use(express.static(publicDir, { index: false, etag: false, maxAge: 0 }));
  app.get(["/", "/create", "/VoteList", "/privacy"], (req, res) =>
    res.sendFile(join(publicDir, "index.html")),
  );
  app.get("/vote/:id", async (req, res) => {
    await store.get(req.params.id);
    res.sendFile(join(publicDir, "index.html"));
  });
  app.use((req, res, next) => next(new AppError(404, "Page not found.")));
  app.use((err, req, res, next) => {
    const status =
      err instanceof AppError
        ? err.status
        : err.type === "entity.too.large"
          ? 413
          : err.type === "entity.parse.failed"
            ? 400
            : 500;
    const message =
      err instanceof AppError
        ? err.message
        : status === 413
          ? "The submitted content is too large."
          : status === 400
            ? "Invalid request format."
            : "The service is temporarily unavailable. Please try again.";
    if (status === 500) console.error("Request failed:", err.code ?? err.name); // Never log payloads, IPs, cookies or coordinates.
    if (req.path.startsWith("/api/") || req.path === "/healthz")
      return res.status(status).json({ error: message });
    res.status(status).sendFile(join(publicDir, "index.html"));
  });
  return app;
}
