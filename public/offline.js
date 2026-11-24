import { htmlLangFor, language, localizedPath, t } from "/locale.js";
document.documentElement.lang = htmlLangFor(language);
if (language !== "en") {
  document.title = t("Connection unavailable — ScaleTag", "无法连接 — ScaleTag");
  document.querySelector(".skip-link").textContent = t("Skip to content", "跳至内容");
  document.querySelector(".eyebrow").textContent = t("A MOMENT TO RECONNECT", "连接中断");
  document.querySelector("h1").textContent = t("Connection unavailable.", "无法连接。");
  const paragraphs = document.querySelectorAll("main section > p:not(#offline-status)");
  paragraphs[0].textContent = t("We can’t reach ScaleTag right now. Reconnect to the internet or try again in a moment.", "暂时无法连接 ScaleTag。请检查网络，或稍后重试。");
  paragraphs[1].textContent = t("Publishing, voting and current results need a live connection. Votes are never queued or submitted in the background.", "发布、投票和查看最新结果需要联网。投票不会排队或在后台提交。");
  document.querySelector("#retry-connection").textContent = t("Try again ↗", "重试 ↗");
  document.querySelector("#offline-status").textContent = t("This page will retry when your connection returns.", "网络恢复后会自动重试。");
}
const savedLink = document.querySelector("#offline-saved-link");
if (savedLink) {
  savedLink.textContent = t("Saved links", "已保存链接");
  savedLink.href = localizedPath("/saved");
  savedLink.closest("nav").setAttribute("aria-label", t("Main navigation", "主导航"));
}
if (location.pathname === "/saved") {
  savedLink?.setAttribute("aria-current", "page");
  void import("/local-posts.js").then(({ renderSavedPosts }) => {
    const host = document.createElement("div");
    renderSavedPosts(host, { offline: true });
    const main = document.querySelector("#main");
    const connectionTitle = main.querySelector("h1");
    const secondaryTitle = document.createElement("h2");
    secondaryTitle.textContent = connectionTitle.textContent;
    connectionTitle.replaceWith(secondaryTitle);
    main.prepend(host);
    document.title = t("Saved links — ScaleTag", "已保存链接 — ScaleTag");
  }).catch(() => {
    // The connection fallback is still usable if a saved-list asset is missing.
  });
}
const status = document.querySelector("#offline-status");
let timer;
let checking = false;
let delay = 2000;

function scheduleRetry() {
  clearTimeout(timer);
  timer = setTimeout(checkConnection, delay);
  delay = Math.min(delay * 2, 30000);
}

async function checkConnection() {
  if (checking || document.hidden) return;
  if (!navigator.onLine) {
    status.textContent =
      t("Waiting for a connection. This page will retry automatically.", "正在等待网络恢复，之后会自动重试。");
    scheduleRetry();
    return;
  }
  checking = true;
  status.textContent = t("Checking the connection…", "正在检查连接…");
  try {
    // HEAD bypasses the service worker's navigation fallback and visit counting.
    const response = await fetch(location.href, {
      method: "HEAD",
      mode: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    // The original post may have expired while the browser was offline.
    if (response.ok || response.status === 404) {
      location.reload();
      return;
    }
  } catch {
    /* The connection may return before the site is reachable. */
  } finally {
    checking = false;
  }
  status.textContent =
    t("ScaleTag is not reachable yet. Try again, or leave this page open.", "仍无法连接 ScaleTag。请重试，或保持页面打开等待网络恢复。");
  scheduleRetry();
}

function retryNow() {
  clearTimeout(timer);
  delay = 2000;
  checkConnection();
}
document.querySelector("#retry-connection").addEventListener("click", retryNow);
window.addEventListener("online", retryNow);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) retryNow();
  else clearTimeout(timer);
});
window.addEventListener("pagehide", () => clearTimeout(timer), { once: true });
checkConnection();
