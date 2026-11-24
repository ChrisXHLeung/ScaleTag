import { localizedPath, t } from "/locale.js";
import { api } from "/common.js";

const savedKey = "scaletag-saved-posts";
const postPath = /^\/(?:vote|task|sale)\/[a-f0-9]{24}(?:\/manage)?$/;

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function savedPosts() {
  const items = read(savedKey, []);
  if (!Array.isArray(items)) return [];
  return items.filter((item) => typeof item?.path === "string" &&
    postPath.test(item.path) && typeof item.title === "string").slice(0, 100);
}

function savedLinksChanged(event) {
  return event.storageArea === localStorage && (event.key === savedKey || event.key === null);
}

function notice(text) {
  const line = document.createElement("p");
  line.className = "field-hint";
  line.setAttribute("role", "status");
  line.textContent = text;
  return line;
}

function button(text) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "button secondary small";
  control.textContent = text;
  return control;
}

const unavailable = () => t("This browser cannot store this item.", "此浏览器无法保存此项。");
const textDraftKey = (kind) => `scaletag-text-draft-${kind}`;
const hasTextDraft = (draft) => draft?.fields && typeof draft.fields === "object";

function readDraft(key) {
  let stored;
  try {
    stored = localStorage.getItem(key);
    return { stored, draft: JSON.parse(stored) };
  } catch {
    return { stored };
  }
}

async function withDraftLock(key, operation) {
  // Use one lock per origin and post type where the browser supports Web Locks.
  if (navigator.locks) return navigator.locks.request(key, operation);
  return operation();
}

const draftCopyFields = {
  poll: {
    path: "/create",
    fields: { "#title": "title", "#description": "description", "#signature": "signature" },
  },
  task: {
    path: "/create/task",
    fields: { "#task-title": "title", "#task-description": "description", "#task-reward": "reward", "#task-name": "signature" },
  },
  sale: {
    path: "/create/sale",
    fields: { "#sale-title": "title", "#sale-description": "description", "#sale-name": "signature" },
  },
};

