import { language, t, translateError } from "/locale.js";
if (typeof document !== "undefined") document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
if (language === "zh") {
  const labels = {
    ".skip-link": "跳至内容",
    '[data-nav="create"]': "创建帖子",
    ".site-footer > div:first-child p": "一个问题，一个地方，七天时间。",
    "#install-app": "安装应用",
    '.footer-links a[href="/privacy"]': "隐私与数据保留",
    ".footer-links span": "让身边的交流更简单。",
    "#connection-status": "当前处于离线状态。发布、投票、点赞和回复需要联网，显示的结果可能不是最新的。",
    "#install-title": "安装 ScaleTag",
    ".install-dialog > p:not([id])": "将 ScaleTag 放在主屏幕。发布、投票和查看实时结果仍需网络连接。",
    "#install-native": "安装 ScaleTag",
    ".install-dialog dd:first-of-type": "在 Safari 中打开 ScaleTag，点击分享，然后选择添加到主屏幕。如果出现“作为网页应用打开”，请选择它。",
    ".install-dialog dt:last-of-type": "安卓或电脑",
    ".install-dialog dd:last-of-type": "打开浏览器菜单，选择安装应用或添加到主屏幕（如果可用）。",
    "#install-message": "无需应用商店账号。",
    "#app-update strong": "新版本已准备就绪。",
    "#app-update p": "更新前请完成或复制草稿。",
    "#apply-update": "更新并重新加载",
    "#dismiss-update": "稍后",
    ".loading-state": "正在加载…",
  };
  for (const [selector, text] of Object.entries(labels)) {
    const node = document.querySelector(selector);
    if (node) node.textContent = text;
  }
  document.querySelector("nav")?.setAttribute("aria-label", "主导航");
  document.querySelector("#close-install")?.setAttribute("aria-label", "关闭安装指南");
  document.querySelector("#app-update")?.setAttribute("aria-label", "应用更新");
  document.querySelector("#dismiss-update")?.setAttribute("title", "下次访问时提醒我");
}
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
  new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
const shortDate = (time) =>
  new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric" }).format(
    new Date(time),
  );
const count = (value) => new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en").format(value);
const percent = (votes, total) =>
  total ? ((votes / total) * 100).toFixed(1).replace(/\.0$/, "") : "0";
function remaining(end, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((end - now) / 60000));
  if (!minutes) return t("Voting closed", "投票已结束");
  if (minutes >= 1440)
    return t(`${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h left`, `剩余 ${Math.floor(minutes / 1440)} 天 ${Math.floor((minutes % 1440) / 60)} 小时`);
  return minutes >= 60
    ? t(`${Math.floor(minutes / 60)}h ${minutes % 60}m left`, `剩余 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`)
    : t(`${minutes}m left`, `剩余 ${minutes} 分钟`);
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
      t("You’re offline. Reconnect to publish, vote or load current results.", "当前离线。请重新连接后发布、投票或查看最新结果。"),
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
    throw new Error(t("Could not connect. Check your connection and try again.", "无法连接。请检查网络后重试。"));
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      t("The service is temporarily unavailable. Please try again.", "服务暂时不可用，请重试。"),
    );
  }
  if (!response.ok) {
    const error = new Error(
      translateError(data.error ?? t("Something went wrong. Please try again.", "操作失败，请重试。")),
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
          t("Location is not supported in this browser. Try a browser with location access.", "此浏览器不支持定位。请使用支持定位的浏览器。"),
        ),
      );
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === 1
              ? t("Location permission is required. Allow it in your browser settings and try again.", "需要定位权限。请在浏览器设置中允许定位后重试。")
              : e.code === 3
                ? t("Location timed out. Please try again.", "定位超时，请重试。")
                : t("Your location is unavailable. Check your device location settings and try again.", "无法获取位置。请检查设备定位设置后重试。"),
          ),
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}
function notice() {
  return `<div class="retention-note">${icons.clock}<div><strong>${t("Public for 30 days. Backed up for recovery.", "公开 30 天，并保留用于灾难恢复的备份。")}</strong><p>${t("Posts leave the website 30 days after publication. Private daily backups are retained for up to 90 days after each backup is created. Save anything you need before the public link expires.", "帖子发布 30 天后从网站移除。每日私有备份自创建起最多保留 90 天。请在公开链接失效前保存需要的内容。")}</p></div></div>`;
}
const DATA_IMAGE_PATTERN =
  /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function photoFields(prefix, label = t("Photos (optional)", "照片（选填）")) {
  return `<label for="${prefix}-images">${label}</label><input id="${prefix}-images" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby="${prefix}-image-hint ${prefix}-image-error"><p class="field-hint" id="${prefix}-image-hint">${t("Up to 3 JPEG, PNG or WebP photos. Each original must be at most 1 MiB (1,048,576 bytes). Originals are uploaded to the server for validation. Photos over 600 KiB are compressed to at most 300 KiB; smaller photos keep as much quality as possible. Photos are public; check for faces, addresses and other private details.", "最多 3 张 JPEG、PNG 或 WebP 照片，每张原图不超过 1 MiB（1,048,576 字节）。原图上传后由服务器验证，超过 600 KiB 的照片会压至不超过 300 KiB；较小的照片尽量保留画质。照片会公开，请先检查是否露出人脸、地址或其他隐私。")}</p><p id="${prefix}-image-error" class="form-error" role="alert" hidden></p><div id="${prefix}-photo-preview" class="sale-photo-preview"></div>`;
}
function bindPhotoInput(root, prefix) {
  const filesInput = root.querySelector(`#${prefix}-images`);
  const imageError = root.querySelector(`#${prefix}-image-error`);
  const preview = root.querySelector(`#${prefix}-photo-preview`);
  function validateFiles() {
    const files = [...(filesInput?.files ?? [])];
    if (files.length > 3)
      throw new Error(
        t("Choose no more than 3 photos.", "最多只能选择 3 张照片。"),
      );
    for (const file of files) {
      if (file.size > 1048576)
        throw new Error(
          t(
            `${file.name}: the original photo exceeds 1 MiB. Choose a smaller original.`,
            `${file.name}：原图超过 1 MiB，请选择较小的原图。`,
          ),
        );
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new Error(
          t(
            `${file.name}: choose a JPEG, PNG or WebP photo.`,
            `${file.name}：请选择 JPEG、PNG 或 WebP 照片。`,
          ),
        );
    }
    return files;
  }
  let previewURLs = [];
  function clearPreviews() {
    previewURLs.forEach((url) => URL.revokeObjectURL(url));
    previewURLs = [];
    preview?.replaceChildren();
  }
  filesInput.onchange = () => {
    clearPreviews();
    imageError.hidden = true;
    try {
      for (const file of validateFiles()) {
        const url = URL.createObjectURL(file);
        previewURLs.push(url);
        const figure = document.createElement("figure"),
          img = document.createElement("img"),
          caption = document.createElement("figcaption");
        img.src = url;
        img.alt = file.name;
        caption.textContent = `${file.name} · ${Math.ceil(file.size / 1024)} KiB`;
        figure.append(img, caption);
        preview.append(figure);
      }
    } catch (e) {
      imageError.textContent = e.message;
      imageError.hidden = false;
    }
  };
  window.addEventListener(
    "pagehide",
    () => previewURLs.forEach((url) => URL.revokeObjectURL(url)),
    { once: true },
  );
  return {
    validateFiles,
    async readImages(progressNode) {
      const files = validateFiles();
      if (!files.length) return [];
      if (progressNode)
        progressNode.textContent = t(
          "Preparing original photos…",
          "正在读取原始照片…",
        );
      const images = await Promise.all(
        files.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () =>
                reject(
                  new Error(
                    t(
                      "Could not read a photo. Select it again.",
                      "无法读取照片，请重新选择。",
                    ),
                  ),
                );
              reader.readAsDataURL(file);
            }),
        ),
      );
      if (progressNode)
        progressNode.textContent = t(
          "Uploading and checking photos. Please wait…",
          "正在上传并验证照片，请稍候…",
        );
      return images;
    },
  };
}
function uploadedPhotosHtml(images = [], labelEn = "Photo", labelZh = "照片") {
  const valid = (images ?? []).filter((src) => DATA_IMAGE_PATTERN.test(src));
  if (!valid.length) return "";
  return `<div class="sale-photos">${valid
    .map(
      (src, i) =>
        `<img src="${escape(src)}" alt="${t(`${labelEn} ${i + 1}`, `${labelZh} ${i + 1}`)}" loading="lazy">`,
    )
    .join("")}</div>`;
}

