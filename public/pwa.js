const installButton = document.querySelector("#install-app");
const dialog = document.querySelector("#install-dialog");
const nativeInstall = document.querySelector("#install-native");
const pageInstall = document.querySelector("#install-page-native");
const nativeButtons = [nativeInstall, pageInstall].filter(Boolean);
const updateBanner = document.querySelector("#app-update");
const updateButton = document.querySelector("#apply-update");
const connectionBanner = document.querySelector("#connection-status");
const displayMode = window.matchMedia("(display-mode: standalone)");
let installPrompt;
let installedThisVisit = false;
let registration;
let reloadRequested = false;
let lastUpdateCheck = Date.now();

function reflectDisplayMode() {
  const installed =
    installedThisVisit || displayMode.matches || navigator.standalone === true;
  installButton.hidden = installed;
  for (const button of nativeButtons)
    button.hidden = installed || !installPrompt;
  const done = document.querySelector("#install-page-done");
  if (done) done.hidden = !installed;
  const fallback = document.querySelector("#android-install-fallback");
  if (fallback) fallback.hidden = Boolean(installPrompt) || installed;
}

function choosePlatform(platform) {
  document.querySelectorAll("[data-install-platform]").forEach((button) => {
    const selected = button.dataset.installPlatform === platform;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-platform-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.platformPanel !== platform;
  });
}
if (document.querySelector("[data-install-platform]")) {
  // This local hint only chooses instructions; it is never uploaded or saved.
  const appleMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  choosePlatform(appleMobile ? "ios" : "android");
  document.querySelectorAll("[data-install-platform]").forEach((button) => {
    button.addEventListener("click", () =>
      choosePlatform(button.dataset.installPlatform),
    );
  });
}
reflectDisplayMode();
displayMode.addEventListener("change", reflectDisplayMode);
installButton.addEventListener("click", () => dialog.showModal());
document
  .querySelector("#close-install")
  .addEventListener("click", () => dialog.close());
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  reflectDisplayMode();
});
async function requestInstallation() {
  if (!installPrompt) return;
  const prompt = installPrompt;
  for (const button of nativeButtons) button.disabled = true;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") {
      installedThisVisit = true;
      dialog.close();
    }
  } catch {
    document.querySelectorAll("[data-install-message]").forEach((message) => {
      message.textContent = "Use your browser’s menu to install ScaleTag.";
    });
  } finally {
    installPrompt = undefined;
    for (const button of nativeButtons) button.disabled = false;
    reflectDisplayMode();
  }
}
for (const button of nativeButtons)
  button.addEventListener("click", requestInstallation);
window.addEventListener("appinstalled", () => {
  installedThisVisit = true;
  installPrompt = undefined;
  dialog.close();
  reflectDisplayMode();
});

function reflectConnection() {
  connectionBanner.hidden = navigator.onLine;
}
reflectConnection();
window.addEventListener("online", reflectConnection);
window.addEventListener("offline", reflectConnection);

function showUpdate() {
  if (registration?.waiting && navigator.serviceWorker.controller)
    updateBanner.hidden = false;
}
updateButton.addEventListener("click", () => {
  reloadRequested = true;
  updateButton.disabled = true;
  updateButton.textContent = "Updating…";
  if (registration?.waiting)
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  else location.reload();
});
document.querySelector("#dismiss-update").addEventListener("click", () => {
  updateBanner.hidden = true;
});

async function checkForUpdate() {
  if (
    !registration ||
    document.hidden ||
    !navigator.onLine ||
    Date.now() - lastUpdateCheck < 60000
  )
    return;
  lastUpdateCheck = Date.now();
  try {
    await registration.update();
    showUpdate();
  } catch {
    /* The app remains usable if an update check fails. */
  }
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadRequested) location.reload();
  });
  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    showUpdate();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") showUpdate();
      });
    });
    document.addEventListener("visibilitychange", checkForUpdate);
    window.addEventListener("online", checkForUpdate);
    const timer = setInterval(checkForUpdate, 60 * 60 * 1000);
    window.addEventListener("pagehide", () => clearInterval(timer), {
      once: true,
    });
  } catch {
    // Installation and offline support are optional; normal web functionality still works.
  }
}
