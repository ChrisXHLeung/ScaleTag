const installButton = document.querySelector("#install-app");
const dialog = document.querySelector("#install-dialog");
const nativeInstall = document.querySelector("#install-native");
const updateBanner = document.querySelector("#app-update");
const updateButton = document.querySelector("#apply-update");
const connectionBanner = document.querySelector("#connection-status");
const displayMode = window.matchMedia("(display-mode: standalone)");
let installPrompt;
let registration;
let reloadRequested = false;
let lastUpdateCheck = Date.now();

function reflectDisplayMode() {
  installButton.hidden = displayMode.matches || navigator.standalone === true;
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
  nativeInstall.hidden = false;
});
nativeInstall.addEventListener("click", async () => {
  if (!installPrompt) return;
  nativeInstall.disabled = true;
  try {
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      dialog.close();
      installButton.hidden = true;
    }
  } catch {
    document.querySelector("#install-message").textContent =
      "Use your browser’s menu to install ScaleTag.";
  } finally {
    installPrompt = undefined;
    nativeInstall.hidden = true;
    nativeInstall.disabled = false;
  }
});
window.addEventListener("appinstalled", () => {
  installPrompt = undefined;
  installButton.hidden = true;
  nativeInstall.hidden = true;
  dialog.close();
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
