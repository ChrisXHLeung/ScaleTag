import {
  main,
  api,
  escape,
  icons,
  date,
  locate,
  notice,
  toast,
} from "/common.js";
import { mountSocial } from "/social.js";

export function createTask() {
  document.title = "Create a task — ScaleTag";
  document.querySelector('[data-nav="create"]').classList.add("active");
  main.innerHTML = `<section class="create-section"><aside class="section-intro"><a class="back-link" href="/">← Back to home</a><span class="eyebrow">MAKE SOMETHING HAPPEN</span><h1>A little help.<br>A local <em>connection.</em></h1><p>Share a task and the reward you offer. People can reply with a way to reach them.</p><div class="rules"><p>${icons.pin} Location is required to publish.</p><p>${icons.clock} Tasks stay on the website for 30 days.</p><p>${icons.shield} No accounts. Contact each other directly.</p></div></aside><form id="task-form" class="form-card"><div class="post-kind-switch" aria-label="Post type"><a href="/create">Poll</a><a href="/create/task" aria-current="page">Task</a></div><div class="form-heading"><h2>Your new task</h2><span class="pill">LOCAL TASK</span></div><label for="task-title">Title</label><input id="task-title" maxlength="140" required placeholder="What could someone help you with?"><label for="task-description">Description</label><textarea id="task-description" maxlength="4000" rows="6" required placeholder="Describe the task and what you need."></textarea><label for="task-reward">Reward</label><input id="task-reward" maxlength="160" required placeholder="e.g. CAD 30, a coffee, or a thank-you"><p class="field-hint">A description of your offer. ScaleTag does not collect, hold or transfer money.</p><label for="task-name">Your name <span class="optional">optional, unverified</span></label><input id="task-name" maxlength="60" placeholder="Anonymous"><div class="location-box"><div><strong>${icons.pin} Give your task a place</strong><p id="task-location-status" aria-live="polite">People can discover your task nearby.</p></div><button id="task-locate" class="button secondary small" type="button">Enable location</button></div><p class="field-hint">Only a rounded area is shown on the map. It can still reveal your neighbourhood.</p><label class="checkbox-row"><input id="task-map-consent" type="checkbox" required><span>I agree to show my task’s approximate area publicly on the map. This does not guarantee anonymity.</span></label>${notice()}<label class="checkbox-row"><input id="task-retention" type="checkbox" required><span>I understand that this task, its replies and contact details leave the website 30 days after publication. Private daily backups are retained for up to 90 days after creation.</span></label><p class="field-hint">Task descriptions, rewards, names and contact details are unverified. Only share information you are comfortable making public.</p><button id="publish-task" class="button publish-button" type="submit">Publish my task ${icons.arrow}</button><p id="task-error" class="form-error" role="alert" hidden></p></form></section>`;
  let position,
    locatedAt = 0,
    publishing = false;
  const locateButton = main.querySelector("#task-locate");
  async function getLocation() {
    position = await locate();
    locatedAt = Date.now();
    main.querySelector("#task-location-status").textContent =
      "Location ready. Only your approximate area will be public.";
    locateButton.textContent = "Refresh location";
  }
  locateButton.onclick = async () => {
    locateButton.disabled = true;
    try {
      await getLocation();
    } catch (e) {
      position = undefined;
      main.querySelector("#task-location-status").textContent = e.message;
    } finally {
      locateButton.disabled = false;
    }
  };
  main.querySelector("#task-form").onsubmit = async (event) => {
    event.preventDefault();
    if (publishing) return;
    publishing = true;
    const button = main.querySelector("#publish-task"),
      error = main.querySelector("#task-error");
    error.hidden = true;
    button.disabled = true;
    try {
      if (!position || Date.now() - locatedAt > 300000) await getLocation();
      const value = (id) => main.querySelector(id).value.trim();
      const task = await api("/api/tasks", {
        title: value("#task-title"),
        description: value("#task-description"),
        reward: value("#task-reward"),
        signature: value("#task-name"),
        location: position,
        mapVisible: main.querySelector("#task-map-consent").checked,
        retentionAccepted: main.querySelector("#task-retention").checked,
      });
      // The management key goes in the fragment, which browsers never send
      // to the server or in Referer headers.
      location.assign(`/task/${task.id}/manage?created=1#key=${task.manageKey}`);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      button.disabled = false;
    } finally {
      publishing = false;
    }
  };
}

export const STATE_LABELS = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
  closed: "Closed",
};
const FINAL_STATES = ["completed", "closed"];
export const stateLabel = (state) => STATE_LABELS[state] ?? "Open";
export const isFinalState = (state) => FINAL_STATES.includes(state);

function manageKeyFromHash() {
  const key = new URLSearchParams(location.hash.slice(1)).get("key") ?? "";
  return /^[a-f0-9]{64}$/.test(key) ? key : undefined;
}

