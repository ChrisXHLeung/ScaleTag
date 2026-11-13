import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { PollStore } from "../src/store.js";
import { createApp } from "../src/app.js";
import {
  BLOCKED_PUBLIC_TEXT_SUFFIX,
  pollInput,
  taskInput,
  saleInput,
  replyInput,
} from "../src/validation.js";
import {
  WORDLIST_FILES,
  loadBlockedTerms,
  containsBlockedTerm,
} from "../src/word-filter.js";
import { translateError } from "../public/locale.js";
import {
  createTaskCredentials,
  encryptReplyContact,
} from "../public/task-crypto.js";

const origin = "https://scaletag.test";
const baseLocation = { latitude: 43.6532, longitude: -79.3832 };

async function startFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-filter-"));
  const now = Date.UTC(2026, 10, 13, 12);
  const store = new PollStore(directory, {
    clock: () => now,
    diskReserveBytes: 0,
  });
  await store.init();
  const server = createApp(store, { origin, createLimit: 100 }).listen(
    0,
    "127.0.0.1",
  );
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path, data, cookie) =>
    fetch(url + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        ...(data === undefined
          ? {}
          : { origin, "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  return { store, request };
}

test("wordlists load from data/ldnoobw for all four configured languages", () => {
  assert.deepEqual(WORDLIST_FILES, ["en", "zh", "fr", "fr-CA-u-sd-caqc"]);
  const terms = loadBlockedTerms();
  assert.ok(terms.length >= 750);
  for (const sample of [
    "fuck",
    "三级片",
    "性交",
    "乳交",
    "奶子",
    "鸡8",
    "13点",
    "merde",
    "tabarnak",
  ]) {
    assert.ok(terms.includes(sample), `Expected ${sample} in loaded terms`);
  }
  for (const omitted of ["性", "奶", "乳", "卵", "𨳒", "13."]) {
    assert.equal(
      terms.includes(omitted),
      false,
      `Expected ${omitted} to be omitted from loaded terms`,
    );
  }
});

test("multilingual matching blocks terms in en, zh, fr, and fr-CA-u-sd-caqc", () => {
  const blockedSamples = [
    // en
    "fuck",
    "SHIT",
    "ｆｕｃｋ",
    "This is bullshit!",
    "blow   job",
    "eat\nmy ass",
    "g-spot",
    "s&m",
    "🖕",
    "你好fuck世界",
    // zh (multi-character and letter-bearing terms)
    "三级片",
    "不要看三级片",
    "他妈的",
    "性交",
    "禁止发送性交广告",
    "奶子",
    "乳交",
    "王八蛋",
    "傻逼",
    "卖B",
    "去卖B吧",
    "干死CS",
    "你13点啊",
    "别骂鸡8",
    // fr
    "merde",
    "étron",
    "e\u0301tron",
    "péter",
    "pe\u0301ter",
    "nique ta mère",
    "pousse-crotte",
    "malpt",
    // fr-CA-u-sd-caqc
    "tabarnak",
    "osti",
    "criss",
    "crisse",
    "calice",
    "viarge",
    "noune",
  ];
  for (const sample of blockedSamples) {
    assert.equal(
      containsBlockedTerm(sample),
      true,
      `Expected blocked match for ${JSON.stringify(sample)}`,
    );
  }
});

test("Latin word boundaries and script rules avoid matching inside innocent words and normal Chinese phrases", () => {
  const innocentSamples = [
    "Class assessment document",
    "Analysis of cucumber cocktails",
    "Title petition constitution",
    "Posting diagnostic culture conditions",
    "Second contact about Scunthorpe and Pakistan",
    "Peter and Peterson picked grapes",
    "Raccoon and calico crisps",
    "Crisscross hostile frosting",
    "Sussex therapist mishit Exxon",
    "Orbit habit bitten",
    "CAD 13.50 for 13.5 km at 2013点",
    "13. Bring work gloves on Nov 13.",
    "13.",
    "去卖Book，不要干死CSV",
    "牛奶",
    "安全性",
    "可能性",
    "乳酪",
    "卵石",
    "逼真",
    "新鲜牛奶和乳酪，安全性很有保障。",
    "周末一起去公园植树吧，我可以带工具。",
    "请问明天上午十点方便在图书馆北门外取椅子吗？",
    // Documented gap: standalone single Han-character entries are omitted generically.
    "性",
    "奶",
    "𨳒",
  ];
  for (const sample of innocentSamples) {
    assert.equal(
      containsBlockedTerm(sample),
      false,
      `Expected innocent text to pass: ${JSON.stringify(sample)}`,
    );
  }
});

test("validation functions reject blocked public text with clear errors and accept innocent text", async () => {
  const { authKey, contactPublicKey, encryptedPrivateKey } =
    await createTaskCredentials();
  const validPoll = {
    title: "Class assessment poll",
    description: "Analysis of cucumber cocktails.",
    signature: "Peter",
    options: ["Diagnostic", "Condition"],
    images: [],
    location: baseLocation,
    retentionAccepted: true,
  };
  assert.equal(pollInput(validPoll).signature, "Peter");
  assert.throws(
    () => pollInput({ ...validPoll, options: ["Diagnostic", "osti"] }),
    { status: 400, message: `Option ${BLOCKED_PUBLIC_TEXT_SUFFIX}` },
  );

  const validTask = {
    title: "Help move a raccoon sculpture",
    description: "Posting near the culture hall.",
    reward: "CAD 13.50",
    signature: "Peterson",
    images: [],
    location: baseLocation,
    retentionAccepted: true,
    authKey,
    contactPublicKey,
    encryptedPrivateKey,
  };
  assert.equal(taskInput(validTask).reward, "CAD 13.50");
  assert.throws(() => taskInput({ ...validTask, reward: "他妈的" }), {
    status: 400,
    message: `Reward ${BLOCKED_PUBLIC_TEXT_SUFFIX}`,
  });

  const validSale = {
    title: "Free calico cushion",
    description: "Good condition, clean.",
    pickupLocation: "Second bench near Scunthorpe Park",
    signature: "Peter",
    location: baseLocation,
    retentionAccepted: true,
  };
  assert.equal(saleInput(validSale).title, "Free calico cushion");
  assert.throws(
    () => saleInput({ ...validSale, pickupLocation: "Near 傻逼 hall" }),
    { status: 400, message: `Pickup location ${BLOCKED_PUBLIC_TEXT_SUFFIX}` },
  );

  const encryptedContact = await encryptReplyContact(
    contactPublicKey,
    { email: "helper@example.com" },
    "a".repeat(24),
  );
  const validReply = {
    name: "Peter",
    message: "I can help with the class analysis.",
    encryptedContact,
    privacyAccepted: true,
  };
  assert.equal(replyInput(validReply).name, "Peter");
  assert.throws(() => replyInput({ ...validReply, name: "crisse" }), {
    status: 400,
    message: `Name ${BLOCKED_PUBLIC_TEXT_SUFFIX}`,
  });
});

test("error translation supports English and Chinese blocked-text errors", () => {
  const enMsg = `Title ${BLOCKED_PUBLIC_TEXT_SUFFIX}`;
  assert.equal(translateError(enMsg, "en"), enMsg);
  assert.equal(
    translateError(enMsg, "zh"),
    "标题包含公开内容不允许使用的词语，请修改后重试。",
  );
  assert.equal(
    translateError(`Pickup location ${BLOCKED_PUBLIC_TEXT_SUFFIX}`, "zh"),
    "领取地点包含公开内容不允许使用的词语，请修改后重试。",
  );
});

test("direct API submissions block terms across all post types and replies without persisting", async (t) => {
  const f = await startFixture(t);

  // 1. Direct POST /api/polls rejections across en, zh, fr, fr-CA-u-sd-caqc
  const basePoll = {
    title: "Community garden schedule?",
    description: "Saturday morning works well.",
    signature: "Peter",
    options: ["Morning", "Afternoon"],
    images: [],
    location: baseLocation,
    retentionAccepted: true,
  };
  for (const [field, overrides, term] of [
    ["Title", { title: "Should we allow fuck here?" }, "fuck"],
    ["Description", { description: "不要看三级片" }, "三级片"],
    ["Signature", { signature: "tabarnak" }, "tabarnak"],
    ["Option", { options: ["Morning", "merde"] }, "merde"],
  ]) {
    const res = await f.request("/api/polls", { ...basePoll, ...overrides });
    assert.equal(res.status, 400, field);
    const body = await res.json();
    assert.equal(body.error, `${field} ${BLOCKED_PUBLIC_TEXT_SUFFIX}`);
    assert.ok(!body.error.includes(term));
  }
  assert.equal(f.store.count(), 0);

  const okPoll = await f.request("/api/polls", {
    ...basePoll,
    title: "Class assessment in Pakistan",
    description: "Diagnostic posting for culture week. 周末一起去公园植树吧。",
  });
  assert.equal(okPoll.status, 201);

  // 2. Direct POST /api/tasks rejections and innocent acceptance
  const creds = await createTaskCredentials();
  const baseTask = {
    title: "Move planters in the courtyard",
    description: "Posting details for Saturday.",
    reward: "CAD 13.50",
    signature: "Peter",
    images: [],
    location: baseLocation,
    mapVisible: true,
    retentionAccepted: true,
    authKey: creds.authKey,
    contactPublicKey: creds.contactPublicKey,
    encryptedPrivateKey: creds.encryptedPrivateKey,
  };
  for (const [field, overrides] of [
    ["Title", { title: "Help with osti" }],
    ["Description", { description: "Need a bullshit check" }],
    ["Reward", { reward: "他妈的 30" }],
    ["Signature", { signature: "enculé" }],
  ]) {
    const res = await f.request("/api/tasks", { ...baseTask, ...overrides });
    assert.equal(res.status, 400, field);
    assert.equal(
      (await res.json()).error,
      `${field} ${BLOCKED_PUBLIC_TEXT_SUFFIX}`,
    );
  }
  assert.equal(f.store.count(), 1);

  const okTaskRes = await f.request("/api/tasks", baseTask);
  assert.equal(okTaskRes.status, 201);
  const task = await okTaskRes.json();

  // 3. Direct POST /api/sales rejections and innocent acceptance
  const baseSale = {
    title: "Free reading chair",
    description: "Good condition, clean fabric.",
    pickupLocation: "North library entrance",
    signature: "Peter",
    images: [],
    location: baseLocation,
    mapVisible: true,
    retentionAccepted: true,
  };
  for (const [field, overrides] of [
    ["Title", { title: "Free viarge" }],
    ["Description", { description: "No putain" }],
    ["Pickup location", { pickupLocation: "Near 傻逼 street" }],
    ["Signature", { signature: "asshole" }],
  ]) {
    const res = await f.request("/api/sales", { ...baseSale, ...overrides });
    assert.equal(res.status, 400, field);
    assert.equal(
      (await res.json()).error,
      `${field} ${BLOCKED_PUBLIC_TEXT_SUFFIX}`,
    );
  }
  assert.equal(f.store.count(), 2);

  const okSale = await f.request("/api/sales", {
    ...baseSale,
    description: "Second chair, classic document stand included.",
  });
  assert.equal(okSale.status, 201);

  // 4. Direct POST /api/posts/:id/replies rejections and innocent acceptance
  const socialRes = await f.request(`/api/posts/${task.id}/social`);
  const cookie = socialRes.headers.get("set-cookie").split(";")[0];
  const encryptedContact = await encryptReplyContact(
    creds.contactPublicKey,
    { email: "helper@example.com" },
    task.id,
  );
  for (const [field, overrides] of [
    ["Reply", { message: "You are a bitch" }],
    ["Reply", { message: "去卖B" }],
    ["Reply", { message: "Quel connard" }],
    ["Name", { name: "crisse", message: "I can help." }],
  ]) {
    const res = await f.request(
      `/api/posts/${task.id}/replies`,
      {
        name: "Peter",
        encryptedContact,
        privacyAccepted: true,
        ...overrides,
      },
      cookie,
    );
    assert.equal(res.status, 400, field);
    assert.equal(
      (await res.json()).error,
      `${field} ${BLOCKED_PUBLIC_TEXT_SUFFIX}`,
    );
  }
  const socialBefore = await (
    await f.request(`/api/posts/${task.id}/social`, undefined, cookie)
  ).json();
  assert.equal(socialBefore.replies.length, 0);

  const okReply = await f.request(
    `/api/posts/${task.id}/replies`,
    {
      name: "Peter",
      message:
        "I can help with the class analysis at CAD 13.50. 周末一起去公园植树吧。",
      encryptedContact,
      privacyAccepted: true,
    },
    cookie,
  );
  assert.equal(okReply.status, 201);
  const socialAfter = await okReply.json();
  assert.equal(socialAfter.replies.length, 1);
  assert.equal(socialAfter.replies[0].name, "Peter");
});