export function mountDraftCopy(host, getPost) {
  const controls = document.createElement("div");
  controls.className = "local-post-controls";
  const copy = button(t("Copy to new draft", "复制为新草稿"));
  const status = notice("");
  status.hidden = true;
  controls.append(copy, status);
  host.append(controls);
  function explain(message) {
    status.textContent = message;
    status.hidden = false;
  }
  copy.onclick = async () => {
    status.hidden = true;
    const post = getPost();
    const preset = draftCopyFields[post.type];
    if (!preset) return;
    const key = textDraftKey(post.type);
    const { stored, draft: previous } = readDraft(key);
    if (stored === undefined) return explain(unavailable());
    if (hasTextDraft(previous)) {
      if (!window.confirm(t("Replace the existing draft in this browser?", "替换此浏览器中已有的草稿？"))) return;
      // The confirmation dialog pauses delivery of this tab's storage updates.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    // Copy only named public text fields. Publication settings use the new form defaults.
    const fields = Object.fromEntries(Object.entries(preset.fields)
      .filter(([, name]) => typeof post[name] === "string")
      .map(([selector, name]) => [selector, post[name]]));
    const choices = post.type === "poll" ? post.options.map(({ label }) => label) : undefined;
    try {
      const saved = await withDraftLock(key, () => {
        if (readDraft(key).stored === stored) return write(key, { fields, choices });
        explain(t("The draft changed in another tab. Try again.", "草稿已在其他标签页中修改，请重试。"));
      });
      if (saved) window.location.assign(localizedPath(preset.path));
      if (saved === false) explain(unavailable());
    } catch {
      explain(unavailable());
    }
  };
}

// Only explicit public form fields are accepted. Never serialize a form or its URL.
export function bindTextDraft(form, kind, selectors, options) {
  const key = textDraftKey(kind);
  const fields = selectors.map((selector) => form.querySelector(selector));
  const defaults = fields.map((field) => field.value);
  const { stored, draft: saved } = readDraft(key);
  const status = notice(t("Text drafts stay in this browser.", "文字草稿仅保存在此浏览器。"));
  const clear = button(t("Clear draft", "清除草稿"));
  const load = button(t("Load saved draft", "载入已保存草稿"));
  const replace = button(t("Replace saved draft", "替换已保存草稿"));
  const controls = document.createElement("div");
  controls.className = "local-post-controls";
  controls.append(status, clear, load, replace);
  form.querySelector(".form-heading").after(controls);

  function restore(fieldsToRestore, choices) {
    fields.forEach((field, i) => {
      const value = Array.isArray(fieldsToRestore) ? fieldsToRestore[i] : fieldsToRestore?.[selectors[i]];
      field.value = typeof value !== "string" ? defaults[i]
        : field.maxLength > 0 ? value.slice(0, field.maxLength) : value;
      if (field instanceof HTMLSelectElement && field.selectedIndex < 0) field.value = defaults[i];
    });
    options?.restore(choices);
  }
  if (hasTextDraft(saved)) {
    restore(saved.fields, saved.choices);
    status.textContent = t("Text draft restored.", "已恢复文字草稿。");
  }
  const formDraft = () => ({ fields: fields.map(field => field.value), choices: options?.read() });
  let current = stored;
  let savedForm = JSON.stringify(formDraft());
  clear.hidden = !hasTextDraft(saved);
  load.hidden = replace.hidden = true;

  function resolved(message, hasDraft) {
    status.textContent = message;
    clear.hidden = !hasDraft;
    load.hidden = replace.hidden = true;
    savedForm = JSON.stringify(formDraft());
  }

  function matches(expected) {
    const { stored } = readDraft(key);
    if (stored === undefined) status.textContent = unavailable();
    else if (stored === expected) return true;
    else {
      const message = t("Auto-save paused. The saved draft changed in another tab.", "自动保存已暂停。已保存的草稿在另一个标签页中发生了变化。");
      if (status.textContent !== message) status.textContent = message;
      load.hidden = stored === null;
      replace.hidden = false;
      clear.hidden = true;
    }
    return false;
  }

  function run(operation) {
    return withDraftLock(key, () => {
      if (form.isConnected) return operation();
    }).catch(() => { status.textContent = unavailable(); });
  }

  function resetDraft(operation) {
    const before = JSON.stringify(formDraft());
    return run(() => {
      if (JSON.stringify(formDraft()) === before) operation();
    });
  }

  function persist() {
    const draft = formDraft();
    if (write(key, draft)) {
      current = JSON.stringify(draft);
      resolved(t("Text draft saved on this browser.", "文字草稿已保存在此浏览器。"), true);
    } else status.textContent = unavailable();
  }

  function save() {
    return run(() => {
      if (matches(current)) persist();
    });
  }
  function onInput(event) {
    if (fields.includes(event.target) || options?.contains(event.target)) save();
  }
  form.addEventListener("input", onInput);
  form.addEventListener("change", onInput);
  clear.onclick = () => resetDraft(() => {
    if (!matches(current)) return;
    if (!write(key)) {
      status.textContent = unavailable();
      return;
    }
    current = null;
    restore();
    fields[0].dispatchEvent(new Event("draftreset", { bubbles: true }));
    resolved(t("Text draft cleared.", "文字草稿已清除。"), false);
  });
  load.onclick = () => {
    if (!window.confirm(t("Load the saved draft and replace the draft fields in this tab?", "载入已保存草稿并替换此标签页中的草稿字段？"))) return;
    return resetDraft(() => {
      const { stored, draft } = readDraft(key);
      const available = hasTextDraft(draft);
      if (stored !== null && !available) {
        status.textContent = unavailable();
        return;
      }
      restore(draft?.fields, draft?.choices);
      current = stored;
      fields[0].dispatchEvent(new Event("draftreset", { bubbles: true }));
      resolved(available ? t("Text draft restored.", "已恢复文字草稿。")
        : t("Text draft cleared.", "文字草稿已清除。"), available);
    });
  };
  replace.onclick = async () => {
    const { stored } = readDraft(key);
    if (stored === undefined) {
      status.textContent = unavailable();
      return;
    }
    if (stored !== null) {
      if (!window.confirm(t("Replace the existing draft in this browser?", "替换此浏览器中已有的草稿？"))) return;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return run(() => {
      if (matches(stored)) persist();
    });
  };
  return {
    save,
    snapshot() {
      const submitted = JSON.stringify(formDraft());
      return run(() => {
        if (submitted === savedForm && readDraft(key).stored === current) return current;
      });
    },
    published: (submittedDraft) => run(() => {
      if (typeof submittedDraft === "string" && readDraft(key).stored === submittedDraft) write(key);
    }),
  };
}

export function mountSavedPost(host, { path, title }) {
  if (!host || !postPath.test(path)) return;
  const control = button("");
  control.dataset.savedPostPath = path;
  const status = notice("");
  status.hidden = true;
  control.onclick = () => {
    const items = savedPosts();
    const index = items.findIndex((item) => item.path === path);
    if (index >= 0) items.splice(index, 1);
    else items.unshift({ path, title });
    status.hidden = write(savedKey, items.slice(0, 100));
    status.textContent = status.hidden ? "" : unavailable();
    syncSavedButtons();
  };
  host.append(control, status);
  syncSavedButtons();
}

function syncSavedButtons() {
  const paths = new Set(savedPosts().map(item => item.path));
  for (const control of document.querySelectorAll("button[data-saved-post-path]")) {
    const path = control.dataset.savedPostPath;
    const selected = paths.has(path);
    control.setAttribute("aria-pressed", String(selected));
    control.textContent = selected
      ? t("Remove from saved links", "从已保存链接移除")
      : path.endsWith("/manage") ? t("Save management link", "保存管理网址") : t("Save post", "保存帖子");
  }
}

window.addEventListener("storage", (event) => {
  if (savedLinksChanged(event)) syncSavedButtons();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) syncSavedButtons();
});

export function renderSavedPosts(host) {
  const page = document.createElement("section");
  page.className = "list-page";
  const heading = document.createElement("h1");
  heading.textContent = t("Saved links", "已保存链接");
  const description = notice(t("These links stay in this browser. Management passwords are not saved here.", "这些链接仅保存在此浏览器。管理密码不会保存在这里。"));
  const list = document.createElement("ul");
  list.className = "saved-posts";
  const empty = notice(t("You have no saved links.", "暂无已保存链接。"));
  page.append(heading, description, list, empty);
  host.replaceChildren(page);

  const labels = new Map([
    ["poll_open", t("Open for votes", "投票进行中")],
    ["poll_final", t("Final results", "最终结果")],
    ["task_open", t("Open", "开放中")],
    ["task_assigned", t("Already assigned", "已有接单人")],
    ["task_in_progress", t("In progress", "进行中")],
    ["task_completed", t("Completed", "已完成")],
    ["task_closed", t("Closed", "已关闭")],
    ["sale_open", t("Available", "可领取")],
    ["sale_reserved", t("Reserved", "已保留")],
    ["sale_claimed", t("Claimed", "已领取")],
    ["unavailable", t("Post link unavailable", "帖子链接不可用")],
  ]);
  const checking = t("Checking post status…", "正在查看帖子状态…");
  const failed = t("Could not check post status.", "暂时无法查看帖子状态。");
  const lookups = new Map();

  let request, refreshTimer;
  function cancelStatusRefresh() {
    clearTimeout(refreshTimer);
    request?.abort();
  }

  async function refreshStatuses() {
    cancelStatusRefresh();
    if (!lookups.size || !page.isConnected || document.hidden) return;
    request = new AbortController();
    const { signal } = request;
    const entries = [...lookups.values()];
    let nextRefresh = Infinity;
    for (let i = 0; i < entries.length && !signal.aborted; i += 20) {
      const batch = entries.slice(i, i + 20).filter(lookup => lookup.labels.size);
      if (!batch.length) continue;
      let statuses = [];
      try {
        const result = await api("/api/posts/statuses", {
          posts: batch.map(({ type, id }) => ({ type, id })),
        }, { signal });
        if (Array.isArray(result.statuses) && result.statuses.length === batch.length) {
          statuses = result.statuses;
          if (Number.isSafeInteger(result.refreshAfterMs) && result.refreshAfterMs > 0)
            nextRefresh = Math.min(nextRefresh, performance.now() + result.refreshAfterMs);
        }
      } catch {
        // An unavailable connection does not change the saved links.
      }
      if (!signal.aborted) batch.forEach((lookup, index) => {
        for (const output of lookup.labels) output.textContent = labels.get(statuses[index]) ?? failed;
      });
    }
    if (!signal.aborted && lookups.size && Number.isFinite(nextRefresh)) {
      const delay = Math.max(100, nextRefresh - performance.now());
      refreshTimer = setTimeout(refreshStatuses, Math.min(delay, 2 ** 31 - 1));
    }
  }

  function render() {
    lookups.clear();
    list.replaceChildren();
    for (const [path, title] of new Map(savedPosts().map(item => [item.path, item.title]))) {
      const row = document.createElement("li");
      const details = document.createElement("div");
      details.className = "saved-post-details";
      const link = document.createElement("a");
      link.href = path;
      link.textContent = title;
      if (path.endsWith("/manage")) link.append(` · ${t("Management URL", "管理网址")}`);
      const status = document.createElement("span");
      status.className = "field-hint saved-post-status";
      status.id = `saved-status-${list.childElementCount}`;
      status.textContent = checking;
      link.setAttribute("aria-describedby", status.id);
      const [, kind, id] = path.split("/");
      const type = kind === "vote" ? "poll" : kind;
      const tag = `${type}:${id}`;
      if (!lookups.has(tag)) lookups.set(tag, { type, id, labels: new Set() });
      const lookup = lookups.get(tag);
      lookup.labels.add(status);
      const remove = button(t("Remove", "移除"));
      remove.onclick = () => {
        if (!write(savedKey, savedPosts().filter(item => item.path !== path))) {
          description.textContent = unavailable();
          return;
        }
        lookup.labels.delete(status);
        if (!lookup.labels.size) lookups.delete(tag);
        if (!lookups.size) cancelStatusRefresh();
        row.remove();
        empty.hidden = list.childElementCount > 0;
      };
      details.append(link, status);
      row.append(details, remove);
      list.append(row);
    }
    empty.hidden = list.childElementCount > 0;
    void refreshStatuses();
  }

  render();
  window.addEventListener("storage", (event) => {
    if (savedLinksChanged(event)) render();
  });
  document.addEventListener("visibilitychange", refreshStatuses);
  window.addEventListener("online", refreshStatuses);
  window.addEventListener("pagehide", cancelStatusRefresh);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) render();
  });
}