export {
  t,
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
  DATA_IMAGE_PATTERN,
  photoFields,
  bindPhotoInput,
  uploadedPhotosHtml,
};

export function managementPasswordForm(unlock) {
  main.innerHTML = `<section class="empty-page"><form id="manage-password-form" class="form-card">
    <h1>${t("Manage this post", "管理此帖子")}</h1>
    <label for="manage-password">${t("Management password", "管理密码")}</label>
    <input id="manage-password" type="password" autocomplete="off" maxlength="64" required>
    <button class="button" type="submit">${t("Unlock", "解锁")}</button>
    <p class="form-error" role="alert" hidden></p>
  </form></section>`;
  const form = main.querySelector("#manage-password-form");
  const input = form.querySelector("input");
  const submit = form.querySelector("button");
  const error = form.querySelector(".form-error");
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    error.hidden = true;
    try {
      await unlock(input.value.trim());
      input.value = "";
    } catch (e) {
      error.textContent = e.status === 403
        ? t("The management password is invalid.", "管理密码不正确。")
        : e.message;
      error.hidden = false;
      input.select();
    } finally {
      submit.disabled = false;
    }
  };
}

export function managementDetails(url) {
  return `<p>${t("Save the management URL and password. The password cannot be recovered if lost.", "请保存管理网址和密码。密码丢失后无法找回。")}</p>
    <label for="manage-link">${t("Management URL", "管理网址")}</label>
    <input id="manage-link" readonly value="${escape(url)}">
    <button id="copy-manage-link" type="button" class="button secondary small">${t("Copy URL and password", "复制网址和密码")}</button>
    <div id="manage-copy-fallback" hidden>
      <label for="manage-copy-text">${t("Management details to copy", "可复制的管理信息")}</label>
      <textarea id="manage-copy-text" readonly rows="3"></textarea>
    </div>`;
}

export function bindManagementCopy(url, key) {
  main.querySelector("#copy-manage-link").onclick = async () => {
    const message = t(`Management URL: ${url}\nManagement password: ${key}`, `管理网址：${url}\n管理密码：${key}`);
    try {
      await navigator.clipboard.writeText(message);
      toast(t("Management details copied.", "管理信息已复制。"));
    } catch {
      const input = main.querySelector("#manage-copy-text");
      main.querySelector("#manage-copy-fallback").hidden = false;
      input.value = message;
      input.focus();
      input.select();
      toast(t("Copy the selected management details.", "请复制选中的管理信息。"));
    }
  };
}
