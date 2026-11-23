import { t } from "/locale.js";

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

// Only explicit public form fields are accepted. Never serialize a form or its URL.
export function bindTextDraft(form, kind, selectors, options) {
  const key = `scaletag-text-draft-${kind}`;
  const fields = selectors.map((selector) => form.querySelector(selector));
  const defaults = fields.map((field) => field.value);
  const saved = read(key, {});
  const status = notice(t("Text drafts stay in this browser.", "文字草稿仅保存在此浏览器。"));
  const clear = button(t("Clear draft", "清除草稿"));
  const controls = document.createElement("div");
  controls.className = "local-post-controls";
  controls.append(status, clear);
  form.querySelector(".form-heading").after(controls);

  function restore(fieldsToRestore, choices) {
    fields.forEach((field, i) => {
      const value = fieldsToRestore?.[i];
      if (typeof value !== "string") return;
      field.value = field.maxLength > 0 ? value.slice(0, field.maxLength) : value;
      if (field instanceof HTMLSelectElement && field.selectedIndex < 0) field.value = defaults[i];
    });
    options?.restore(choices);
  }
  if (Array.isArray(saved?.fields)) {
    restore(saved.fields, saved.choices);
    status.textContent = t("Text draft restored.", "已恢复文字草稿。");
  }
  clear.hidden = !Array.isArray(saved?.fields);
  let lastSaved = Array.isArray(saved?.fields) ? saved : undefined;

  function save() {
    const draft = { fields: fields.map((field) => field.value), choices: options?.read() };
    if (write(key, draft)) {
      lastSaved = draft;
      status.textContent = t("Text draft saved on this browser.", "文字草稿已保存在此浏览器。");
      clear.hidden = false;
    } else status.textContent = unavailable();
  }
  function onInput(event) {
    if (fields.includes(event.target) || options?.contains(event.target)) save();
  }
  form.addEventListener("input", onInput);
  form.addEventListener("change", onInput);
  clear.onclick = () => {
    if (!write(key)) {
      status.textContent = unavailable();
      return;
    }
    restore(defaults);
    lastSaved = undefined;
    fields[0].dispatchEvent(new Event("draftreset", { bubbles: true }));
    status.textContent = t("Text draft cleared.", "文字草稿已清除。");
    clear.hidden = true;
  };
  return {
    save,
    snapshot: () => JSON.stringify(lastSaved),
    published(submittedDraft) {
      // This or another tab may have edited the draft while the request was pending.
      if (JSON.stringify(read(key)) === submittedDraft) write(key);
    },
  };
}

export function mountSavedPost(host, { path, title }) {
  if (!host || !postPath.test(path)) return;
  const management = path.endsWith("/manage");
  const control = button("");
  const status = notice("");
  status.hidden = true;
  function render() {
    const selected = savedPosts().some((item) => item.path === path);
    control.setAttribute("aria-pressed", String(selected));
    control.textContent = selected
      ? t("Remove from saved links", "从已保存链接移除")
      : management ? t("Save management link", "保存管理网址") : t("Save post", "保存帖子");
  }
  control.onclick = () => {
    const items = savedPosts();
    const index = items.findIndex((item) => item.path === path);
    if (index >= 0) items.splice(index, 1);
    else items.unshift({ path, title });
    status.hidden = write(savedKey, items.slice(0, 100));
    status.textContent = status.hidden ? "" : unavailable();
    render();
  };
  render();
  host.append(control, status);
}

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
  function render() {
    const items = savedPosts();
    empty.hidden = items.length > 0;
    list.replaceChildren(...items.map(({ path, title }) => {
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.href = path;
      link.textContent = title;
      if (path.endsWith("/manage")) link.append(` · ${t("Management URL", "管理网址")}`);
      const remove = button(t("Remove", "移除"));
      remove.onclick = () => {
        if (write(savedKey, savedPosts().filter((item) => item.path !== path))) render();
        else description.textContent = unavailable();
      };
      row.append(link, remove);
      return row;
    }));
  }
  render();
}
