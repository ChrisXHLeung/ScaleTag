import { language, t } from "/locale.js";
if (language === "zh") {
  document.documentElement.lang = "zh-Hans";
  document.title = "无法连接 — ScaleTag";
  document.querySelector(".eyebrow").textContent = "请稍候重新连接";
  document.querySelector("h1").textContent = "无法连接。";
  const paragraphs = document.querySelectorAll("main section > p:not(#offline-status)");
  paragraphs[0].textContent = "目前无法连接 ScaleTag。请连接互联网或稍后重试。";
  paragraphs[1].textContent = "发布、投票和查看最新结果需要联网。投票不会排队或在后台提交。";
  document.querySelector("#retry-connection").textContent = "重试 ↗";
  document.querySelector("#offline-status").textContent = "网络恢复后此页面会自动重试。";
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
      t("Waiting for a connection. This page will retry automatically.", "等待网络连接。此页面将自动重试。");
    scheduleRetry();
    return;
  }
  checking = true;
  status.textContent = t("Checking the connection…", "正在检查连接…");
  try {
    const response = await fetch("/healthz", {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok && (await response.json()).status === "ok") {
      location.reload();
      return;
    }
  } catch {
    /* Wait for a successful health response, not just an online event. */
  } finally {
    checking = false;
  }
  status.textContent =
    t("ScaleTag is not reachable yet. Try again, or leave this page open.", "仍无法连接 ScaleTag。请重试或保持此页面打开。");
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
