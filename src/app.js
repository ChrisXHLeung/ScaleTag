import express from "express";
import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  AppError,
  coordinates,
  pollInput,
  taskInput,
  replyInput,
} from "./validation.js";
import { ID_PATTERN } from "./store.js";
import { serviceWorkerSource, STATIC_ASSETS } from "./pwa.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const COOKIE_PATTERN = /^[a-f0-9]{64}$/;

export function createApp(
  store,
  { origin = "http://127.0.0.1:3000", createLimit = 20,
    instance = "single", revision = "development", ready = () => true } = {},
) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
    throw Error("PUBLIC_ORIGIN must be an origin without a trailing slash");
  const secure = url.protocol === "https:";
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  const workerSource = serviceWorkerSource();
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data: blob:; connect-src 'self' https://tiles.openfreemap.org; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; worker-src 'self'",
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
  app.get("/readyz", (req, res) => {
    try {
      if (!ready()) return res.status(503).json({ status: "unavailable" });
      res.json({ status: "ok", instance, revision });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  async function takeCreation(res) {
    if (store.consumeLimit) {
      if (await store.consumeLimit("create", createLimit)) return;
      res.set("Retry-After", "60");
      throw new AppError(429, "Too many posts are being published. Please try again in a minute.");
    }
    if (store.clock() - windowStart >= 60000) {
      windowStart = store.clock();
      creations = 0;
    }
    if (creations >= createLimit) {
      res.set("Retry-After", "60");
      throw new AppError(
        429,
        "Too many posts are being published. Please try again in a minute.",
      );
    }
    creations++;
  }
  app.post("/api/polls", async (req, res) => {
    const input = pollInput(req.body);
    await takeCreation(res);
    res.status(201).json(await store.create(input));
  });
  app.post("/api/tasks", async (req, res) => {
    const input = taskInput(req.body);
    await takeCreation(res);
    res.status(201).json(await store.create(input));
  });
  function contentType(data) {
    if (data.type && !["all", "poll", "task"].includes(data.type))
      throw new AppError(400, "Invalid content type.");
    return data.type;
  }
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
      store.list({
        location,
        status: data.status,
        cursor: data.cursor,
        type: contentType(data),
      }),
    );
  }
  app.get("/api/posts", list);
  app.post("/api/posts/search", list);
  app.get("/api/polls", list);
  app.post("/api/polls/search", list);
  app.post("/api/map/search", (req, res) => {
    const data = req.body ?? {};
    if (data.status && !["all", "open", "closed"].includes(data.status))
      throw new AppError(400, "Invalid filter.");
    res.json(
      store.map({
        status: data.status,
        type: contentType(data),
        location: data.location ? coordinates(data.location) : undefined,
      }),
    );
  });

  function cookieName(id, prefix = "st") {
    return `${prefix}_${id}`;
  }
  function tokenFor(req, id, prefix = "st") {
    const item = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName(id, prefix)}=`));
    const token = item?.slice(cookieName(id, prefix).length + 1);
    return COOKIE_PATTERN.test(token ?? "") ? token : undefined;
  }
  app.param("id", (req, res, next, id) =>
    ID_PATTERN.test(id)
      ? next()
      : next(
          new AppError(
            404,
            "This poll does not exist or has been removed from the website.",
          ),
        ),
  );
  app.get("/api/polls/:id", async (req, res) => {
    let token = tokenFor(req, req.params.id);
    const poll = await store.get(req.params.id, token);
    if (poll.type === "task") throw new AppError(404, "Poll not found.");
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
    if (poll.type === "task") throw new AppError(404, "Poll not found.");
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
  app.get("/api/tasks/:id", async (req, res) => {
    const task = await store.get(req.params.id);
    if (task.type !== "task") throw new AppError(404, "Task not found.");
    res.json(task);
  });
  app.get("/api/tasks/:id/qr.png", async (req, res) => {
    const task = await store.get(req.params.id);
    if (task.type !== "task") throw new AppError(404, "Task not found.");
    const png = await QRCode.toBuffer(`${origin}/task/${task.id}`, {
      type: "png",
      width: 768,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#173b7a", light: "#ffffff" },
    });
    if (req.query.download === "1")
      res.set(
        "Content-Disposition",
        `attachment; filename="ScaleTag-task-${task.id}.png"`,
      );
    res.type("png").send(png);
  });
  app.get("/api/posts/:id/social", async (req, res) => {
    let token = tokenFor(req, req.params.id, "ss");
    const data = await store.getSocial(req.params.id, token);
    if (!token) {
      token = randomBytes(32).toString("hex");
      res.cookie(cookieName(req.params.id, "ss"), token, {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: `/api/posts/${req.params.id}`,
        expires: new Date(data.deleteAt),
        maxAge: Math.max(0, data.deleteAt - store.clock()),
      });
    }
    res.json(data);
  });
  function socialToken(req) {
    const token = tokenFor(req, req.params.id, "ss");
    if (!token)
      throw new AppError(
        403,
        "Please allow this post’s anonymous cookie and reload before liking or replying.",
      );
    return token;
  }
  app.post("/api/posts/:id/likes", async (req, res) =>
    res.json(await store.like(req.params.id, socialToken(req))),
  );
  let replyWindow = store.clock(),
    replyRequests = 0;
  app.post("/api/posts/:id/replies", async (req, res) => {
    const token = socialToken(req),
      input = replyInput(req.body);
    if (store.clock() - replyWindow >= 60000) {
      replyWindow = store.clock();
      replyRequests = 0;
    }
    const limited = store.consumeLimit
      ? !(await store.consumeLimit("reply", 20)) : replyRequests >= 20;
    if (limited) {
      res.set("Retry-After", "60");
      throw new AppError(
        429,
        "Too many replies. Please try again in a minute.",
      );
    }
    replyRequests++;
    res.status(201).json(await store.reply(req.params.id, token, input));
  });
  app.use("/api", (req, res, next) =>
    next(new AppError(404, "Endpoint not found.")),
  );
  let installationQr;
  app.get("/install/qr.png", async (req, res) => {
    installationQr ??= QRCode.toBuffer(`${origin}/install`, {
      type: "png",
      width: 384,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#173b7a", light: "#ffffff" },
    });
    res.type("png").send(await installationQr);
  });
  app.get("/sw.js", (req, res) => {
    res.set("Service-Worker-Allowed", "/");
    res.type("application/javascript").send(workerSource);
  });
  // Serve only the pinned browser distribution, not the node_modules directory.
  for (const name of [
    "maplibre-gl.mjs",
    "maplibre-gl-worker.mjs",
    "maplibre-gl.css",
  ]) {
    app.get(`/vendor/maplibre/6.16.0/${name}`, (req, res) => {
      res.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
      res.sendFile(
        fileURLToPath(
          new URL(`../node_modules/maplibre-gl/dist/${name}`, import.meta.url),
        ),
      );
    });
  }
  app.use(
    express.static(publicDir, {
      index: false,
      etag: false,
      maxAge: 0,
      setHeaders(res, path) {
        const relative = "/" + path.slice(publicDir.length).replace(/^\//, "");
        if (STATIC_ASSETS.includes(relative))
          res.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
      },
    }),
  );
  // Preserve shared links and old installed-app shortcuts after the listing rename.
  app.get("/VoteList", (req, res) =>
    res.redirect(308, "/PostList" + req.originalUrl.slice(req.path.length)),
  );
  app.get(
    ["/", "/create", "/create/task", "/PostList", "/privacy", "/install"],
    (req, res) => res.sendFile(join(publicDir, "index.html")),
  );
  app.get("/vote/:id", async (req, res) => {
    const poll = await store.get(req.params.id);
    if (poll.type === "task") throw new AppError(404, "Poll not found.");
    res.sendFile(join(publicDir, "index.html"));
  });
  app.get("/task/:id", async (req, res) => {
    const task = await store.get(req.params.id);
    if (task.type !== "task") throw new AppError(404, "Task not found.");
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
