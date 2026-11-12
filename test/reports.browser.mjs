import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../src/app.js";
import { PollStore } from "../src/store.js";
import { createTaskCredentials } from "../public/task-crypto.js";

test("the sixth browser report blocks new requests and clears open post and management views on refresh", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-reports-browser-"));
  const store = new PollStore(directory);
  await store.init();
  let app;
  const server = createServer((req, res) => app(req, res)).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp(store, { origin });
  let browser;
  t.after(async () => {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  for (const [type, path, locale, reportLabel, reportedLabel] of [
    ["poll", "vote", "en-US", "Report this post", "Report submitted."],
    ["task", "task", "zh-CN", "举报此帖子", "举报已提交。"],
    ["sale", "sale", "en-US", "Report this post", "Report submitted."],
  ]) {
    const taskCredentials = type === "task" ? await createTaskCredentials() : undefined;
    const post = await store.create({
      title: `Browser report test for ${type}`, type,
      options: type === "poll" ? ["Yes", "No"] : [],
      images: [], description: "Details are visible before the sixth report.",
      location: { latitude: 43, longitude: -79 },
      ...(taskCredentials ? {
        authKey: taskCredentials.authKey,
        contactPublicKey: taskCredentials.contactPublicKey,
        encryptedPrivateKey: taskCredentials.encryptedPrivateKey,
        reward: "Coffee",
      } : {}),
      ...(type === "sale" ? { giveawayVersion: 1, pickupLocation: "Library" } : {}),
    });
    const url = `${origin}/${path}/${post.id}`;
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    assert.equal((await page.goto(url)).status(), 200);
    await page.getByRole("heading", { name: post.title }).waitFor();
    const report = page.getByRole("button", { name: reportLabel });
    page.once("dialog", dialog => dialog.dismiss());
    await report.click();
    assert.equal(await report.isEnabled(), true, "canceling preserves the report action");
    page.once("dialog", dialog => dialog.accept());
    await report.click();
    await page.getByText(reportedLabel, { exact: true }).waitFor();
    assert.equal(await report.isDisabled(), true);
    await page.reload();
    await page.getByText(reportedLabel, { exact: true }).waitFor();
    assert.equal(await report.isDisabled(), true);

    const opened = [page];
    if (type !== "poll") {
      const manager = await context.newPage();
      manager.setDefaultTimeout(5000);
      await manager.goto(`${url}/manage`);
      await manager.locator("#manage-password").fill(taskCredentials?.password ?? post.manageKey);
      await manager.locator("#manage-password-form button").click();
      await manager.getByRole("heading", { name: post.title }).waitFor();
      await manager.getByText(reportedLabel, { exact: true }).waitFor();
      opened.push(manager);
    }
    for (const browserId of ["second", "third", "fourth", "fifth"])
      assert.equal((await store.report(post.id, browserId)).frozen, false);
    const sixth = await browser.newContext({ locale });
    const reporter = await sixth.newPage();
    reporter.setDefaultTimeout(5000);
    assert.equal((await reporter.goto(url)).status(), 200);
    reporter.once("dialog", dialog => dialog.accept());
    await reporter.getByRole("button", { name: reportLabel }).click();
    const frozenMessage = locale === "zh-CN"
      ? "此帖子因收到举报已被永久冻结。"
      : "This post has been permanently frozen after reports.";
    await reporter.getByText(frozenMessage, { exact: true }).waitFor();
    assert.equal(await reporter.getByRole("heading", { name: post.title }).count(), 0);
    for (const observer of opened) {
      await observer.bringToFront();
      await observer.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await observer.locator(".poll-layout").waitFor({ state: "detached" });
      assert.equal(await observer.getByRole("heading", { name: post.title }).count(), 0);
      assert.equal(await observer.locator(".manage-card").count(), 0);
    }
    if (type !== "poll") {
      assert.equal((await reporter.goto(`${url}/manage`)).status(), 404);
      await reporter.getByText(frozenMessage, { exact: true }).waitFor();
    }
    await sixth.close();
    await context.close();
  }
});
