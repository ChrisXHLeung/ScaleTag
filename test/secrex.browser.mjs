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
    tab.setDefaultTimeout(15000);
    tab.on("console", message => browserLogs.push(message.text()));
    tab.on("pageerror", error => browserLogs.push(error.message));
    tab.on("request", request => {
      traffic.push(request.url(), request.postData() ?? "");
      pending.push(request.allHeaders().then(headers => traffic.push(JSON.stringify(headers))));
      if (request.url().startsWith(origin + "/api/secrex") && request.method() === "POST") {
        const { claim, session, revoke } = request.postDataJSON();
        if (claim) requestTokens.push(claim);
        if (session) requestTokens.push(session);
        if (revoke) requestTokens.push(revoke);
      }
    });
    tab.on("response", response => {
      // The page does not read unsuccessful or bodyless API responses.
      if (response.ok() && response.status() !== 204 && response.url().startsWith(origin + "/api/") && !response.url().endsWith("/qr.png"))
        pending.push(response.text().then(body => traffic.push(body), () => {}));
    });
    return tab;
  }
  const sender = await page({ locale: "zh-CN" });
  const receiver = await page();
  const other = await page();
  const plaintext = "secrex-test-marker-" + randomBytes(16).toString("hex");
  await sender.setViewportSize({ width: 1440, height: 900 });
  await sender.goto(origin + "/");
  await sender.locator(".home-actions").waitFor();
  assert.equal(await sender.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const gridBoxes = await sender.locator(".home-actions .button").evaluateAll((buttons) =>
    buttons.map((b) => {
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), overflows: b.scrollWidth > b.clientWidth };
    }),
  );
  assert.equal(gridBoxes.length, 4);
  assert.equal(gridBoxes[0].y, gridBoxes[1].y);
  assert.equal(gridBoxes[2].y, gridBoxes[3].y);
  assert.equal(gridBoxes[0].x, gridBoxes[2].x);
  assert.equal(gridBoxes[1].x, gridBoxes[3].x);
  assert.ok(gridBoxes.every((b) => !b.overflows));
  await sender.setViewportSize({ width: 320, height: 844 });
  assert.equal(await sender.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await sender.locator(".home-actions").getByRole("link", { name: /Secrex/ }).getAttribute("href"), "/secrex");
  assert.equal(await sender.locator(".home-story-links").getByRole("link", { name: /Secrex/ }).getAttribute("href"), "/secrex");
  await sender.goto(origin + "/create");
  assert.equal(await sender.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await sender.locator(".post-kind-switch").getByRole("link", { name: /Secrex/ }).click();
  await sender.waitForURL("**/secrex");
  await sender.locator(".create-section").waitFor();
  assert.equal(await sender.locator(".post-kind-switch a").count(), 4);
  assert.equal(await sender.locator(".post-kind-switch").getByRole("link", { name: /Secrex/ }).getAttribute("aria-current"), "page");
  await sender.locator(".secrex-guide").getByText("什么是 Secrex").waitFor();
  assert.equal(await sender.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await sender.getByLabel(/Secret text|私密内容/, { exact: true }).fill(plaintext);
  await sender.getByRole("button", { name: /Create secret|生成加密信息/ }).click();
  const link = sender.getByLabel(/Share link|分享链接/, { exact: true });
  await link.waitFor();
  const url = await link.inputValue();
  const password = await sender.getByLabel(/Share password|分享密码/, { exact: true }).inputValue();
  const openedCode = await sender.locator("#secrex-generated-revoke-code").inputValue();
  assert.match(openedCode, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.match(password, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(url).hash, "");
  assert.match(new URL(url).pathname, /^\/secrex\/[A-Za-z0-9_-]{22}$/);
  const qr = sender.getByRole("img", { name: /QR code for the share link|分享链接二维码/ });
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

  const revokingSender = await page();
  await revokingSender.goto(origin + "/secrex");
  await revokingSender.getByLabel("Secret text", { exact: true }).fill(plaintext);
  await revokingSender.getByRole("button", { name: "Create secret" }).click();
  const privateCode = revokingSender.getByLabel("Private revoke code", { exact: true });
  await privateCode.waitFor();
  const unopenedCode = await privateCode.inputValue();
  const unopenedUrl = await revokingSender.getByLabel("Share link", { exact: true }).inputValue();
  const unopenedPassword = await revokingSender.getByLabel("Share password", { exact: true }).inputValue();
  const [unopenedId, unopenedKey] = unopenedCode.split(".");
  assert.equal(new URL(unopenedUrl).pathname, `/secrex/${unopenedId}`);
  assert.notEqual(unopenedKey, unopenedPassword);
  assert.ok(!unopenedUrl.includes(unopenedKey));
  assert.ok(!(await revokingSender.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(unopenedKey));
  assert.ok(!(await readFile(join(directory, "secrex.sqlite"))).includes(unopenedKey));

  // The sender can return later in a separate tab with only their saved code.
  const revokeTab = await page();
  await revokeTab.goto(origin + "/secrex");
  await revokeTab.getByText("Revoke a previously created secret", { exact: true }).click();
  const revokeInput = revokeTab.getByLabel("Enter your private revoke code");
  await revokeInput.fill(openedCode);
  const revokeButton = revokeTab.getByRole("button", { name: "Revoke unopened secret" });
  await revokeButton.click();
  await revokeTab.getByRole("status").filter({ hasText: /cannot be revoked/ }).waitFor();
  await revokeInput.fill(unopenedCode);
  await revokeButton.click();
  await revokeTab.getByRole("status").filter({ hasText: "Secret revoked." }).waitFor();
  assert.equal(await revokeInput.inputValue(), "");
  await other.goto(unopenedUrl);
  await other.getByLabel("Share password").fill(unopenedPassword);
  await other.getByRole("button", { name: "View secret" }).click();
  await other.getByRole("status").filter({ hasText: /unavailable/ }).waitFor();
  assert.equal(await other.getByText(plaintext, { exact: true }).count(), 0);

  await Promise.all(pending);
  assert.ok([plaintext, password, unopenedPassword, openedCode, unopenedCode].every(value => !traffic.join("\n").includes(value)), "Secret in HTTP traffic");
  const allLogs = [...browserLogs, ...serverLogs].join("\n");
  assert.ok([plaintext, password, ...requestTokens].every(value => !allLogs.includes(value)), "Secret in local logs");
});

test("Secrex supports revoke-code copy fallback and password visibility toggles with auto-masking", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "secrex-toggle-browser-"));
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

  const pageErrors = [];
  for (let attempt = 0; ; attempt++) {
    if (await fetch(origin + "/healthz").then(response => response.ok, () => false)) break;
    assert.ok(attempt < 100 && server.exitCode === null, "Local server failed to start");
    await setTimeout(40);
  }
  browser = await chromium.launch();
  async function page(options = {}) {
    const tab = await browser.newPage({ viewport: { width: 390, height: 844 }, ...options });
    tab.setDefaultTimeout(15000);
    tab.on("pageerror", error => pageErrors.push(error.message));
    return tab;
  }

  const sender = await page();
  const plaintext = "secrex-toggle-marker-" + randomBytes(16).toString("hex");
  await sender.goto(origin + "/secrex");
  await sender.getByLabel("Secret text", { exact: true }).fill(plaintext);
  await sender.getByRole("button", { name: "Create secret" }).click();
  const copyRevokeButton = sender.locator("#secrex-copy-revoke-code");
  await copyRevokeButton.waitFor();
  const url = await sender.getByLabel("Share link", { exact: true }).inputValue();
  const password = await sender.getByLabel("Share password", { exact: true }).inputValue();
  const generatedCode = await sender.locator("#secrex-generated-revoke-code").inputValue();
  await sender.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("Clipboard denied"));
  });
  await copyRevokeButton.click();
  await sender.getByRole("status").filter({ hasText: "Use your browser’s copy command." }).waitFor();
  const copyFallback = await sender.evaluate(() => {
    const field = document.querySelector("#secrex-generated-revoke-code");
    return {
      focused: document.activeElement === field,
      selectionStart: field.selectionStart,
      selectionEnd: field.selectionEnd,
      length: field.value.length,
    };
  });
  assert.equal(copyFallback.focused, true);
  assert.equal(copyFallback.selectionStart, 0);
  assert.equal(copyFallback.selectionEnd, copyFallback.length);

  await sender.getByText("Revoke a previously created secret", { exact: true }).click();
  const revokeInput = sender.locator("#secrex-revoke-code");
  const revokeToggle = sender.locator("#secrex-revoke-code-toggle");
  await revokeInput.fill(generatedCode);
  assert.equal(await revokeInput.getAttribute("type"), "password");
  assert.equal(await revokeToggle.textContent(), "Show password");
  assert.equal(await revokeToggle.getAttribute("aria-pressed"), null);
  assert.equal(await revokeToggle.getAttribute("aria-controls"), "secrex-revoke-code");
  await revokeToggle.click();
  assert.equal(await revokeInput.getAttribute("type"), "text");
  assert.equal(await revokeToggle.textContent(), "Hide password");
  assert.equal(await revokeToggle.getAttribute("aria-pressed"), null);
  assert.equal(await sender.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await sender.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  assert.equal(await revokeInput.getAttribute("type"), "password");
  assert.equal(await revokeToggle.textContent(), "Show password");

  const receiver = await page();
  await receiver.goto(url);
  const passwordInput = receiver.locator("#secrex-password");
  const passwordToggle = receiver.locator("#secrex-password-toggle");
  await passwordInput.fill(password);
  assert.equal(await passwordInput.getAttribute("type"), "password");
  assert.equal(await passwordToggle.textContent(), "Show password");
  assert.equal(await passwordToggle.getAttribute("aria-pressed"), null);
  assert.equal(await passwordToggle.getAttribute("aria-controls"), "secrex-password");
  await passwordToggle.click();
  assert.equal(await passwordInput.getAttribute("type"), "text");
  assert.equal(await passwordToggle.textContent(), "Hide password");
  assert.equal(await passwordToggle.getAttribute("aria-pressed"), null);
  assert.equal(await receiver.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await receiver.locator("#secrex-view").click();
  assert.equal(await passwordInput.getAttribute("type"), "password");
  assert.equal(await passwordToggle.textContent(), "Show password");
  await receiver.getByText(plaintext, { exact: true }).waitFor();
  assert.equal(await receiver.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(pageErrors, []);
});
