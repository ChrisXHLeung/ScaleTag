import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { PollStore } from "../src/store.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-task-privacy-"));
  let now = Date.now(),
    app;
  const store = new PollStore(directory, { clock: () => now });
  await store.init();
  const server = createServer((req, res) => app(req, res)).listen(
    0,
    "127.0.0.1",
  );
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp(store, { origin });
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 43.65, longitude: -79.38 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  t.after(async () => {
    await browser.close();
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true, force: true });
  });
  const input = {
    type: "task",
    title: "Help plant a community garden",
    description: "Bring a little time and a pair of gloves.",
    reward: "CAD 30 or a thank-you coffee",
    signature: "Neighbour",
  };
  return {
    origin,
    directory,
    page,
    context,
    browser,
    store,
    input,
    errors,
    advance(ms) {
      now += ms;
    },
  };
}

test("task contact privacy: zero-knowledge request bodies, password unlock, wrong password failure, and plaintext API rejection", async (t) => {
  const f = await fixture(t);
  const requests = [];
  const captureRequests = (page) => {
    page.on("request", (req) => {
      requests.push({
        method: req.method(),
        url: req.url(),
        body: req.postData() ?? "",
      });
    });
  };
  captureRequests(f.page);

  // 1. Create task via browser UI
  await f.page.goto(f.origin + "/create/task");
  await f.page.getByLabel("Title", { exact: true }).fill(f.input.title);
  await f.page
    .getByLabel("Description", { exact: true })
    .fill(f.input.description);
  await f.page.getByLabel("Reward", { exact: true }).fill(f.input.reward);
  await f.page.locator("#task-map-consent").check();
  await f.page.locator("#task-retention").check();
  await f.page.getByRole("button", { name: "Publish my task" }).click();
  await f.page.waitForURL(/\/task\/[a-f0-9]{24}\/manage\?created=1$/);
  const id = new URL(f.page.url()).pathname.split("/")[2];
  await f.page.getByRole("heading", { name: f.input.title }).waitFor();

  // Extract displayed management URL and password
  await f.page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.copiedManagement = text;
    };
  });
  await f.page.getByRole("button", { name: "Copy URL and password" }).click();
  const copied = await f.page.evaluate(() => window.copiedManagement);
  const match =
    /^Management URL: (.+)\nManagement password: ([a-f0-9]{64})$/.exec(copied);
  assert.ok(match, "Expected management URL and 64-hex password");
  const [, manageUrl, password] = match;
  assert.equal(manageUrl, `${f.origin}/task/${id}/manage`);

  // 2. Reply with phone and email on public task page
  const responder = await f.context.newPage();
  responder.on("pageerror", (e) => f.errors.push(e.message));
  captureRequests(responder);

  const phone = "+1 416 555 0199";
  const email = "private-helper@example.com";
  const phoneDigits = "4165550199";

  await responder.goto(`${f.origin}/task/${id}`);
  await responder.waitForFunction(
    () => !document.querySelector("#send-reply")?.disabled,
  );
  await responder.locator("#reply-name").fill("Garden Helper");
  await responder
    .locator("#reply-message")
    .fill("I can help on Sunday morning.");
  await responder.locator("#reply-phone").fill(phone);
  await responder.locator("#reply-email").fill(email);
  await responder.locator("#contact-consent").check();
  await responder.locator("#send-reply").click();

  await responder
    .locator("#reply-list")
    .getByText("I can help on Sunday morning.", { exact: true })
    .waitFor();
  assert.equal(await responder.locator("#reply-list .reply-contacts").count(), 0);

  // 3. Open management page, test wrong password fails, then unlock with displayed password and verify decrypted contacts
  const manager = await f.context.newPage();
  manager.on("pageerror", (e) => f.errors.push(e.message));
  captureRequests(manager);

  await manager.goto(manageUrl);
  const wrongPassword =
    (password[0] === "a" ? "b" : "a") + password.slice(1);
  await manager.getByLabel("Management password").fill(wrongPassword);
  await manager.getByRole("button", { name: "Unlock" }).click();
  await manager.getByRole("alert").filter({ hasText: "invalid" }).waitFor();
  assert.equal(await manager.locator("#private-reply-list").count(), 0);
  assert.equal(await manager.locator("[data-task-state]").count(), 0);

  await manager.getByLabel("Management password").fill(password);
  await manager.getByRole("button", { name: "Unlock" }).click();
  await manager.getByRole("heading", { name: "Manage this task" }).waitFor();

  const contactLinks = manager.locator("#private-reply-list .reply-contacts a");
  await contactLinks.first().waitFor();
  assert.equal(await contactLinks.count(), 2);
  const contactTexts = await contactLinks.allTextContents();
  assert.deepEqual(contactTexts, [`Phone: ${phone}`, `Email: ${email}`]);

  // 4. Assert no management password or contact plaintext appears in any captured browser request bodies (or URLs)
  const createReq = requests.find(
    (r) => r.method === "POST" && r.url.endsWith("/api/tasks"),
  );
  assert.ok(createReq, "Captured POST /api/tasks request");
  const createPayload = JSON.parse(createReq.body);
  assert.equal(typeof createPayload.authKey, "string");
  assert.notEqual(createPayload.authKey, password);
  assert.equal("password" in createPayload, false);
  assert.equal("manageKey" in createPayload, false);
  assert.equal(typeof createPayload.contactPublicKey, "string");
  assert.equal(typeof createPayload.encryptedPrivateKey?.ciphertext, "string");

  const replyReq = requests.find(
    (r) => r.method === "POST" && r.url.endsWith(`/api/posts/${id}/replies`),
  );
  assert.ok(replyReq, "Captured POST /api/posts/:id/replies request");
  const replyPayload = JSON.parse(replyReq.body);
  assert.equal("phone" in replyPayload, false);
  assert.equal("email" in replyPayload, false);
  assert.equal(typeof replyPayload.encryptedContact?.ciphertext, "string");
  assert.equal(typeof replyPayload.encryptedContact?.ephemeralPublicKey, "string");

  const manageReqs = requests.filter(
    (r) => r.method === "POST" && r.url.endsWith(`/api/tasks/${id}/manage`),
  );
  assert.ok(manageReqs.length >= 2, "Captured POST /api/tasks/:id/manage requests");

  for (const req of requests) {
    assert.ok(
      !req.body.includes(password),
      `Management password must not appear in request body to ${req.url}`,
    );
    assert.ok(
      !req.body.includes(wrongPassword),
      `Wrong management password must not appear in request body to ${req.url}`,
    );
    assert.ok(
      !req.body.includes(phone),
      `Plaintext phone must not appear in request body to ${req.url}`,
    );
    assert.ok(
      !req.body.includes(phoneDigits),
      `Normalized phone digits must not appear in request body to ${req.url}`,
    );
    assert.ok(
      !req.body.includes(email),
      `Plaintext email must not appear in request body to ${req.url}`,
    );
    assert.ok(
      !req.url.includes(password),
      `Management password must not appear in request URL ${req.url}`,
    );
  }

  // 5. Verify API rejects plaintext reply contact fields and contact details in public reply text
  const plaintextFieldCheck = await responder.evaluate(async (taskId) => {
    const res = await fetch(`/api/posts/${taskId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Plaintext Tester",
        message: "Trying plaintext fields",
        phone: "+1 416 555 0199",
        email: "private-helper@example.com",
        privacyAccepted: true,
      }),
    });
    return { status: res.status, data: await res.json() };
  }, id);
  assert.equal(plaintextFieldCheck.status, 400);
  assert.match(
    plaintextFieldCheck.data.error,
    /Plaintext contact details are not accepted/i,
  );

  const publicLeakCheck = await responder.evaluate(
    async ({ taskId, validEncryptedContact }) => {
      const res = await fetch(`/api/posts/${taskId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Leak Tester",
          message: "Reach me at private-helper@example.com",
          encryptedContact: validEncryptedContact,
          privacyAccepted: true,
        }),
      });
      return { status: res.status, data: await res.json() };
    },
    { taskId: id, validEncryptedContact: replyPayload.encryptedContact },
  );
  assert.equal(publicLeakCheck.status, 400);
  assert.match(publicLeakCheck.data.error, /public.*Remove the phone number or email/i);

  await responder.close();
  await manager.close();
  assert.deepEqual(f.errors, []);
});
