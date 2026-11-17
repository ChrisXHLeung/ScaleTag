import { t, icons } from "/common.js";
import {
  decryptSecret,
  deriveClaim,
  encryptSecret,
  generateSessionToken,
  isValidId,
  isValidPassword,
} from "./secrex-crypto.js";

const main = document.querySelector("main");

async function post(path, payload) {
  const result = await fetch("/api/secrex" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) {
    if (result.status === 404) throw new Error("UNAVAILABLE");
    if (result.status === 429) throw new Error("BUSY");
    throw new Error("REQUEST_FAILED");
  }
  return result.status === 204 ? undefined : result.json();
}

function copy(button, field, status) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = t("Copied.", "已复制。");
    } catch {
      field.select();
      status.textContent = t(
        "Use your browser’s copy command.",
        "请使用浏览器的复制功能。",
      );
    }
  });
}

function createView() {
  document.title = t(
    "Secrex — One-time encrypted secret — ScaleTag",
    "Secrex 阅后即焚 — ScaleTag",
  );
  document.querySelector('[data-nav="create"]')?.classList.add("active");
  main.innerHTML = `<section class="create-section">
    <aside class="section-intro">
      <a class="back-link" href="/">${t("← Back to home", "← 返回首页")}</a>
      <span class="eyebrow">${t("ONE-TIME ENCRYPTED SECRET", "阅后即焚 · 浏览器端加密")}</span>
      <h1>${t("Share once.<br>Leave <em>no trace.</em>", "看一次，<br><em>即刻销毁。</em>")}</h1>
      <p>${t(
        "Encrypt sensitive text directly in your browser. Only one recipient can open it once with both the share link and separate password, and it is permanently destroyed right after.",
        "在浏览器本地加密敏感文本，不上传明文。收件人需同时使用分享链接和独立密码才可打开，且仅限一次阅读，读完或到期后即刻销毁。",
      )}</p>
      <div class="intro-note">
        <span class="tiny-label">${t("HOW SECREX WORKS", "工作原理与安全保障")}</span>
        <p>${t(
          "Your browser generates a random key and encrypts the text with AES-GCM before anything leaves your device. The server stores only ciphertext and cannot decrypt it.",
          "你的浏览器会随机生成密钥并在本地完成 AES-GCM 加密。服务器仅保存密文和哈希验证值，无法查看或解密任何内容。",
        )}</p>
      </div>
      <div class="rules">
        <p>${icons.shield} ${t(
          "End-to-end browser encryption; server never sees plaintext.",
          "浏览器端加密，服务器永远接触不到明文和分享密码。",
        )}</p>
        <p>${icons.clock} ${t(
          "Single reading session (~5 min); expires in 24 hours if unread.",
          "仅限单次阅读（约 5 分钟），无人打开 24 小时后自动销毁。",
        )}</p>
        <p>${icons.qr} ${t(
          "Share the link/QR code and password through separate channels.",
          "请尽量通过不同渠道分别发送链接/二维码与分享密码。",
        )}</p>
      </div>
    </aside>
    <div class="form-card secrex-card">
      <div class="post-kind-switch" aria-label="${t("Post type", "发布类型")}">
        <a href="/create">${t("Poll", "投票")}</a>
        <a href="/create/task">${t("Task", "任务")}</a>
        <a href="/create/sale">${t("Free Giveaways", "闲置赠予")}</a>
        <a href="/secrex" aria-current="page">${t("Secrex", "Secrex 阅后即焚")}</a>
      </div>
      <div class="form-heading">
        <h2>${t("Create a one-time secret", "创建阅后即焚私密信息")}</h2>
        <span class="pill">${t("BURN AFTER READING", "阅后即焚")}</span>
      </div>
      <section class="secrex-guide" aria-label="${t("About Secrex", "关于 Secrex")}">
        <h3>${t("What is Secrex?", "什么是 Secrex？")}</h3>
        <p>${t(
          "Secrex lets you share passwords, keys, addresses, or private notes safely without an account. Unlike public polls or tasks, your secret is never listed publicly and self-destructs after one reading.",
          "Secrex 用于安全传递账号密码、密钥、地址或私人备注，无需注册。与公开的投票、任务或闲置赠予不同，Secrex 不会出现在帖子列表中，且在单次阅读后永久销毁。",
        )}</p>
        <ol class="secrex-steps">
          <li><strong>${t("Encrypt locally", "本地加密")}</strong> — ${t(
            "Your text is encrypted in your browser; only ciphertext is sent to the server.",
            "内容在发送前于你的浏览器完成加密，服务器仅存密文。",
          )}</li>
          <li><strong>${t("Share via two channels", "分开传递")}</strong> — ${t(
            "Send the link or QR code in one chat, and send the generated password separately. Neither works alone.",
            "建议将分享链接或二维码与系统生成的分享密码分开发送，缺少其一都无法解密。",
          )}</li>
          <li><strong>${t("Read once & destroy", "一次阅读即销毁")}</strong> — ${t(
            "Once unlocked, other visitors are blocked immediately. The secret is erased when the reader clicks End and destroy or the short timer ends.",
            "一方解锁后其他人即无法打开；阅读者点击“结束并销毁”或短时会话到期后，密文将被永久删除。",
          )}</li>
        </ol>
      </section>
      <div id="secrex-compose" class="secrex-fields">
        <label for="secrex-text">${t("Secret text", "私密内容")}</label>
        <textarea id="secrex-text" rows="7" maxlength="12000" autocomplete="off"
          autocapitalize="off" spellcheck="false"
          placeholder="${t(
            "Enter passwords, private notes, or sensitive text (max 12,000 bytes)…",
            "输入密码、私钥、私人备注等敏感内容（不超过 12,000 字节）…",
          )}"></textarea>
        <p class="field-hint">${t(
          "Encrypted in your browser with AES-256-GCM before upload. Never appears in PostList.",
          "提交前将在浏览器使用 AES-256-GCM 加密，绝不会出现在帖子列表中。",
        )}</p>
        <button id="secrex-create" class="button publish-button" type="button">${t("Create secret", "生成加密信息")} ${icons.arrow}</button>
      </div>
      <div id="secrex-share" class="secrex-fields" hidden>
        <p class="secrex-share-note">${t(
          "Send the link or QR code. Share the password separately when possible — both are required to read.",
          "发送下方链接或二维码，并尽量通过另一渠道发送分享密码。必须同时持有链接和密码才能查看。",
        )}</p>
        <label for="secrex-link">${t("Share link", "分享链接")}</label>
        <div class="secrex-copy">
          <input id="secrex-link" type="text" readonly>
          <button id="secrex-copy-link" class="button secondary small" type="button">${t("Copy link", "复制链接")}</button>
        </div>
        <label for="secrex-generated-password">${t("Share password", "分享密码")}</label>
        <div class="secrex-copy">
          <input id="secrex-generated-password" type="text" readonly autocomplete="off"
            spellcheck="false" autocapitalize="off">
          <button id="secrex-copy-password" class="button secondary small" type="button">${t("Copy password", "复制密码")}</button>
        </div>
        <img id="secrex-qr" width="192" height="192" alt="${t("QR code for the share link", "分享链接二维码")}">
        <p class="secrex-note">${t(
          "The link expires after 24 hours if nobody opens it. Once opened, it locks to that single reading session and is destroyed right after.",
          "如果 24 小时内无人打开，链接将自动过期失效。一旦有人打开，其他会话将被拒绝，阅读结束即销毁。",
        )}</p>
        <a class="secrex-new text-link" href="/secrex">${t("Create another secret", "再创建一条密信")}</a>
      </div>
      <p class="secrex-status" role="status" aria-live="polite"></p>
    </div>
  </section>`;

  const status = main.querySelector(".secrex-status");
  const compose = document.querySelector("#secrex-compose");
  const text = document.querySelector("#secrex-text");
  const button = document.querySelector("#secrex-create");
  const share = document.querySelector("#secrex-share");
  const link = document.querySelector("#secrex-link");
  const password = document.querySelector("#secrex-generated-password");
  const qr = document.querySelector("#secrex-qr");
  let leaving = false;
  copy(document.querySelector("#secrex-copy-link"), link, status);
  copy(document.querySelector("#secrex-copy-password"), password, status);
  button.addEventListener("click", async () => {
    if (!text.value.trim()) {
      status.textContent = t(
        "Enter the text you want to share.",
        "请输入要分享的私密内容。",
      );
      text.focus();
      return;
    }
    if (new TextEncoder().encode(text.value).byteLength > 12000) {
      status.textContent = t(
        "This secret is too long. Shorten it and try again.",
        "内容过长，请精简后再试。",
      );
      return;
    }
    button.disabled = true;
    text.readOnly = true;
    status.textContent = t("Encrypting…", "正在本地加密…");
    try {
      const sealed = await encryptSecret(text.value);
      await post("/", sealed.payload);
      if (leaving) return;
      text.value = "";
      link.value = new URL(`/secrex/${sealed.id}`, location.origin).href;
      password.value = sealed.password;
      qr.src = `/api/secrex/${sealed.id}/qr.png`;
      compose.hidden = true;
      share.hidden = false;
      status.textContent = t(
        "Your secret is ready to share.",
        "加密信息已生成，可以分享。",
      );
      link.focus();
    } catch (error) {
      if (!leaving)
        status.textContent =
          error.message === "BUSY"
            ? t(
                "Secrex is busy. Try again shortly.",
                "服务正忙，请稍后重试。",
              )
            : t(
                "Could not create the secret. Try again.",
                "无法生成加密信息，请重试。",
              );
    } finally {
      button.disabled = false;
      text.readOnly = false;
    }
  });
  window.addEventListener(
    "pagehide",
    () => {
      leaving = true;
      text.value = "";
      password.value = "";
      link.value = "";
      qr.removeAttribute("src");
    },
    { once: true },
  );
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
}

