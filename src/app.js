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
  saleInput,
  offerInput,
  replyInput,
  manageKeyInput,
  ownerEditInput,
  taskStateInput,
} from "./validation.js";
import { DAY, ID_PATTERN } from "./store.js";
import { canonical, createSecrexRouter } from "./secrex.js";
import { serviceWorkerSource, STATIC_ASSETS } from "./pwa.js";

import { saleImages } from "./sale-images.js";
import { pickupCalendar, pollCalendar } from "./pickup-calendar.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const COOKIE_PATTERN = /^[a-f0-9]{64}$/;
const VISITOR_COOKIE = "st_visit";
const CANADIAN_ORIGINS = new Set(["https://scaletag.top", "https://www.scaletag.top"]);

function cookieToken(req, name) {
  const prefix = `${name}=`;
  const item = (req.headers.cookie ?? "").split(";")
    .map(value => value.trim()).find(value => value.startsWith(prefix));
  const token = item?.slice(prefix.length);
  return COOKIE_PATTERN.test(token ?? "") ? token : undefined;
}

export function createApp(
  store,
  { origin = "http://127.0.0.1:3000", createLimit = 20,
    instance = "single", revision = "development", ready = () => true, secrex } = {},
) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
    throw Error("PUBLIC_ORIGIN must be an origin without a trailing slash");
  const secure = url.protocol === "https:";
  const canadianDeployment = CANADIAN_ORIGINS.has(origin);
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
    if (req.method !== "POST") return next();
    // Canada's two public hostnames serve the same deployment. Each can write
    // only from its own origin; other deployments retain a single origin.
    const requestOrigin = req.get("origin");
    const validOrigin = canadianDeployment
      ? CANADIAN_ORIGINS.has(requestOrigin) && requestOrigin === `https://${req.get("host")?.toLowerCase()}`
      : requestOrigin === origin;
    if (!validOrigin || !req.is("application/json")) {
      return next(
        new AppError(
          403,
          "Invalid request origin. Please use the ScaleTag website.",
        ),
      );
    }
    next();
  });
  const traffic = store.traffic;
  let lastTrafficWarning = -Infinity;
  function sendPublicPage(req, res, file, postId) {
    const purpose = `${req.get("sec-purpose") ?? ""} ${req.get("purpose") ?? ""}`;
    if (traffic && req.method === "GET" && !/prefetch|prerender/i.test(purpose)) {
      const browserToken = cookieToken(req, VISITOR_COOKIE) ?? randomBytes(32).toString("hex");
      res.cookie(VISITOR_COOKIE, browserToken, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * DAY,
      });
      res.once("finish", () => {
        if (res.statusCode !== 200 && res.statusCode !== 304) return;
        const now = store.clock();
        void traffic.record(now, browserToken, postId).catch(error => {
          if (now - lastTrafficWarning < 60000) return;
          lastTrafficWarning = now;
          console.error("Visit count failed:", error.code ?? error.name);
        });
      });
    }
    res.sendFile(file, { root: publicDir });
  }

  function markPostRobots(res, post) {
    if (post.visibility === "unlisted") res.set("X-Robots-Tag", "noindex");
  }

  function sendPostPage(req, res, post) {
    markPostRobots(res, post);
    if (post.visibility === "unlisted") return res.sendFile(join(publicDir, "index.html"));
    return sendPublicPage(req, res, "index.html", post.id);
  }

  const visitTypes = new Map([["poll", "poll"], ["task", "task"], ["giveaway", "sale"]]);
  async function visiblePost(type, id) {
    const post = await store.get(id);
    if ((post.type ?? "poll") !== type || post.visibility === "unlisted")
      throw new AppError(404, "Post not found.");
    return post;
  }

  if (traffic) {
    app.get("/api/visits", (_req, res) => res.json(traffic.views(store.clock())));
    app.get("/api/visits/:type/:id", async (req, res) => {
      const { type, id } = req.params;
      if (!visitTypes.has(type) || !ID_PATTERN.test(id))
        throw new AppError(404, "Post not found.");
      await visiblePost(visitTypes.get(type), id);
      res.json(traffic.views(store.clock(), id));
    });
    app.get("/api/stats", (req, res) => {
      const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
      const ingress = req.get("x-scaletag-local-stats") === "1";
      const localHost = /^(127\.0\.0\.1|localhost|ingress)(:[0-9]+)?$/i.test(req.get("host") ?? "");
      const forwarded = ["cf-connecting-ip", "cf-ray", "x-forwarded-for", "forwarded"].some(name => req.get(name));
      if ((!loopback && !ingress) || !localHost || forwarded)
        throw new AppError(404, "Page not found.");
      const now = store.clock();
      const views = traffic.views(now);
      const window = days => {
        const after = now - days * DAY;
        return {
          visits: views[`days${days}`],
          created: { ...store.createdCounts(after, now), secrex: secrex?.createdCount(after, now) ?? 0 },
        };
      };
      res.json({
        site: origin,
        asOf: new Date(now).toISOString(),
        collectionStartedAt: new Date(traffic.startedAt).toISOString(),
        days7: window(7),
        days30: window(30),
      });
    });
  }

  // Only publication and owner photo edits accept image uploads.
  app.post([
    "/api/polls", "/api/tasks", "/api/sales",
    "/api/polls/:id/edit", "/api/tasks/:id/edit", "/api/sales/:id/edit",
  ], express.json({ limit: 4300000, strict: true }));
  app.use(express.json({ limit: "24kb", strict: true }));
  if (secrex) {
    app.get("/api/secrex/:secretId/qr.png", async (req, res) => {
      const { secretId: id } = req.params;
      if (!canonical(id, 16))
        throw new AppError(404, "Secret not found.");
      const image = await QRCode.toBuffer(`${origin}/secrex/${id}`, { width: 384, margin: 4 });
      res.type("png").send(image);
    });
    app.use("/api/secrex", createSecrexRouter(secrex));
    app.get(["/create/secrex", "/secrex", "/secrex/:secretId"], (req, res) => {
      res.set("Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      if (req.params.secretId) res.sendFile("secrex.html", { root: publicDir });
      else sendPublicPage(req, res, "secrex.html");
    });
  }

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
  async function publicationImages(images) {
    const result = [];
    for (const image of images) {
      // HTTPS URLs were validated by baseInput; retain old-client support
      // without fetching them server-side. Uploaded bytes use the sale policy.
      result.push(image.startsWith("data:") ? (await saleImages([image]))[0] : image);
    }
    return result;
  }
  app.post("/api/polls", async (req, res) => {
    const input = pollInput(req.body);
    await takeCreation(res);
    input.images = await publicationImages(input.images);
    res.status(201).json(await store.create(input));
  });
  app.post("/api/tasks", async (req, res) => {
    const input = taskInput(req.body);
    await takeCreation(res);
    input.images = await publicationImages(input.images);
    res.status(201).json(await store.create(input));
  });
  app.post("/api/sales", async (req, res) => {
    const input = saleInput(req.body);
    await takeCreation(res);
    input.images = await saleImages(req.body.images);
    res.status(201).json(await store.create(input));
  });
  function contentType(data) {
    if (data.type && !["all", "poll", "task", "sale", "wanted", "found"].includes(data.type))
      throw new AppError(400, "Invalid content type.");
    return data.type;
  }
  function nearbyOptions(data, location) {
    const { radiusKm, sort } = data;
    if (radiusKm !== undefined && (!location || ![2, 10, 50, 100].includes(radiusKm)))
      throw new AppError(400, "Choose a valid nearby search radius.");
    if (sort !== undefined && sort !== "newest" && (sort !== "nearest" || !location))
      throw new AppError(400, "Choose a valid post sort order.");
    return { location, radiusKm, sort };
  }
  function pickupFilter(value) {
    if (value !== undefined && !["now", "upcoming"].includes(value)) throw new AppError(400, "Invalid filter.");
    return value;
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
        ...nearbyOptions(data, location),
        status: data.status,
        cursor: data.cursor,
        type: contentType(data),
        query: keywordQuery(data.query),
        pickup: pickupFilter(data.pickup),
      }),
    );
  }
  app.get("/api/posts", list);
  app.post("/api/posts/search", list);
  app.post("/api/posts/statuses", (req, res) => {
    const posts = req.body?.posts;
    if (!Array.isArray(posts) || posts.length < 1 || posts.length > 20 || posts.some(post =>
      !["poll", "task", "sale"].includes(post?.type) ||
      typeof post.id !== "string" || !ID_PATTERN.test(post.id))) {
      throw new AppError(400, "Send between 1 and 20 valid post references.");
    }
    res.set("X-Robots-Tag", "noindex");
    res.json(store.savedStatuses(posts));
  });
  app.get("/api/polls", list);
  app.post("/api/polls/search", list);
  app.post("/api/map/search", (req, res) => {
    const data = req.body ?? {};
    if (data.status && !["all", "open", "closed"].includes(data.status))
      throw new AppError(400, "Invalid filter.");
    res.json(
      store.map({
        ...nearbyOptions(data, data.location ? coordinates(data.location) : undefined),
        status: data.status,
        type: contentType(data),
        query: keywordQuery(data.query),
        pickup: pickupFilter(data.pickup),
      }),
    );
  });

  function keywordQuery(value) {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > 240 || [...value].length > 120)
      throw new AppError(400, "Search must be at most 120 characters.");
    return value;
  }

  function cookieName(id, prefix = "st") {
    return `${prefix}_${id}`;
  }
  function tokenFor(req, id, prefix = "st") {
    return cookieToken(req, cookieName(id, prefix));
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
    if (["task", "sale"].includes(poll.type)) throw new AppError(404, "Poll not found.");
    markPostRobots(res, poll);
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
    const { optionId, optionIds } = req.body ?? {};
    if (optionIds !== undefined && (optionId !== undefined || !Array.isArray(optionIds)))
      throw new AppError(400, "Please select one or more different options.");
    if (optionIds === undefined && !Number.isInteger(optionId))
      throw new AppError(400, "Please select exactly one option.");
    res.json(await store.vote(req.params.id, token, optionIds ?? optionId));
  });
  app.post("/api/polls/:id/manage", async (req, res) => {
    res.set({ "Cache-Control": "no-store, private, max-age=0", Pragma: "no-cache",
      "X-Robots-Tag": "noindex" });
    res.json(await store.managePoll(req.params.id, manageKeyInput(req.body)));
  });
  app.post("/api/polls/:id/state", async (req, res) => {
    const key = manageKeyInput(req.body);
    res.set("Cache-Control", "no-store");
    res.json(await store.setPollState(req.params.id, key, req.body.state, req.body.decision));
  });
  app.get("/api/polls/:id/event.ics", async (req, res) => {
    const poll = await store.get(req.params.id, undefined, { expectedType: "poll" });
    if (poll.decision?.startsAt === undefined) throw new AppError(404, "Poll not found.");
    res.set({ "X-Robots-Tag": "noindex", "Cache-Control": "no-store" });
    res.attachment(`ScaleTag-event-${poll.id}.ics`).type("text/calendar; charset=utf-8").send(pollCalendar(poll, origin));
  });
  for (const [type, collection] of [["poll", "polls"], ["task", "tasks"], ["sale", "sales"]]) {
    app.post(`/api/${collection}/:id/edit`, async (req, res) => {
      res.set({ "Cache-Control": "no-store, private, max-age=0", Pragma: "no-cache" });
      const { key, changes } = ownerEditInput(req.body, type);
      const update = await store.editManagedPost(req.params.id, key, type, changes,
        type === "sale" ? saleImages : publicationImages);
      markPostRobots(res, update);
      res.json(update);
    });
  }
  app.get("/api/polls/:id/qr.png", async (req, res) => {
    const poll = await store.get(req.params.id);
    if (["task", "sale"].includes(poll.type)) throw new AppError(404, "Poll not found.");
    markPostRobots(res, poll);
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
  app.get("/api/sales/:id", async (req, res) => {
    const sale = await store.get(req.params.id);
    if (sale.type !== "sale") throw new AppError(404, "Sale not found.");
    markPostRobots(res, sale);
    if (sale.pickupByRequest && sale.saleState !== "claimed" && !tokenFor(req, sale.id, "stpickup")) {
      res.cookie(cookieName(sale.id, "stpickup"), randomBytes(32).toString("hex"), {
        httpOnly: true, secure, sameSite: "strict", path: `/api/sales/${sale.id}`,
        maxAge: Math.max(0, sale.endsAt - store.clock()),
      });
    }
    res.json(sale);
  });
  app.post("/api/sales/:id/pickup-request", async (req, res) => {
    const token = tokenFor(req, req.params.id, "stpickup");
    if (!token) throw new AppError(403, "Allow cookies and reopen the giveaway to request pickup.");
    res.set({ "Cache-Control": "no-store, private, max-age=0", "X-Robots-Tag": "noindex" });
    res.json(await store.pickupRequest(req.params.id, token, req.body.action, req.body.pickupAt));
  });
  app.post("/api/sales/:id/manage", async (req, res) => {
    res.set({ "Cache-Control": "no-store, private, max-age=0", Pragma: "no-cache" });
    res.json(await store.manageSale(req.params.id, manageKeyInput(req.body)));
  });
  app.post("/api/sales/:id/state", async (req, res) => {
    const key = manageKeyInput(req.body);
    const state = await store.setSaleState(req.params.id, key, req.body.state, req.body.reservedUntil, req.body.requestId);
    res.set("Cache-Control", "no-store, private, max-age=0").json(state);
  });
  app.get("/api/sales/:id/qr.png", async (req, res) => {
    const sale = await store.get(req.params.id);
    if (sale.type !== "sale") throw new AppError(404, "Sale not found.");
    markPostRobots(res, sale);
    const png = await QRCode.toBuffer(`${origin}/sale/${sale.id}`, { type: "png", width: 768, margin: 4 });
    res.type("png").send(png);
  });
  app.get("/api/sales/:id/pickup.ics", async (req, res) => {
    const sale = await store.get(req.params.id, undefined, { expectedType: "sale" });
    if (sale.pickupByRequest || sale.saleState !== "open" || !(sale.pickupWindow?.endsAt > sale.serverTime)) {
      throw new AppError(404, "Sale not found.");
    }
    res.set("X-Robots-Tag", "noindex");
    res.attachment(`ScaleTag-pickup-${sale.id}.ics`).type("text/calendar; charset=utf-8").send(pickupCalendar(sale, origin));
  });
  app.get("/api/tasks/:id", async (req, res) => {
    const task = await store.get(req.params.id);
    if (task.type !== "task") throw new AppError(404, "Task not found.");
    markPostRobots(res, task);
    res.json(task);
  });
  // Private management: the key is accepted only in a same-origin JSON POST
  // body (see the /api origin check above), never from the URL. After key
  // verification this is the only endpoint that returns reply phone/email,
  // so it additionally forbids shared/intermediary caching.
  app.post("/api/tasks/:id/manage", async (req, res) => {
    const key = manageKeyInput(req.body);
    res.set({
      "Cache-Control": "no-store, private, max-age=0",
      Pragma: "no-cache",
    });
    res.json(await store.manageTask(req.params.id, key));
  });
  app.post("/api/tasks/:id/state", async (req, res) => {
    const { key, state } = taskStateInput(req.body);
    res.json(await store.setTaskState(req.params.id, key, state));
  });
  app.post("/api/tasks/:id/assignment", async (req, res) => {
    const key = manageKeyInput(req.body);
    const replyId = req.body.replyId;
    if (replyId !== null && (typeof replyId !== "string" || !ID_PATTERN.test(replyId)))
      throw new AppError(400, "Choose a valid task reply.");
    res.json(await store.setTaskAssignment(req.params.id, key, replyId));
  });
  app.get("/api/tasks/:id/qr.png", async (req, res) => {
    const task = await store.get(req.params.id);
    if (task.type !== "task") throw new AppError(404, "Task not found.");
    markPostRobots(res, task);
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
    markPostRobots(res, data);
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
  app.post("/api/posts/:id/reports", async (req, res) => {
    const id = req.params.id;
    const token = tokenFor(req, id, "ss");
    if (!token)
      throw new AppError(403, "Please allow this post’s anonymous cookie and reload before reporting.");
    res.json(await store.report(id, token, req.body?.reason));
  });
  let replyWindow = store.clock(),
    replyRequests = 0;
  app.post(["/api/posts/:id/replies", "/api/posts/:id/offers"], async (req, res) => {
    if (req.path.endsWith("/offers")) throw new AppError(410, "Offers are no longer accepted.");
    const token = socialToken(req),
      input = req.path.endsWith("/offers") ? offerInput(req.body) : replyInput(req.body);
    const post = await store.get(req.params.id);
    if ((post.type === "sale") !== req.path.endsWith("/offers"))
      throw new AppError(400, "Use the matching reply or offer form.");
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
  app.get("/saved", (_req, res) => res.sendFile(join(publicDir, "index.html")));
  app.get(
    ["/", "/create", "/create/task", "/create/sale", "/create/wanted", "/create/found", "/PostList", "/help", "/privacy", "/install"],
    (req, res) => sendPublicPage(req, res, "index.html"),
  );
  app.get(["/vote/:id", "/vote/:id/manage"], async (req, res) => {
    const poll = await store.get(req.params.id);
    if (["task", "sale"].includes(poll.type)) throw new AppError(404, "Poll not found.");
    if (/\/manage\/?$/i.test(req.path))
      return res.set("X-Robots-Tag", "noindex").sendFile(join(publicDir, "index.html"));
    sendPostPage(req, res, poll);
  });
  app.get(["/task/:id", "/task/:id/manage"], async (req, res) => {
    const task = await store.get(req.params.id);
    if (task.type !== "task") throw new AppError(404, "Task not found.");
    if (/\/manage\/?$/i.test(req.path))
      return res.set("X-Robots-Tag", "noindex").sendFile(join(publicDir, "index.html"));
    sendPostPage(req, res, task);
  });
  app.get(["/sale/:id", "/sale/:id/manage"], async (req, res) => {
    const sale = await store.get(req.params.id);
    if (sale.type !== "sale") throw new AppError(404, "Sale not found.");
    if (/\/manage\/?$/i.test(req.path))
      return res.set("X-Robots-Tag", "noindex").sendFile(join(publicDir, "index.html"));
    sendPostPage(req, res, sale);
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
