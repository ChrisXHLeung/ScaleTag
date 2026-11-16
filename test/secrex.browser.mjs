import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

test("Secrex shares a URL and password independently and keeps secrets out of local logs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "secrex-browser-"));
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { PATH: process.env.PATH, NODE_ENV: "test", PORT: String(port),
      HOST: "127.0.0.1", PUBLIC_ORIGIN: origin, STORAGE_BACKEND: "sqlite", DATA_DIR: directory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browser;
  t.after(async () => {
    await browser?.close();
    if (server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });

  const serverLogs = [], browserLogs = [], traffic = [], requestTokens = [], pending = [];
  server.stdout.on("data", data => serverLogs.push(data.toString()));
  server.stderr.on("data", data => serverLogs.push(data.toString()));
  for (let attempt = 0; ; attempt++) {
    if (await fetch(origin + "/healthz").then(response => response.ok, () => false)) break;
    assert.ok(attempt < 100 && server.exitCode === null, "Local server failed to start");
    await setTimeout(40);
  }
  browser = await chromium.launch();
  async function page(options = {}) {
    const tab = await browser.newPage({ viewport: { width: 390, height: 844 }, ...options });
    tab.on("console", message => browserLogs.push(message.text()));
    tab.on("pageerror", error => browserLogs.push(error.message));
    tab.on("request", request => {
      traffic.push(request.url(), request.postData() ?? "");
      pending.push(request.allHeaders().then(headers => traffic.push(JSON.stringify(headers))));
      if (request.url().startsWith(origin + "/api/secrex") && request.method() === "POST") {
        const { claim, session } = request.postDataJSON();
        if (claim) requestTokens.push(claim);
        if (session) requestTokens.push(session);
      }
    });
    tab.on("response", response => {
      if (response.url().startsWith(origin + "/api/") && !response.url().endsWith("/qr.png"))
        pending.push(response.text().then(body => traffic.push(body), () => {}));
    });
    return tab;
  }
  const sender = await page({ locale: "zh-CN" });
  const receiver = await page();
  const other = await page();
  const plaintext = "secrex-test-marker-" + randomBytes(16).toString("hex");
  await sender.setViewportSize({ width: 320, height: 844 });
  await sender.goto(origin + "/create");
  assert.equal(await sender.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await sender.locator(".post-kind-switch").getByRole("link", { name: /Secrex/ }).click();
  await sender.waitForURL("**/secrex");
  await sender.getByLabel("Secret text", { exact: true }).fill(plaintext);
  await sender.getByRole("button", { name: "Create secret" }).click();
  const link = sender.getByLabel("Share link", { exact: true });
  await link.waitFor();
  const url = await link.inputValue();
  const password = await sender.getByLabel("Share password", { exact: true }).inputValue();
  assert.match(password, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(url).hash, "");
  assert.match(new URL(url).pathname, /^\/secrex\/[A-Za-z0-9_-]{22}$/);
  const qr = sender.getByRole("img", { name: "QR code for the share link" });
  assert.equal(await qr.getAttribute("src"), "/api" + new URL(url).pathname + "/qr.png");
  await sender.waitForFunction(() => document.querySelector("#secrex-qr")?.naturalWidth > 0);
  assert.equal(await sender.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  await receiver.goto(url);
  await receiver.getByLabel("Share password").fill(randomBytes(32).toString("base64url"));
  await receiver.getByRole("button", { name: "View secret" }).click();
  await receiver.getByRole("status").filter({ hasText: /incorrect/ }).waitFor();
  await receiver.getByLabel("Share password").fill(password);
  await receiver.getByRole("button", { name: "View secret" }).click();
  await receiver.getByText(plaintext, { exact: true }).waitFor();
  await other.goto(url);
  await other.getByLabel("Share password").fill(password);
  await other.getByRole("button", { name: "View secret" }).click();
  await other.getByRole("status").filter({ hasText: /unavailable/ }).waitFor();
  assert.equal(await other.getByText(plaintext, { exact: true }).count(), 0);
  const dbBytes = await readFile(join(directory, "secrex.sqlite"));
  assert.ok(!dbBytes.includes(plaintext) && !dbBytes.includes(password));
  await receiver.getByRole("button", { name: "End and destroy" }).click();
  await receiver.getByRole("status").filter({ hasText: "Secret destroyed." }).waitFor();
  assert.equal(await receiver.getByText(plaintext, { exact: true }).count(), 0);

  await Promise.all(pending);
  assert.ok([plaintext, password].every(value => !traffic.join("\n").includes(value)), "Secret in HTTP traffic");
  const allLogs = [...browserLogs, ...serverLogs].join("\n");
  assert.ok([plaintext, password, ...requestTokens].every(value => !allLogs.includes(value)), "Secret in local logs");
});
