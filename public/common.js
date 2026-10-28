const main = document.querySelector("#main");
const escape = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  arrow:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h3v3h4v4h-7zm7 0v3"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>',
};
const date = (time) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
const shortDate = (time) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(time),
  );
const count = (value) => new Intl.NumberFormat("en").format(value);
const percent = (votes, total) =>
  total ? ((votes / total) * 100).toFixed(1).replace(/\.0$/, "") : "0";
function remaining(end, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((end - now) / 60000));
  if (!minutes) return "Voting closed";
  if (minutes >= 1440)
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h left`;
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left`
    : `${minutes}m left`;
}
function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.hidden = true;
  }, 4500);
}
async function api(path, body) {
  if (!navigator.onLine)
    throw new Error(
      "You’re offline. Reconnect to publish, vote or load current results.",
    );
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new Error("Could not connect. Check your connection and try again.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The service is temporarily unavailable. Please try again.",
    );
  }
  if (!response.ok) {
    const error = new Error(
      data.error ?? "Something went wrong. Please try again.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(
        new Error(
          "Location is not supported in this browser. Try a browser with location access.",
        ),
      );
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === 1
              ? "Location permission is required. Allow it in your browser settings and try again."
              : e.code === 3
                ? "Location timed out. Please try again."
                : "Your location is unavailable. Check your device location settings and try again.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}
function notice() {
  return `<div class="retention-note">${icons.clock}<div><strong>Public for 30 days. Backed up for recovery.</strong><p>Posts leave the website 30 days after publication. Private daily backups are retained for up to 90 days after each backup is created. Save anything you need before the public link expires.</p></div></div>`;
}

export {
  main,
  escape,
  icons,
  date,
  shortDate,
  count,
  percent,
  remaining,
  toast,
  api,
  locate,
  notice,
};
