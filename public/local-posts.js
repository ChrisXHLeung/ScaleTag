import { localizedPath, t } from "/locale.js";
import { api } from "/common.js";

const savedKey = "scaletag-saved-posts";
const savedLimit = 100;
const postPath = /^\/(?:vote|task|sale)\/[a-f0-9]{24}(?:\/manage)?$/;
const replyPath = /^\/task\/[a-f0-9]{24}#reply-[a-f0-9]{24}$/;
const isSavedPath = path => postPath.test(path) || replyPath.test(path);

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
    isSavedPath(item.path) && typeof item.title === "string").slice(0, savedLimit);
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

async function withLocalLock(key, operation) {
  // Serialize updates to the same storage key across tabs when Web Locks is available.
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
  wanted: {
    path: "/create/wanted",
    fields: { "#task-title": "title", "#task-description": "description", "#task-name": "signature" },
  },
  found: {
    path: "/create/found",
    fields: { "#task-title": "title", "#task-description": "description", "#task-name": "signature" },
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
    const kind = post.taskKind ?? post.type;
    const preset = draftCopyFields[kind];
    if (!preset) return;
    const key = textDraftKey(kind);
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
      const saved = await withLocalLock(key, () => {
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
    return withLocalLock(key, () => {
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

export function mountSavedPost(host, { path, title, sync = true }) {
  if (!host || !isSavedPath(path)) return;
  const control = button("");
  control.dataset.savedPostPath = path;
  const status = notice("");
  status.hidden = true;
  control.onclick = () => withLocalLock(savedKey, () => {
    const items = savedPosts();
    const index = items.findIndex((item) => item.path === path);
    // Read the title at click time so edits made on the page are saved.
    const currentTitle = typeof title === "function" ? title() : title;
    if (index >= 0) items.splice(index, 1);
    else items.unshift({ path, title: currentTitle });
    status.hidden = write(savedKey, items.slice(0, savedLimit));
    status.textContent = status.hidden ? "" : unavailable();
    syncSavedButtons();
  }).catch(() => {
    status.textContent = unavailable();
    status.hidden = false;
  });
  host.append(control, status);
  if (sync) syncSavedButtons();
}

export function syncSavedButtons(host = document) {
  const paths = new Set(savedPosts().map(item => item.path));
  for (const control of host.querySelectorAll("button[data-saved-post-path]")) {
    const path = control.dataset.savedPostPath;
    const selected = paths.has(path);
    const pressed = String(selected);
    if (control.getAttribute("aria-pressed") !== pressed) control.setAttribute("aria-pressed", pressed);
    const label = selected
      ? t("Remove from saved links", "从已保存链接移除")
      : path.endsWith("/manage") ? t("Save management link", "保存管理网址")
        : replyPath.test(path) ? t("Save reply link", "收藏回复链接") : t("Save post", "保存帖子");
    if (control.textContent !== label) control.textContent = label;
  }
}

window.addEventListener("storage", (event) => {
  if (savedLinksChanged(event)) syncSavedButtons();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) syncSavedButtons();
});

export function renderSavedPosts(host, { offline = false } = {}) {
  const page = document.createElement("section");
  page.className = "list-page";
  const heading = document.createElement("h1");
  heading.textContent = t("Saved links", "已保存链接");
  heading.tabIndex = -1;
  const description = notice(t("These links stay in this browser. Management passwords are not saved here.", "这些链接仅保存在此浏览器。管理密码不会保存在这里。"));
  const filters = document.createElement("div");
  filters.className = "post-search saved-filters";
  filters.setAttribute("role", "search");
  filters.innerHTML = `<label>${t("Search saved links", "搜索已保存链接")}<input type="search" autocomplete="off" maxlength="140"></label>
    <div class="content-filter">
      <label for="saved-type-filter">${t("Post type", "发布类型")}</label>
      <select id="saved-type-filter">
        <option value="all">${t("All post types", "全部类型")}</option>
        <option value="poll">${t("Polls", "投票")}</option>
        <option value="task">${t("Tasks", "任务")}</option>
        <option value="sale">${t("Free Giveaways", "闲置赠予")}</option>
      </select>
    </div>`;
  if (!offline) filters.insertAdjacentHTML("beforeend", `
    <div class="content-filter">
      <label for="saved-status-filter">${t("Link status", "链接状态")}</label>
      <select id="saved-status-filter">
        <option value="all">${t("All link statuses", "全部链接状态")}</option>
        <option value="available">${t("Post link available", "帖子链接可用")}</option>
        <option value="unavailable">${t("Post link unavailable", "帖子链接不可用")}</option>
        <option value="unverified">${t("Status not verified", "状态尚未核验")}</option>
      </select>
    </div>`);
  const search = filters.querySelector("input");
  const typeFilter = filters.querySelector("#saved-type-filter");
  const statusFilter = filters.querySelector("#saved-status-filter");
  const clear = button(t("Clear all filters", "清除所有筛选"));
  filters.append(clear);
  const refreshControls = document.createElement("div");
  refreshControls.className = "local-post-controls";
  refreshControls.hidden = true;
  const refreshButton = button(t("Refresh link statuses", "刷新链接状态"));
  refreshButton.id = "refresh-saved-statuses";
  const refreshFeedback = notice("");
  refreshFeedback.classList.add("saved-filter-message");
  refreshControls.append(refreshButton, refreshFeedback);
  const recovery = document.createElement("div");
  recovery.className = "local-post-controls";
  const recoveryStatus = notice("");
  recoveryStatus.classList.add("saved-recovery-status");
  const removeUnavailable = button(t("Remove unavailable links", "移除不可用链接"));
  removeUnavailable.id = "remove-unavailable-saved";
  removeUnavailable.hidden = true;
  const undo = button(t("Undo removal", "撤销移除"));
  undo.hidden = true;
  recovery.append(recoveryStatus, removeUnavailable, undo);
  let lastRemoval;
  const list = document.createElement("ul");
  list.className = "saved-posts";
  const noBookmarks = t("You have no saved links.", "暂无已保存链接。");
  const noMatches = t("No saved links match these filters.", "没有符合筛选条件的已保存链接。");
  const statusIncomplete = t("Some matching links could not be checked. Choose “Status not verified” to see them.", "部分符合搜索和类型条件的链接暂时无法核验。请选择「状态尚未核验」查看。");
  const filterFeedback = notice("");
  filterFeedback.classList.add("saved-filter-message");
  const empty = notice("");
  empty.classList.add("saved-filter-message");
  page.append(heading, description);
  if (offline) page.append(notice(t("Reconnect to open posts and check their current status.", "重新联网即可打开帖子并查看最新状态。")));
  page.append(filters);
  if (!offline) page.append(refreshControls, filterFeedback);
  page.append(recovery, list, empty);
  host.replaceChildren(page);

  let returnPath;
  const savedView = () => !offline && history.state?.scaleTagSavedView;
  const stopRestoringFocus = () => { returnPath = undefined; };
  page.addEventListener("pointerdown", stopRestoringFocus);
  page.addEventListener("keydown", stopRestoringFocus);
  page.addEventListener("wheel", stopRestoringFocus, { passive: true });

  function updateSavedHistory(view) {
    try {
      const state = { ...history.state };
      if (view) state.scaleTagSavedView = view;
      else delete state.scaleTagSavedView;
      history.replaceState(state, "");
    } catch {
      // Navigation works even if the browser refuses to store its state.
    }
  }

  function restoreSavedView(view) {
    search.value = typeof view.query === "string" ? view.query.slice(0, search.maxLength) : "";
    for (const [select, value] of [[typeFilter, view.type], [statusFilter, view.status]]) {
      if ([...select.options].some(option => option.value === value)) select.value = value;
    }
    if (typeof view.path === "string" && isSavedPath(view.path)) returnPath = view.path;
  }

  if (!offline) document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    if (list.contains(link)) {
      const path = link.pathname + link.hash;
      updateSavedHistory({ path, query: search.value, type: typeFilter.value, status: statusFilter.value });
    } else if (savedView() && !link.getAttribute("href").startsWith("#")) updateSavedHistory();
  });

  const normalize = value => value.normalize("NFKC").toLowerCase().trim();
  const isUnavailableRow = row => row.dataset.linkStatus === "unavailable" || row.dataset.postStatus === "unavailable";
  function syncRemoveUnavailable() {
    const hide = offline || !navigator.onLine || ![...list.children].some(isUnavailableRow);
    if (hide && document.activeElement === removeUnavailable) {
      const target = filters.hidden ? heading : (statusFilter ?? search);
      if (target === heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      target?.focus({ preventScroll: true });
    }
    removeUnavailable.hidden = hide;
  }
  function applyFilters() {
    const query = normalize(search.value);
    const type = typeFilter.value;
    const status = statusFilter?.value ?? "all";
    const focusedRow = document.activeElement?.closest(".saved-posts li");
    let matched = false;
    let hiddenByStatusFailure = false;
    for (const row of list.children) {
      const matchesDetails = (type === "all" || type === row.dataset.postType) && row.dataset.searchTitle.includes(query);
      const matchesStatus = status === "all" || status === row.dataset.linkStatus;
      row.hidden = !matchesDetails || !matchesStatus;
      matched ||= !row.hidden;
      hiddenByStatusFailure ||= matchesDetails && !matchesStatus && row.hasAttribute("data-status-check-failed");
    }
    if (focusedRow?.hidden && list.contains(focusedRow)) statusFilter?.focus();
    filters.hidden = !list.childElementCount;
    if (filters.hidden && document.activeElement === refreshButton) heading.focus();
    refreshControls.hidden = filters.hidden;
    clear.hidden = !search.value && type === "all" && status === "all";
    syncRemoveUnavailable();
    const filterMessage = hiddenByStatusFailure ? statusIncomplete : "";
    if (filterFeedback.textContent !== filterMessage) filterFeedback.textContent = filterMessage;
    const message = matched || hiddenByStatusFailure ? "" : filters.hidden ? noBookmarks : noMatches;
    if (empty.textContent !== message) empty.textContent = message;
    if (returnPath && document.activeElement === document.body) {
      const link = [...list.querySelectorAll("li:not([hidden]) .saved-post-details > a")]
        .find(link => link.getAttribute("href") === returnPath);
      const checkingLink = status !== "all" && link?.nextElementSibling?.textContent === checking;
      if (link && !checkingLink) {
        stopRestoringFocus();
        link.focus();
      }
    }
  }
  function filtersChanged() {
    if (savedView()) updateSavedHistory();
    stopRestoringFocus();
    applyFilters();
  }
  search.oninput = filtersChanged;
  typeFilter.onchange = filtersChanged;
  if (statusFilter) statusFilter.onchange = filtersChanged;
  clear.onclick = () => {
    search.value = "";
    typeFilter.value = "all";
    if (statusFilter) statusFilter.value = "all";
    search.focus();
    filtersChanged();
  };
  removeUnavailable.onclick = () => withLocalLock(savedKey, () => {
    const unavailablePaths = new Set(
      [...list.children]
        .filter(isUnavailableRow)
        .map(row => row.querySelector(".saved-post-details > a")?.getAttribute("href"))
        .filter(Boolean),
    );
    if (!unavailablePaths.size) {
      syncRemoveUnavailable();
      return;
    }
    const items = savedPosts();
    const entries = [];
    const remaining = [];
    items.forEach((item, index) => {
      if (unavailablePaths.has(item.path)) {
        entries.push({
          item: { path: item.path, title: item.title },
          index,
          previousPath: items.slice(0, index).findLast(prev => !unavailablePaths.has(prev.path))?.path,
          nextPath: items.slice(index + 1).find(next => !unavailablePaths.has(next.path))?.path,
        });
      } else {
        remaining.push(item);
      }
    });
    if (!entries.length) {
      render();
      return;
    }
    if (!write(savedKey, remaining)) {
      recoveryStatus.textContent = unavailable();
      return;
    }
    lastRemoval = { entries };
    recoveryStatus.textContent = entries.length === 1
      ? t("Saved link removed.", "已移除保存的链接。")
      : `${t("Removed unavailable links.", "已移除不可用链接。")} (${entries.length})`;
    undo.hidden = false;
    for (const row of [...list.children]) {
      const rowPath = row.querySelector(".saved-post-details > a")?.getAttribute("href");
      if (rowPath && unavailablePaths.has(rowPath)) {
        const [, kind, id] = rowPath.split("#", 1)[0].split("/");
        const tag = `${kind === "vote" ? "poll" : kind}:${id}`;
        const statusEl = row.querySelector(".saved-post-status");
        const lookup = lookups.get(tag);
        if (lookup && statusEl) {
          lookup.labels.delete(statusEl);
          if (!lookup.labels.size) lookups.delete(tag);
        }
        row.remove();
      }
    }
    if (!lookups.size) cancelStatusRefresh();
    applyFilters();
    undo.focus({ preventScroll: true });
  }).catch(() => { recoveryStatus.textContent = unavailable(); });
  undo.onclick = () => withLocalLock(savedKey, () => {
    if (!lastRemoval?.entries?.length) return;
    const entries = [...lastRemoval.entries].sort((a, b) => a.index - b.index);
    const items = savedPosts();
    const missing = entries.filter(({ item }) => !items.some(existing => existing.path === item.path));
    if (missing.length) {
      if (items.length + missing.length > savedLimit) {
        recoveryStatus.textContent = t("Could not restore the link because this browser’s saved links are full.", "此浏览器的收藏已满，暂时无法恢复链接。");
        return;
      }
      if (entries.length === 1) {
        const [{ item, previousPath, nextPath, index }] = missing;
        const next = nextPath ? items.findIndex(existing => existing.path === nextPath) : -1;
        const previous = previousPath ? items.findIndex(existing => existing.path === previousPath) : -1;
        const position = next >= 0 ? next : previous >= 0 ? previous + 1 : Math.min(index, items.length);
        items.splice(position, 0, { path: item.path, title: item.title });
      } else {
        for (const { item, index } of missing) {
          if (!items.some(existing => existing.path === item.path)) {
            items.splice(Math.min(index, items.length), 0, { path: item.path, title: item.title });
          }
        }
      }
      if (!write(savedKey, items)) {
        recoveryStatus.textContent = unavailable();
        return;
      }
    }
    const focusPath = entries[0].item.path;
    lastRemoval = undefined;
    undo.hidden = true;
    recoveryStatus.textContent = t("Saved link restored.", "已恢复保存的链接。");
    render();
    const link = list.querySelector(`li:not([hidden]) a[href="${focusPath}"]`);
    (link ?? statusFilter ?? search).focus();
  }).catch(() => { recoveryStatus.textContent = unavailable(); });

  const labels = new Map([
    ["poll_open", t("Open for votes", "投票进行中")],
    ["poll_final", t("Final results", "最终结果")],
    ["task_open", t("Open", "开放中")],
    ["task_assigned", t("Already assigned", "已有接单人")],
    ["task_reply_closed", t("Reply deadline passed", "已截止回复")],
    ["task_in_progress", t("In progress", "进行中")],
    ["task_completed", t("Completed", "已完成")],
    ["task_closed", t("Closed", "已关闭")],
    ["wanted_open", t("Seeking", "求赠中")],
    ["wanted_in_progress", t("Arranging pickup", "正在安排领取")],
    ["wanted_completed", t("Item received", "已收到")],
    ["wanted_closed", t("Closed", "已关闭")],
    ["found_open", t("Accepting claims", "接受认领")],
    ["found_in_progress", t("Arranging return", "正在安排归还")],
    ["found_completed", t("Returned", "已归还")],
    ["found_closed", t("Closed", "已关闭")],
    ["sale_open", t("Available", "可领取")],
    ["sale_reserved", t("Reserved", "已保留")],
    ["sale_claimed", t("Claimed", "已领取")],
    ["unavailable", t("Post link unavailable", "帖子链接不可用")],
  ]);
  const checking = t("Checking post status…", "正在查看帖子状态…");
  const failed = t("Could not check post status.", "暂时无法查看帖子状态。");
  const lookups = new Map();

  const reconnect = t("Reconnect to refresh link statuses.", "联网后可刷新链接状态。");
  let request, refreshTimer;
  let manuallyRefreshing = false;
  function syncRefreshButton() {
    refreshButton.setAttribute("aria-disabled", String(Boolean(request) || !navigator.onLine));
    if (!navigator.onLine) refreshFeedback.textContent = reconnect;
    else if (refreshFeedback.textContent === reconnect) refreshFeedback.textContent = "";
  }

  function replaceStatusRequest(nextRequest) {
    clearTimeout(refreshTimer);
    const previousRequest = request;
    request = nextRequest;
    previousRequest?.abort();
    syncRefreshButton();
    if (!lookups.size) {
      manuallyRefreshing = false;
      refreshFeedback.textContent = "";
    }
  }
  const cancelStatusRefresh = () => replaceStatusRequest();

  async function refreshStatuses() {
    const controller = lookups.size && page.isConnected && !document.hidden ? new AbortController() : undefined;
    replaceStatusRequest(controller);
    if (!controller) return;
    const { signal } = controller;
    const entries = [...lookups.values()];
    let nextRefresh = Infinity;
    let hadError = false;
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
        hadError = true;
        // An unavailable connection does not change the saved links.
      }
      if (signal.aborted) return;
      batch.forEach((lookup, index) => {
        const status = statuses[index];
        const label = labels.get(status);
        const linkStatus = !label ? "unverified" : status === "unavailable" ? status : "available";
        hadError ||= !label;
        for (const output of lookup.labels) {
          output.textContent = label ?? failed;
          const row = output.closest("li");
          row.toggleAttribute("data-status-check-failed", !label);
          row.dataset.linkStatus = linkStatus;
          row.dataset.postStatus = linkStatus;
        }
      });
      applyFilters();
    }
    if (signal.aborted) return;
    request = undefined;
    syncRefreshButton();
    if (manuallyRefreshing && navigator.onLine) {
      refreshFeedback.textContent = hadError
        ? t("Could not refresh all link statuses.", "暂时无法刷新全部链接状态。")
        : t("Link statuses refreshed.", "链接状态已刷新。");
    }
    manuallyRefreshing = false;
    if (lookups.size) {
      stopRestoringFocus();
      const delay = Math.min(Math.max(100, nextRefresh - performance.now()), hadError ? 30000 : Infinity);
      if (Number.isFinite(delay)) refreshTimer = setTimeout(refreshStatuses, Math.min(delay, 2 ** 31 - 1));
    }
  }

  refreshButton.onclick = () => {
    if (request || !navigator.onLine || !lookups.size) return;
    manuallyRefreshing = true;
    refreshFeedback.textContent = checking;
    void refreshStatuses();
  };

  function render() {
    lookups.clear();
    list.replaceChildren();
    const items = savedPosts();
    if (returnPath && !items.some(item => item.path === returnPath)) stopRestoringFocus();
    // Another tab may have saved the removed link again; the undo offer no longer applies.
    if (lastRemoval?.entries?.length && lastRemoval.entries.every(({ item }) => items.some(saved => saved.path === item.path))) {
      lastRemoval = undefined;
      undo.hidden = true;
      recoveryStatus.textContent = "";
    }
    for (const [path, title] of new Map(items.map(item => [item.path, item.title]))) {
      const row = document.createElement("li");
      const details = document.createElement("div");
      details.className = "saved-post-details";
      const link = document.createElement("a");
      link.href = path;
      link.textContent = title;
      const management = path.endsWith("/manage");
      if (management) link.append(` · ${t("Management URL", "管理网址")}`);
      if (replyPath.test(path)) link.append(` · ${t("Public reply", "公开回复")}`);
      const [, kind, id] = path.split("#", 1)[0].split("/");
      const type = kind === "vote" ? "poll" : kind;
      row.dataset.postType = type;
      row.dataset.searchTitle = normalize(title);
      const tag = `${type}:${id}`;
      let status;
      details.append(link);
      if (!offline) {
        row.dataset.linkStatus = "unverified";
        row.dataset.postStatus = "unverified";
        status = document.createElement("span");
        status.className = "field-hint saved-post-status";
        status.id = `saved-status-${list.childElementCount}`;
        status.textContent = checking;
        link.setAttribute("aria-describedby", status.id);
        if (!lookups.has(tag)) lookups.set(tag, { type, id, labels: new Set() });
        lookups.get(tag).labels.add(status);
        details.append(status);
      }
      const controls = document.createElement("div");
      controls.className = "saved-post-actions";
      const copy = button(management ? t("Copy management URL", "复制管理网址") : t("Copy link", "复制链接"));
      const feedback = notice("");
      feedback.classList.add("saved-copy-status");
      const fallback = document.createElement("label");
      fallback.className = "saved-copy-fallback";
      fallback.hidden = true;
      fallback.textContent = management ? t("Management URL", "管理网址") : t("Public link", "公开链接");
      const url = document.createElement("input");
      url.readOnly = true;
      fallback.append(url);
      copy.onclick = async () => {
        feedback.textContent = "";
        const address = new URL(path, location.origin).href;
        try {
          await navigator.clipboard.writeText(address);
          fallback.hidden = true;
          feedback.textContent = t("Link copied.", "链接已复制。");
        } catch {
          if (!copy.isConnected || row.hidden) return;
          url.value = address;
          fallback.hidden = false;
          url.focus();
          url.select();
          feedback.textContent = t("Copy the selected link.", "请复制选中的链接。");
        }
      };
      const remove = button(t("Remove", "移除"));
      remove.onclick = () => withLocalLock(savedKey, () => {
        const items = savedPosts();
        const index = items.findIndex(item => item.path === path);
        if (index < 0) {
          render();
          (filters.hidden ? heading : search).focus();
          return;
        }
        if (!write(savedKey, items.filter(item => item.path !== path))) {
          description.textContent = unavailable();
          return;
        }
        lastRemoval = {
          entries: [{
            item: {
              path,
              title: items.findLast(item => item.path === path).title,
            },
            index,
            previousPath: items[index - 1]?.path,
            nextPath: items.slice(index + 1).find(item => item.path !== path)?.path,
          }],
        };
        recoveryStatus.textContent = t("Saved link removed.", "已移除保存的链接。");
        undo.hidden = false;
        if (!row.isConnected) {
          render();
          undo.focus();
          return;
        }
        const lookup = lookups.get(tag);
        if (lookup) {
          lookup.labels.delete(status);
          if (!lookup.labels.size) lookups.delete(tag);
        }
        if (!lookups.size) cancelStatusRefresh();
        const visible = [...list.children].filter(item => !item.hidden);
        const position = visible.indexOf(row);
        const neighbor = visible[position + 1] ?? visible[position - 1];
        row.remove();
        applyFilters();
        (neighbor?.querySelector("a") ?? undo).focus();
      }).catch(() => { description.textContent = unavailable(); });
      controls.append(copy, remove);
      details.append(feedback);
      row.append(details, controls, fallback);
      list.append(row);
    }
    applyFilters();
    void refreshStatuses();
  }

  const fromHistory = performance.getEntriesByType("navigation")[0]?.type === "back_forward";
  if (!fromHistory && savedView()) updateSavedHistory();
  if (!fromHistory || !savedView()) render();
  window.addEventListener("storage", (event) => {
    if (savedLinksChanged(event)) render();
  });
  document.addEventListener("visibilitychange", refreshStatuses);
  window.addEventListener("online", () => {
    syncRemoveUnavailable();
    void refreshStatuses();
  });
  window.addEventListener("offline", () => {
    syncRemoveUnavailable();
    void refreshStatuses();
  });
  window.addEventListener("pagehide", cancelStatusRefresh);
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted && !fromHistory) return;
    const view = savedView();
    if (view) {
      // Restore after the browser has restored its own persisted form state.
      setTimeout(() => {
        restoreSavedView(view);
        render();
      }, 0);
    } else if (event.persisted) render();
  });
}
