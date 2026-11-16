import { decryptSecret, deriveClaim, encryptSecret, generateSessionToken,
  isValidId, isValidPassword } from "./secrex-crypto.js";

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

function mount(body) {
  main.innerHTML = `<section class="secrex-panel">
    <h1>Secrex</h1>
    ${body}
    <p class="secrex-status" role="status" aria-live="polite"></p>
  </section>`;
  return main.querySelector(".secrex-status");
}

function copy(button, field, status) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = "Copied.";
    } catch {
      field.select();
      status.textContent = "Use your browser’s copy command.";
    }
  });
}

function createView() {
  const status = mount(`
    <p class="secrex-intro">Share a secret for one private reading session.</p>
    <div id="secrex-compose" class="secrex-fields">
      <label for="secrex-text">Secret text</label>
      <textarea id="secrex-text" rows="7" maxlength="12000" autocomplete="off"
        autocapitalize="off" spellcheck="false"></textarea>
      <button id="secrex-create" type="button">Create secret</button>
    </div>
    <div id="secrex-share" class="secrex-fields" hidden>
      <p>Send the link or QR code. Share the password separately when possible.</p>
      <label for="secrex-link">Share link</label>
      <div class="secrex-copy">
        <input id="secrex-link" type="text" readonly>
        <button id="secrex-copy-link" type="button">Copy link</button>
      </div>
      <label for="secrex-generated-password">Share password</label>
      <div class="secrex-copy">
        <input id="secrex-generated-password" type="text" readonly autocomplete="off"
          spellcheck="false" autocapitalize="off">
        <button id="secrex-copy-password" type="button">Copy password</button>
      </div>
      <img id="secrex-qr" width="192" height="192" alt="QR code for the share link">
      <p class="secrex-note">The link expires after 24 hours if nobody opens it.</p>
      <a class="secrex-new" href="/secrex">Create another secret</a>
    </div>`);
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
      status.textContent = "Enter the text you want to share.";
      text.focus();
      return;
    }
    if (new TextEncoder().encode(text.value).byteLength > 12000) {
      status.textContent = "This secret is too long. Shorten it and try again.";
      return;
    }
    button.disabled = true;
    text.readOnly = true;
    status.textContent = "Encrypting…";
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
      status.textContent = "Your secret is ready to share.";
      link.focus();
    } catch (error) {
      if (!leaving) status.textContent = error.message === "BUSY"
        ? "Secrex is busy. Try again shortly." : "Could not create the secret. Try again.";
    } finally {
      button.disabled = false;
      text.readOnly = false;
    }
  });
  window.addEventListener("pagehide", () => {
    leaving = true;
    text.value = "";
    password.value = "";
    link.value = "";
    qr.removeAttribute("src");
  }, { once: true });
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
}

function readView(id) {
  const status = mount(`
    <p class="secrex-intro">Paste the share password you received.</p>
    <div id="secrex-unlock" class="secrex-fields">
      <label for="secrex-password">Share password</label>
      <input id="secrex-password" type="password" autocomplete="off"
        spellcheck="false" autocapitalize="off" maxlength="80">
      <button id="secrex-view" type="button">View secret</button>
    </div>
    <div id="secrex-reading" class="secrex-fields" hidden>
      <pre id="secrex-result" tabindex="0" aria-label="Secret text"></pre>
      <p class="secrex-note">This session ends automatically. You can destroy the secret now.</p>
      <button id="secrex-end" type="button">End and destroy</button>
    </div>`);
  const unlock = document.querySelector("#secrex-unlock");
  const password = document.querySelector("#secrex-password");
  const view = document.querySelector("#secrex-view");
  const reading = document.querySelector("#secrex-reading");
  const result = document.querySelector("#secrex-result");
  const end = document.querySelector("#secrex-end");
  let session = generateSessionToken(), timer, deadline = 0, monotonicDeadline = 0, closed = false;

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
    if (deadline && (Date.now() >= deadline || performance.now() >= monotonicDeadline))
      close("This reading session has expired.");
  }

  view.addEventListener("click", async () => {
    const supplied = password.value.trim();
    if (!isValidPassword(supplied)) {
      status.textContent = "Paste the complete share password and try again.";
      return;
    }
    view.disabled = true;
    password.readOnly = true;
    status.textContent = "Opening…";
    const started = Date.now();
    const monotonicStarted = performance.now();
    try {
      const claim = await deriveClaim(id, supplied);
      if (closed) return;
      const encrypted = await post(`/${id}/claim`, { claim, session });
      const plaintext = await decryptSecret({ ...encrypted, id, password: supplied });
      if (closed) return;
      deadline = started + encrypted.remainingMs;
      monotonicDeadline = monotonicStarted + encrypted.remainingMs;
      if (!Number.isFinite(deadline) || deadline <= Date.now() || monotonicDeadline <= performance.now()) {
        close("This reading session has expired.");
        return;
      }
      password.value = "";
      result.textContent = plaintext;
      unlock.hidden = true;
      reading.hidden = false;
      status.textContent = "";
      result.focus();
      timer = setTimeout(() => close("This reading session has expired."),
        Math.max(1, Math.min(deadline - Date.now(), monotonicDeadline - performance.now())));
    } catch (error) {
      if (!closed) status.textContent = error.message === "UNAVAILABLE"
        ? "This secret is unavailable or the share password is incorrect."
        : "Could not open the secret. Try again in this page.";
    } finally {
      view.disabled = false;
      password.readOnly = false;
    }
  });
  password.addEventListener("keydown", event => {
    if (event.key === "Enter") view.click();
  });
  end.addEventListener("click", async () => {
    result.textContent = "";
    result.hidden = true;
    reading.querySelector(".secrex-note").hidden = true;
    end.disabled = true;
    status.textContent = "Destroying…";
    try {
      await post(`/${id}/end`, { session });
      if (!closed) close("Secret destroyed.");
    } catch {
      if (!closed) status.textContent = "Could not confirm destruction. Try again or wait for expiry.";
    } finally {
      end.disabled = false;
    }
  });
  document.addEventListener("visibilitychange", expireIfDue);
  window.addEventListener("pagehide", () => close("This reading page has closed."), { once: true });
}

const path = location.pathname.replace(/\/$/, "");
const id = path.startsWith("/secrex/") ? path.slice("/secrex/".length) : null;
if (!globalThis.crypto?.subtle) {
  mount('<p>Open Secrex over HTTPS to use browser encryption.</p>');
} else if (!id) {
  createView();
} else if (isValidId(id)) {
  readView(id);
} else {
  mount('<p>This secret is unavailable.</p>');
}