function readView(id) {
  document.title = t(
    "Open encrypted secret — Secrex — ScaleTag",
    "查看阅后即焚信息 — Secrex — ScaleTag",
  );
  main.innerHTML = `<section class="create-section">
    <aside class="section-intro">
      <a class="back-link" href="/">${t("← Back to home", "← 返回首页")}</a>
      <span class="eyebrow">${t("ONE-TIME ENCRYPTED SECRET", "阅后即焚 · 一次性阅读")}</span>
      <h1>${t("Open once.<br>Destroyed <em>after.</em>", "仅限一次，<br><em>阅后即焚。</em>")}</h1>
      <p>${t(
        "Someone shared a browser-encrypted secret with you via Secrex. Enter the separate share password to decrypt it locally.",
        "有人通过 Secrex 向你分享了一条浏览器端加密信息。输入独立分享密码即可在本地解密查看。",
      )}</p>
      <div class="intro-note">
        <span class="tiny-label">${t("SINGLE READING SESSION", "单次阅读会话")}</span>
        <p>${t(
          "Unlocking binds this secret to your current tab for a short reading window and locks out anyone else. Click End and destroy when finished.",
          "解锁后仅当前标签页可在短时间内查看，其他人将无法再打开。看完后可立即点击“结束并销毁”。",
        )}</p>
      </div>
      <div class="rules">
        <p>${icons.shield} ${t(
          "Decrypted strictly inside your browser using your share password.",
          "仅使用你的分享密码在浏览器本地完成解密。",
        )}</p>
        <p>${icons.clock} ${t(
          "Reading window closes automatically after a few minutes.",
          "阅读窗口会在几分钟后自动过期关闭并销毁。",
        )}</p>
      </div>
    </aside>
    <div class="form-card secrex-card">
      <div class="form-heading">
        <h2>${t("Open encrypted secret", "解锁阅后即焚信息")}</h2>
        <span class="pill">${t("ONE-TIME READ", "一次性阅读")}</span>
      </div>
      <section class="secrex-guide" aria-label="${t("Before you unlock", "阅读前说明")}">
        <h3>${t("Before you unlock", "阅读前说明")}</h3>
        <p>${t(
          "Your share password is used locally in your browser to unwrap and decrypt this message. Once unlocked, this link cannot be opened again on another device or tab. Save anything you need before ending or closing the page.",
          "分享密码仅在你的浏览器本地用于校验并解密内容。一旦成功打开，其他设备或标签页将立即无法再次访问。结束会话或关闭页面前请自行保存所需信息。",
        )}</p>
      </section>
      <div id="secrex-unlock" class="secrex-fields">
        <label for="secrex-password">${t("Share password", "分享密码")}</label>
        <input id="secrex-password" type="password" autocomplete="off"
          spellcheck="false" autocapitalize="off" maxlength="80"
          placeholder="${t("Paste the separate share password…", "粘贴对方发来的分享密码…")}">
        <button id="secrex-view" class="button" type="button">${t("View secret", "解锁查看内容")}</button>
      </div>
      <div id="secrex-reading" class="secrex-fields" hidden>
        <pre id="secrex-result" tabindex="0" aria-label="${t("Secret text", "私密内容")}"></pre>
        <p class="secrex-note">${t(
          "This session ends automatically in a few minutes. Copy what you need, then destroy the secret now.",
          "此阅读会话将在几分钟后自动结束并销毁。请及时保存所需内容，或立即销毁。",
        )}</p>
        <button id="secrex-end" class="button" type="button">${t("End and destroy", "结束并销毁")}</button>
      </div>
      <p class="secrex-status" role="status" aria-live="polite"></p>
      <a class="secrex-new text-link" href="/secrex">${t("Create your own secret", "我也要创建阅后即焚信息")}</a>
    </div>
  </section>`;

  const status = main.querySelector(".secrex-status");
  const unlock = document.querySelector("#secrex-unlock");
  const password = document.querySelector("#secrex-password");
  const view = document.querySelector("#secrex-view");
  const reading = document.querySelector("#secrex-reading");
  const result = document.querySelector("#secrex-result");
  const end = document.querySelector("#secrex-end");
  let session = generateSessionToken(),
    timer,
    deadline = 0,
    monotonicDeadline = 0,
    closed = false;

  function close(message) {
    closed = true;
    clearTimeout(timer);
    deadline = 0;
    monotonicDeadline = 0;
    session = undefined;
    password.value = "";
    result.textContent = "";
    unlock.hidden = true;
    reading.hidden = true;
    status.textContent = message;
  }

  function expireIfDue() {
    if (
      deadline &&
      (Date.now() >= deadline || performance.now() >= monotonicDeadline)
    )
      close(
        t("This reading session has expired.", "本次阅读会话已过期并销毁。"),
      );
  }

  view.addEventListener("click", async () => {
    const supplied = password.value.trim();
    if (!isValidPassword(supplied)) {
      status.textContent = t(
        "Paste the complete share password and try again.",
        "请粘贴完整的分享密码后重试。",
      );
      return;
    }
    view.disabled = true;
    password.readOnly = true;
    status.textContent = t("Opening…", "正在验证并解密…");
    const started = Date.now();
    const monotonicStarted = performance.now();
    try {
      const claim = await deriveClaim(id, supplied);
      if (closed) return;
      const encrypted = await post(`/${id}/claim`, { claim, session });
      const plaintext = await decryptSecret({
        ...encrypted,
        id,
        password: supplied,
      });
      if (closed) return;
      deadline = started + encrypted.remainingMs;
      monotonicDeadline = monotonicStarted + encrypted.remainingMs;
      if (
        !Number.isFinite(deadline) ||
        deadline <= Date.now() ||
        monotonicDeadline <= performance.now()
      ) {
        close(
          t("This reading session has expired.", "本次阅读会话已过期并销毁。"),
        );
        return;
      }
      password.value = "";
      result.textContent = plaintext;
      unlock.hidden = true;
      reading.hidden = false;
      status.textContent = "";
      result.focus();
      timer = setTimeout(
        () =>
          close(
            t(
              "This reading session has expired.",
              "本次阅读会话已过期并销毁。",
            ),
          ),
        Math.max(
          1,
          Math.min(deadline - Date.now(), monotonicDeadline - performance.now()),
        ),
      );
    } catch (error) {
      if (!closed)
        status.textContent =
          error.message === "UNAVAILABLE"
            ? t(
                "This secret is unavailable or the share password is incorrect.",
                "该信息已不可用，或分享密码不正确。",
              )
            : t(
                "Could not open the secret. Try again in this page.",
                "无法打开该信息，请在此页面重试。",
              );
    } finally {
      view.disabled = false;
      password.readOnly = false;
    }
  });
  password.addEventListener("keydown", (event) => {
    if (event.key === "Enter") view.click();
  });
  end.addEventListener("click", async () => {
    result.textContent = "";
    result.hidden = true;
    reading.querySelector(".secrex-note").hidden = true;
    end.disabled = true;
    status.textContent = t("Destroying…", "正在销毁…");
    try {
      await post(`/${id}/end`, { session });
      if (!closed) close(t("Secret destroyed.", "信息已彻底销毁。"));
    } catch {
      if (!closed)
        status.textContent = t(
          "Could not confirm destruction. Try again or wait for expiry.",
          "未能确认销毁状态，请重试或等待自动过期。",
        );
    } finally {
      end.disabled = false;
    }
  });
  document.addEventListener("visibilitychange", expireIfDue);
  window.addEventListener(
    "pagehide",
    () => close(t("This reading page has closed.", "阅读页面已关闭。")),
    { once: true },
  );
}

