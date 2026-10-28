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
      "Waiting for a connection. This page will retry automatically.";
    scheduleRetry();
    return;
  }
  checking = true;
  status.textContent = "Checking the connection…";
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
    "ScaleTag is not reachable yet. Try again, or leave this page open.";
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