export async function taskPage(id, { manage = false } = {}) {
  let key, task;
  if (manage) {
    key = manageKeyFromHash();
    if (!key)
      throw new Error(
        "This management link is incomplete. Open the full private link saved when the task was published.",
      );
    task = await api(`/api/tasks/${id}/manage`, { key });
  } else task = await api(`/api/tasks/${id}`);
  document.title = `${manage ? "Manage: " : ""}${task.title} — ScaleTag`;
  const created = new URLSearchParams(location.search).has("created");
  const privateLink = `${location.origin}/task/${id}/manage#key=${key}`;
  const manageCard = manage
    ? `<section class="manage-card" aria-labelledby="manage-title"><span class="eyebrow">PRIVATE · ONLY FOR YOU</span><h2 id="manage-title">Manage this task</h2><p>Anyone with this private link can change the task’s status. Do not share it or include it in screenshots. It cannot be recovered or reissued if lost. It may remain in this browser’s history; use the public link when sharing.</p><label for="manage-link">Private management link</label><input id="manage-link" readonly value="${escape(privateLink)}"><button class="button secondary small" type="button" id="copy-manage-link">Copy private link</button><fieldset class="state-buttons"><legend>Task status</legend><p class="field-hint">Completed and Closed are final: they stop new replies and cannot be undone. The task still leaves the website on ${escape(date(task.deleteAt))}.</p><div>${Object.entries(
        STATE_LABELS,
      )
        .map(
          ([value, label]) =>
            `<button type="button" class="button secondary small" data-task-state="${value}" aria-pressed="false">${label}</button>`,
        )
        .join(
          "",
        )}</div></fieldset><p id="manage-error" class="form-error" role="alert" hidden></p></section>`
    : "";
  main.innerHTML = `<section class="poll-layout"><div class="poll-main"><a class="back-link" href="/PostList">← Back to PostList</a>${created ? `<div class="success-banner" role="status">Your task is live.${manage ? " Save the private management link below before leaving this page." : " Share its QR code to find a little help."}</div>` : ""}<div class="poll-meta"><span class="status-badge">Task</span><span id="task-state" class="status-badge"></span><span>Available until ${date(task.deleteAt)}</span></div><h1 class="poll-title">${escape(task.title)}</h1><p class="byline">Posted by <strong>${escape(task.signature)}</strong><span> · ${date(task.createdAt)}</span><span class="unverified">Unverified name</span></p><p class="poll-description">${escape(task.description)}</p><section class="task-reward"><span class="eyebrow">REWARD OFFERED</span><h2>${escape(task.reward)}</h2><p>Offered by the poster. Arrange details directly. ScaleTag does not handle payments or transactions.</p></section>${manageCard}<section id="social" aria-label="Task likes and replies"></section></div><aside class="poll-sidebar"><section class="share-card"><span class="eyebrow">PASS IT ON</span><h2>A small code.<br>A local connection.</h2><div class="qr-frame"><img src="/api/tasks/${id}/qr.png" width="256" height="256" alt="QR code linking to this task"></div><p>Scan to read. Save to share.</p><a class="button" href="/api/tasks/${id}/qr.png?download=1" download="ScaleTag-task-${id}.png">${icons.download} Save QR image</a><button class="button secondary" id="copy-task-link">Copy ${manage ? "public " : ""}task link</button><div id="public-link-fallback" hidden><label for="public-task-link">Public task link</label><input id="public-task-link" readonly></div></section><section class="timeline-card"><div>${icons.clock}<span>Removed with all replies<strong>${date(task.deleteAt)}</strong></span></div><p>Dates are shown in your local time.</p></section>${notice()}</aside></section>`;
  function renderState(state) {
    const badge = main.querySelector("#task-state");
    badge.textContent = stateLabel(state);
    badge.classList.toggle("closed", isFinalState(state));
    badge.classList.toggle("in-progress", state === "in_progress");
    if (!manage) return;
    main.querySelectorAll("[data-task-state]").forEach((button) => {
      const current = button.dataset.taskState === state;
      button.setAttribute("aria-pressed", String(current));
      button.classList.toggle("selected", current);
      button.disabled = current || isFinalState(state);
    });
  }
  renderState(task.taskState);
  main.querySelector("#copy-task-link").onclick = async () => {
    const publicLink = `${location.origin}/task/${id}`;
    try {
      await navigator.clipboard.writeText(publicLink);
      toast("Task link copied.");
    } catch {
      // Never point to the address bar: on the management page it contains
      // the private key. Show and select the canonical public URL instead.
      const fallback = main.querySelector("#public-link-fallback"),
        input = main.querySelector("#public-task-link");
      input.value = publicLink;
      fallback.hidden = false;
      input.focus();
      input.select();
      toast("Copy the selected public task link.");
    }
  };
  let social;
  if (manage) {
    main.querySelector("#copy-manage-link").onclick = async () => {
      try {
        await navigator.clipboard.writeText(privateLink);
        toast("Private management link copied. Keep it safe.");
      } catch {
        main.querySelector("#manage-link").select();
        toast("Copy the selected private link and keep it safe.");
      }
    };
    let changing = false;
    main.querySelectorAll("[data-task-state]").forEach((button) => {
      button.onclick = async () => {
        if (changing) return;
        const state = button.dataset.taskState;
        if (
          isFinalState(state) &&
          !confirm(
            `Mark this task as ${stateLabel(state)}? New replies will stop and this cannot be undone.`,
          )
        )
          return;
        changing = true;
        const error = main.querySelector("#manage-error");
        error.hidden = true;
        main
          .querySelectorAll("[data-task-state]")
          .forEach((b) => (b.disabled = true));
        try {
          task = await api(`/api/tasks/${id}/state`, { key, state });
          toast(`Task marked ${stateLabel(task.taskState)}.`);
          social?.refresh();
        } catch (e) {
          error.textContent = e.message;
          error.hidden = false;
        } finally {
          changing = false;
          renderState(task.taskState);
        }
      };
    });
  }
  social = mountSocial(
    id,
    true,
    () => {
      document.title = "Task unavailable — ScaleTag";
      main.innerHTML =
        '<section class="empty-page"><h1>This page is unavailable.</h1><p>This task and its replies have left the website. Private archives follow the backup retention policy.</p><a class="button" href="/PostList">Back to PostList</a></section>';
    },
    (data) => {
      if (data.taskState && data.taskState !== task.taskState) {
        task = { ...task, taskState: data.taskState };
        renderState(task.taskState);
      }
    },
  );
}