function showUnavailable(title, detail) {
  document.title = t("Secrex — ScaleTag", "Secrex — ScaleTag");
  main.innerHTML = `<section class="empty-page">
    <span class="eyebrow">${t("SECREX", "SECREX 阅后即焚")}</span>
    <h1>${escapeText(title)}</h1>
    <p>${escapeText(detail)}</p>
    <a class="button" href="/secrex">${t("Create a new secret", "创建新的密信")} ${icons.arrow}</a>
  </section>`;
}

function escapeText(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

const path = location.pathname.replace(/\/$/, "");
const id = path.startsWith("/secrex/") ? path.slice("/secrex/".length) : null;
if (!globalThis.crypto?.subtle) {
  showUnavailable(
    t("HTTPS is required.", "需要 HTTPS 环境。"),
    t(
      "Open Secrex over HTTPS to use browser encryption.",
      "请通过 HTTPS 打开 Secrex 以使用浏览器端加密。",
    ),
  );
} else if (!id) {
  createView();
} else if (isValidId(id)) {
  readView(id);
} else {
  showUnavailable(
    t("This secret is unavailable.", "此加密信息不可用。"),
    t(
      "The secret may have already been read, destroyed, or expired after 24 hours.",
      "该信息可能已被阅读并销毁，或超过 24 小时已过期失效。",
    ),
  );
}
