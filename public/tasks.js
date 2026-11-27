import { renderIntroFlow } from "/help.js";
import { localizedPath } from "/locale.js";
import {
  main,
  api,
  escape,
  icons,
  date,
  locate,
  bindPostVisibility,
  postVisibilityFields,
  notice,
  toast,
  t,
  photoFields,
  bindPhotoInput,
  uploadedPhotosHtml,
  managementPasswordForm,
  managementDetails,
  bindManagementCopy,
  mountNativeShare,
  setActiveNav,
  postKindSwitch,
  showFormError,
  bindCharCounter,
} from "/common.js";
import { mountSocial } from "/social.js";
import { mountPosterActions } from "/poster.js";
import { bindTextDraft, mountSavedPost } from "/local-posts.js";
import { mountOwnerEdit, refreshOwnerPreview } from "/owner-edit.js";
import {
  createTaskCredentials,
  deriveTaskAuthKey,
  unwrapTaskPrivateKey,
  decryptReplyContacts,
} from "/task-crypto.js";

export function createTask(wanted = false) {
  document.title = wanted ? t("Ask for an item — ScaleTag", "发布求赠 — ScaleTag") : t("Create a task — ScaleTag", "发布任务 — ScaleTag");
  setActiveNav("create");
  main.innerHTML = `<section class="create-section"><aside class="section-intro"><a class="back-link" href="/">${t("← Back to home", "← 返回首页")}</a>${wanted ? "" : `<span class="eyebrow">${t("MAKE SOMETHING HAPPEN", "需要帮忙？")}</span>`}<h1>${wanted ? t("Ask for an item", "向邻里求赠") : t("A little help.<br>A local <em>connection.</em>", "需要帮忙？<br><em>让身边的人搭把手。</em>")}</h1><p>${wanted ? t("Describe the free item you are looking for. A neighbor who has one can offer it and share contact details privately.", "说明你希望免费获得什么。手边有这件物品的邻居可以提出赠予，并私下留下联系方式。") : t("Share a task and the reward you offer. People can reply with a way to reach them.", "说说你需要什么帮助，以及愿意提供什么酬谢。感兴趣的人可以回复并留下联系方式。")}</p>${renderIntroFlow(wanted ? "wanted" : "tasks")}<div class="rules"><p>${icons.pin} ${t("Public posts require location.", "公开帖需要位置信息。")}</p><p>${icons.clock} ${t("Tasks stay on the website for 30 days.", "任务发布后保留 30 天。")}</p><p>${icons.shield} ${t("No accounts. Contact each other directly.", "无需注册，双方直接联系。")}</p></div></aside><form id="task-form" class="form-card">${postKindSwitch(wanted ? "/create/wanted" : "/create/task")}<div class="form-heading"><h2>${wanted ? t("New item request", "发布新求赠") : t("Your new task", "发布新任务")}</h2>${wanted ? "" : `<span class="pill">${t("LOCAL TASK", "本地任务")}</span>`}</div><label for="task-title">${wanted ? t("Item wanted", "想找的物品") : t("Title", "标题")}</label><input id="task-title" maxlength="140" aria-describedby="task-title-count" required placeholder="${wanted ? t("e.g. Moving boxes", "例如：搬家用的纸箱") : t("What could someone help you with?", "你需要什么帮助？")}"><div class="field-hint"><span>${t("Character count", "字数")}</span><span id="task-title-count"></span></div><p id="task-title-limit-status" class="field-hint reply-length-status" role="status"></p><label for="task-description">${t("Description", "描述")}</label><textarea id="task-description" maxlength="4000" rows="6" aria-describedby="task-description-count" required placeholder="${wanted ? t("Describe the free item you are looking for.", "说明你希望免费获得什么。") : t("Describe the task and what you need.", "介绍一下任务，以及你需要什么帮助。")}"></textarea><div class="field-hint"><span>${t("Character count", "字数")}</span><span id="task-description-count"></span></div><p id="task-description-limit-status" class="field-hint reply-length-status" role="status"></p>${wanted ? "" : `<label for="task-reward">${t("Reward", "酬谢")}</label><input id="task-reward" maxlength="160" aria-describedby="task-reward-hint task-reward-count" required placeholder="${t("e.g. CAD 30, a coffee, or a thank-you", "例如：30 加元、一杯咖啡或一句感谢")}"><div class="field-hint"><span id="task-reward-hint">${t("A description of your offer. ScaleTag does not collect, hold or transfer money.", "说明你愿意提供什么酬谢。ScaleTag 不收取、保管或转账资金。")}</span><span id="task-reward-count"></span></div><p id="task-reward-limit-status" class="field-hint reply-length-status" role="status"></p>`}${photoFields("task", t("Photos (optional)", "任务照片（选填）"))}<label for="task-name">${t("Your name ", "你的名字 ")}<span class="optional">${t("optional, unverified", "选填，未经验证")}</span></label><input id="task-name" maxlength="60" placeholder="${t("Anonymous", "匿名")}">${postVisibilityFields()}<fieldset class="post-location-fields"><legend class="sr-only">${t("Post location", "帖子位置")}</legend><div class="location-box"><div><strong>${icons.pin} ${t("Give your task a place", "添加任务位置")}</strong><p id="task-location-status" aria-live="polite">${t("People can discover your task nearby.", "添加位置后，附近的人更容易找到你的任务。")}</p></div><button id="task-locate" class="button secondary small" type="button">${t("Enable location", "获取位置")}</button></div><p class="field-hint">${t("Only a rounded area is shown on the map. It can still reveal your neighbourhood.", "地图只显示大致区域，但仍可能透露你所在的社区。")}</p><label class="checkbox-row"><input id="task-map-consent" type="checkbox" required><span>${t("I agree to show my task’s approximate area publicly on the map. This does not guarantee anonymity.", "我同意在地图上公开显示任务的大致区域。我了解这不能保证匿名。")}</span></label></fieldset>${notice()}<label class="checkbox-row"><input id="task-retention" type="checkbox" required><span>${t("I understand that this task, its replies and contact details leave the website 30 days after publication. Private daily backups are retained for up to 90 days after creation.", "我了解任务、回复及联系方式会在任务发布 30 天后从网站移除，私有每日备份从创建之日起最多保留 90 天。")}</span></label><p class="field-hint">${t("Task descriptions, rewards and names are unverified and public. Respondents’ names and messages are public; their phone numbers and email addresses are shown only on your private management page, so keep that link safe.", "任务描述、酬谢和姓名会公开显示，且未经验证。回复者的姓名和留言也是公开的；电话和邮箱只显示在私人管理页面，请妥善保管管理链接。")}</p><p class="field-hint" role="note"><strong>${t("Keep your management password safe. If it is lost, encrypted contact details cannot be recovered.", "请务必妥善保存管理密码。密码丢失后，加密的联系方式无法恢复。")}</strong></p><p class="field-hint" role="note">${t("Disclaimer: Posts are supplied by users and are not verified by ScaleTag. Publishers are responsible for their content; users should exercise their own judgment. ScaleTag does not participate in transactions.", "免责声明：信息由用户发布，ScaleTag 不对内容进行核实。发布者对其内容负责，使用者应自行判断；ScaleTag 不参与交易。")}</p><button id="publish-task" class="button publish-button" type="submit">${wanted ? t("Publish item request", "发布求赠") : t("Publish my task ", "发布任务 ")} ${icons.arrow}</button><p id="task-error" class="form-error" role="alert" hidden></p></form></section>`;
  let position,
    locatedAt = 0,
    publishing = false;
  const photos = bindPhotoInput(main, "task");
  const form = main.querySelector("#task-form");
  const draft = bindTextDraft(form, wanted ? "wanted" : "task", [
    "#task-title", "#task-description", ...(wanted ? [] : ["#task-reward"]), "#task-name", "#post-visibility",
  ]);
  bindCharCounter(main.querySelector("#task-title"), main.querySelector("#task-title-count"), main.querySelector("#task-title-limit-status"));
  bindCharCounter(main.querySelector("#task-description"), main.querySelector("#task-description-count"), main.querySelector("#task-description-limit-status"));
  if (!wanted) bindCharCounter(main.querySelector("#task-reward"), main.querySelector("#task-reward-count"), main.querySelector("#task-reward-limit-status"));
  const visibility = bindPostVisibility(form);
  const locateButton = main.querySelector("#task-locate");
  async function getLocation() {
    position = await locate();
    locatedAt = Date.now();
    main.querySelector("#task-location-status").textContent =
      t("Location ready. Only your approximate area will be public.", "位置已获取，只会公开显示大致区域。");
    locateButton.textContent = t("Refresh location", "刷新位置");
  }
  locateButton.onclick = async () => {
    locateButton.disabled = true;
    locateButton.textContent = t("Locating…", "正在定位…");
    try {
      await getLocation();
    } catch (e) {
      position = undefined;
      main.querySelector("#task-location-status").textContent = e.message;
      locateButton.textContent = t("Try again", "重试");
    } finally {
      locateButton.disabled = false;
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (publishing) return;
    publishing = true;
    const button = main.querySelector("#publish-task"),
      error = main.querySelector("#task-error");
    error.hidden = true;
    button.disabled = true;
    try {
      const images = await photos.readImages();
      if (!visibility.unlisted && (!position || Date.now() - locatedAt > 300000)) await getLocation();
      const value = (id) => main.querySelector(id).value.trim();
      const { password, authKey, contactPublicKey, encryptedPrivateKey } =
        await createTaskCredentials();
      const payload = {
        title: value("#task-title"),
        description: value("#task-description"),
        ...(wanted ? { taskKind: "wanted" } : { reward: value("#task-reward") }),
        signature: value("#task-name"),
        images,
        ...visibility.payload(position),
        retentionAccepted: main.querySelector("#task-retention").checked,
        authKey,
        contactPublicKey,
        encryptedPrivateKey,
      };
      const submittedDraft = await draft.snapshot();
      const task = await api("/api/tasks", payload);
      await draft.published(submittedDraft);
      history.replaceState(null, "", localizedPath(`/task/${task.id}/manage?created=1`));
      await taskPage(task.id, {
        manage: true,
        password,
        authKey,
        published: { ...task, encryptedPrivateKey, replies: task.replies ?? [] },
      });
    } catch (e) {
      showFormError(error, e);
      button.disabled = false;
    } finally {
      publishing = false;
    }
  };
}

export const STATE_LABELS = {
  open: t("Open", "开放中"),
  in_progress: t("In progress", "进行中"),
  completed: t("Completed", "已完成"),
  closed: t("Closed", "已关闭"),
};
const FINAL_STATES = ["completed", "closed"];
const WANTED_STATE_LABELS = {
  open: t("Seeking", "求赠中"),
  in_progress: t("Arranging pickup", "正在安排领取"),
  completed: t("Item received", "已收到"),
};
export const stateLabel = (state, wanted = false) =>
  (wanted ? WANTED_STATE_LABELS[state ?? "open"] : undefined) ?? STATE_LABELS[state] ?? STATE_LABELS.open;
export const isFinalState = (state) => FINAL_STATES.includes(state);

function manageKeyFromHash() {
  const key = new URLSearchParams(location.hash.slice(1)).get("key") ?? "";
  return /^[a-f0-9]{64}$/.test(key) ? key : undefined;
}

// Private reply contacts, rendered only on the management page from the
// authenticated POST /api/tasks/<id>/manage response. Everything is escaped.
export function privateRepliesHtml(replies = []) {
  if (!replies.length)
    return `<p class="field-hint">${t("No replies yet. Contact details from new replies will appear here.", "暂无回复。新回复的联系方式将显示在这里。")}</p>`;
  return replies
    .map(
      (r) =>
        `<article class="reply-card private-reply"><div class="reply-byline"><strong>${escape(r.name)}</strong><span>${date(r.createdAt)}</span></div><p class="reply-message">${escape(r.message)}</p><div class="reply-contacts">${r.phone ? `<a href="tel:${escape(r.phone.replace(/[^+0-9]/g, ""))}">${t("Phone", "电话")}: ${escape(r.phone)}</a>` : ""}${r.email ? `<a href="mailto:${escape(encodeURIComponent(r.email.trim()).replaceAll("%40", "@"))}">${t("Email", "电子邮箱")}: ${escape(r.email)}</a>` : ""}${!r.phone && !r.email ? `<span class="field-hint">${t("No private contact details were provided.", "未提供私人联系方式。")}</span>` : ""}</div></article>`,
    )
    .join("");
}

async function decryptManagedTask(id, password, task) {
  if (!password || !task?.encryptedPrivateKey) return task.replies ?? [];
  await unwrapTaskPrivateKey(password, task.contactPublicKey, task.encryptedPrivateKey);
  return decryptReplyContacts(password, { ...task, replies: task.replies ?? [] }, id);
}

export async function taskPage(id, { manage = false, password, authKey, published } = {}) {
  setActiveNav(null);
  const legacyKey = manage && !password ? manageKeyFromHash() : undefined;
  const key = password ?? legacyKey;
  if (manage && !key) {
    await api(`/api/tasks/${id}`);
    return managementPasswordForm((password) => taskPage(id, { manage: true, password }));
  }
  if (password && !/^[a-f0-9]{64}$/i.test(password)) {
    const err = new Error("Invalid management password");
    err.status = 403;
    throw err;
  }
  const requestAuthKey = manage
    ? (authKey ?? (password ? await deriveTaskAuthKey(password) : legacyKey))
    : undefined;
  let task = published ?? (manage
    ? await api(`/api/tasks/${id}/manage`, { authKey: requestAuthKey })
    : await api(`/api/tasks/${id}`));
  const wanted = task.taskKind === "wanted";
  const guideLink = document.querySelector("[data-feature-guide]");
  if (wanted && guideLink) guideLink.href = localizedPath("/help#wanted");
  let privateReplies = manage
    ? await decryptManagedTask(id, password, task)
    : [];
  document.title = `${manage ? t("Manage: ", "管理：") : ""}${task.title} — ScaleTag`;
  const created = new URLSearchParams(location.search).has("created");
  const manageUrl = new URL(localizedPath(`/task/${id}/manage`), location.origin).href;
  const privateLink = `${location.origin}/task/${id}/manage#key=${legacyKey}`;
  const manageCard = manage
    ? `<section class="manage-card" aria-labelledby="manage-title"><span class="eyebrow">${t("PRIVATE · ONLY FOR YOU", "私人管理 · 请妥善保管链接")}</span><h2 id="manage-title">${wanted ? t("Manage item request", "管理求赠") : t("Manage this task", "管理此任务")}</h2>${legacyKey ? `<p>${t("Anyone with this private link can change the task’s status ", "任何持有此私人链接的人都能更改任务状态，")}<strong>${t("and see respondents’ phone numbers and email addresses", "并查看回复者的电话号码和电子邮箱")}</strong>. ${t("Do not share it or include it in screenshots. It cannot be recovered or reissued if lost. It may remain in this browser’s history; use the public link when sharing.", "请勿分享此链接，也不要将它包含在截图中。链接可能保留在浏览器历史记录中；丢失后无法找回或重新生成。请使用公开链接分享任务。")}</p><label for="manage-link">${t("Private management link", "私人管理链接")}</label><input id="manage-link" readonly value="${escape(privateLink)}"><button class="button secondary small" type="button" id="copy-manage-link">${t("Copy private link", "复制私人链接")}</button>` : managementDetails(manageUrl)}<fieldset class="state-buttons"><legend>${wanted ? t("Request status", "求赠状态") : t("Task status", "任务状态")}</legend><p class="field-hint">${t("Completed and Closed are final: they stop new replies and cannot be undone. The task still leaves the website on ", "“已完成”和“已关闭”为最终状态：停止接收新回复且无法撤销。任务仍将在以下日期从网站移除：")}${escape(date(task.deleteAt))}.</p><div>${Object.keys(STATE_LABELS)
        .map(
          value =>
            `<button type="button" class="button secondary small" data-task-state="${value}" aria-pressed="false">${stateLabel(value, wanted)}</button>`,
        )
        .join(
          "",
        )}</div></fieldset><p id="manage-error" class="form-error" role="alert" hidden></p><section class="private-replies" aria-labelledby="private-replies-title"><div class="replies-heading"><h3 id="private-replies-title">${t("Private reply contacts", "回复者的私人联系方式")}</h3><span id="private-reply-count"></span></div><p class="field-hint">${t("Only visible in the management page. Respondents shared these details so you can contact them about this task; do not republish them. They leave the website with the task on ", "仅在管理页面可见。回复者提供这些信息供你就任务联系他们；请勿再次公开。这些信息将随任务于以下日期从网站移除：")}${escape(date(task.deleteAt))}.</p><div id="private-reply-list" aria-live="polite"></div><button class="button secondary small" type="button" id="refresh-private-replies">${t("Refresh contacts", "刷新联系方式")}</button><p id="private-replies-error" class="form-error" role="alert" hidden></p></section></section>`
    : "";
  main.innerHTML = `<section class="poll-layout"><div class="poll-main"><a class="back-link" href="/PostList">${t("← Back to PostList", "← 返回帖子列表")}</a>${created ? `<div class="success-banner" role="status">${wanted ? t("Your item request is live.", "求赠已发布。") : t("Your task is live.", "任务已发布。")} ${manage ? t(" Save the management details below before leaving this page.", " 离开页面前请保存下方的管理信息。") : t(" Share its QR code to find a little help.", " 分享二维码，寻找帮助。")}</div>` : ""}<div class="poll-meta"><span class="status-badge">${wanted ? t("Wanted", "求赠") : t("Task", "任务")}</span><span id="task-state" class="status-badge"></span><span>${t("Available until", "有效期至")} ${date(task.deleteAt)}</span></div><h1 class="poll-title">${escape(task.title)}</h1><p class="byline">${t("Posted by", "发布者")} <strong>${escape(task.signature)}</strong><span> · ${date(task.createdAt)}</span></p><p class="poll-description">${escape(task.description)}</p>${uploadedPhotosHtml(task.images, "Task photo", "任务照片")}${wanted ? "" : `<section class="task-reward"><span class="eyebrow">${t("REWARD OFFERED", "提供的酬谢")}</span><h2>${escape(task.reward)}</h2><p>${t("Offered by the poster. Arrange details directly. ScaleTag does not handle payments or transactions.", "酬谢由发布者提供，请双方直接商定细节。ScaleTag 不处理付款或交易。")}</p></section>`}${manageCard}<section id="social" aria-label="${t("Task likes and replies", "任务点赞和回复")}"></section></div><aside class="poll-sidebar"><section class="share-card"><span class="eyebrow">${t("PASS IT ON", "分享给邻里")}</span><h2>${t("A small code.<br>A local connection.", "分享二维码，<br>让附近的人看到。") }</h2><div class="qr-frame"><img src="/api/tasks/${id}/qr.png" width="256" height="256" alt="${t("QR code linking to this task", "任务二维码")}"></div><p>${t("Scan to read. Save to share.", "扫码查看，保存后分享。")}</p><a class="button" href="/api/tasks/${id}/qr.png?download=1" download="ScaleTag-task-${id}.png">${icons.download}${t(" Save QR image", " 保存二维码")}</a><button class="button secondary" id="copy-task-link">${manage ? t("Copy public task link", "复制公开任务链接") : t("Copy task link", "复制任务链接")}</button><div id="public-link-fallback" hidden><label for="public-task-link">${t("Public task link", "公开任务链接")}</label><input id="public-task-link" readonly></div></section><section class="timeline-card"><div>${icons.clock}<span>${t("Removed with all replies", "任务及所有回复的移除时间")}<strong>${date(task.deleteAt)}</strong></span></div><p>${t("Dates are shown in your local time.", "日期按你的本地时间显示。")}</p></section>${notice()}</aside></section>`;
  function renderState(state) {
    const badge = main.querySelector("#task-state");
    badge.textContent = task.taskAssigned && !isFinalState(state)
      ? (wanted ? stateLabel("in_progress", true) : t("Already assigned", "已有接单人"))
      : stateLabel(state, wanted);
    badge.classList.toggle("closed", isFinalState(state));
    badge.classList.toggle("in-progress", state === "in_progress");
    if (!manage) return;
    main.querySelectorAll("[data-task-state]").forEach((button) => {
      const current = button.dataset.taskState === state;
      button.setAttribute("aria-pressed", String(current));
      button.classList.toggle("selected", current);
      button.disabled = current || isFinalState(state) || (task.taskAssigned && button.dataset.taskState === "open");
    });
  }
  renderState(task.taskState);
  const shareCard = main.querySelector(".share-card");
  mountSavedPost(shareCard, {
    path: `/task/${id}${manage && !legacyKey ? "/manage" : ""}`,
    title: () => task.title,
  });
  const renderPoster = () => mountPosterActions(shareCard, {
    type: "task",
    id,
    title: task.title,
    description: task.description,
    signature: task.signature,
    createdAt: task.createdAt,
    deleteAt: task.deleteAt,
    reward: task.reward,
    taskKind: task.taskKind,
    images: task.images,
    qrUrl: `/api/tasks/${id}/qr.png`,
    publicUrl: `${location.origin}/task/${id}`,
  });
  renderPoster();
  if (!manage) {
    mountNativeShare(main.querySelector("#copy-task-link"), {
      title: task.title,
      url: `${location.origin}/task/${id}`,
    });
  }
  main.querySelector("#copy-task-link").onclick = async () => {
    const publicLink = `${location.origin}/task/${id}`;
    try {
      await navigator.clipboard.writeText(publicLink);
      toast(t("Task link copied.", "任务链接已复制。"));
    } catch {
      // Never point to the address bar: on the management page it contains
      // the private key. Show and select the canonical public URL instead.
      const fallback = main.querySelector("#public-link-fallback"),
        input = main.querySelector("#public-task-link");
      input.value = publicLink;
      fallback.hidden = false;
      input.focus();
      input.select();
      toast(t("Copy the selected public task link.", "请复制选中的公开任务链接。"));
    }
  };
  let social;
  let changing = false;
  let managementVersion = 0;
  // Contacts come only from the authenticated manage response; the status
  // response and public social data never include them.
  let loadingContacts = false;
  function renderPrivateReplies() {
    const list = main.querySelector("#private-reply-list");
    if (!list) return; // The task may have left the website meanwhile.
    list.innerHTML = privateRepliesHtml(privateReplies);
    const final = isFinalState(task.taskState);
    for (const [index, card] of [...list.querySelectorAll(".private-reply")].entries()) {
      const reply = privateReplies[index];
      if (reply.id === task.assignedReplyId) {
        const badge = document.createElement("p");
        badge.className = "field-hint";
        badge.textContent = wanted ? t("Selected donor", "已选定赠予者") : t("Selected to do this task", "已选定为接单人");
        card.append(badge);
      } else if (!final && !task.taskAssigned && /^[a-f0-9]{24}$/.test(reply.id ?? "")) {
        addAssignmentButton(card, reply.id, t("Choose this person", "选定此人"));
      }
    }
    if (task.taskAssigned && !final)
      addAssignmentButton(list, "reopen", t("Reopen applications", "重新开放报名"));
    main.querySelector("#private-reply-count").textContent =
      t(`${privateReplies.length} ${privateReplies.length === 1 ? "reply" : "replies"}`, `${privateReplies.length} 条回复`);
  }
  function addAssignmentButton(parent, value, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary small";
    button.dataset.assignReply = value;
    button.textContent = label;
    button.disabled = changing;
    parent.append(button);
  }
  async function refreshPrivateReplies(manual = false) {
    if (!manage || loadingContacts || changing) return;
    const version = managementVersion;
    loadingContacts = true;
    try {
      const data = await api(`/api/tasks/${id}/manage`, { authKey: requestAuthKey });
      const replies = await decryptManagedTask(id, password, data);
      if (version !== managementVersion) return;
      privateReplies = replies;
      task = { ...task, ...data, taskAssigned: Boolean(data.taskAssigned) };
      const error = main.querySelector("#private-replies-error");
      if (error) error.hidden = true;
      if (main.querySelector("#task-state")) renderState(task.taskState);
      renderPrivateReplies();
    } catch (e) {
      const error = main.querySelector("#private-replies-error");
      if (error) {
        showFormError(error, e, { focus: manual });
      }
    } finally {
      loadingContacts = false;
    }
  }
  if (manage) {
    renderPrivateReplies();
    main.querySelector("#private-reply-list").onclick = async (event) => {
      const button = event.target.closest("[data-assign-reply]");
      if (!button || changing) return;
      const reopen = button.dataset.assignReply === "reopen";
      if (!confirm(reopen
        ? t("Reopen applications and clear the current assignment?", "重新开放报名并取消当前指派？")
        : t("Choose this person and pause new applications?", "选定此人并暂停接受新报名？"))) return;
      const replyId = reopen ? null : button.dataset.assignReply;
      const error = main.querySelector("#manage-error");
      error.hidden = true;
      changing = true;
      managementVersion++;
      renderPrivateReplies();
      try {
        const updated = await api(`/api/tasks/${id}/assignment`, { authKey: requestAuthKey, replyId });
        task = { ...task, ...updated, taskAssigned: Boolean(updated.taskAssigned) };
      } catch (e) {
        showFormError(error, e);
      } finally {
        changing = false;
        if (main.querySelector("#task-state")) renderState(task.taskState);
        renderPrivateReplies();
        social?.refresh();
      }
    };
    main.querySelector("#refresh-private-replies").onclick = () =>
      refreshPrivateReplies(true);
    mountOwnerEdit(main.querySelector(".manage-card"), task, `/api/tasks/${id}/edit`,
      requestAuthKey, (updated) => {
        task = { ...task, ...updated };
        refreshOwnerPreview(main, task);
        shareCard.querySelector(".poster-actions")?.remove();
        document.querySelector("#poster-print-root")?.remove();
        renderPoster();
      });
    if (!legacyKey) bindManagementCopy(manageUrl, password);
    else main.querySelector("#copy-manage-link").onclick = async () => {
      try {
        await navigator.clipboard.writeText(privateLink);
        toast(t("Private management link copied. Keep it safe.", "私人管理链接已复制，请妥善保管。"));
      } catch {
        main.querySelector("#manage-link").select();
        toast(t("Copy the selected private link and keep it safe.", "请复制选中的私人链接并妥善保管。"));
      }
    };
    main.querySelectorAll("[data-task-state]").forEach((button) => {
      button.onclick = async () => {
        if (changing) return;
        const state = button.dataset.taskState;
        if (
          isFinalState(state) &&
          !confirm(
            wanted ? t("Finish this item request? New offers will stop and this cannot be undone.", "结束这条求赠？结束后将停止接收赠予回复，且无法撤销。")
              : t(`Mark this task as ${stateLabel(state)}? New replies will stop and this cannot be undone.`, `确定将任务标记为${stateLabel(state)}？这将停止新回复且无法撤销。`),
          )
        )
          return;
        changing = true;
        managementVersion++;
        const error = main.querySelector("#manage-error");
        error.hidden = true;
        main
          .querySelectorAll("[data-task-state]")
          .forEach((b) => (b.disabled = true));
        try {
          const updated = await api(`/api/tasks/${id}/state`, { authKey: requestAuthKey, state });
          task = { ...task, ...updated, taskAssigned: Boolean(updated.taskAssigned) };
          toast(t(`Task marked ${stateLabel(task.taskState)}.`, `任务已标记为${stateLabel(task.taskState)}。`));
          social?.refresh();
        } catch (e) {
          showFormError(error, e);
        } finally {
          changing = false;
          renderState(task.taskState);
          renderPrivateReplies();
        }
      };
    });
  }
  social = mountSocial(
    id,
    true,
    () => {
      document.title = t("Task unavailable — ScaleTag", "任务不可用 — ScaleTag");
      main.innerHTML =
        `<section class="empty-page"><h1>${t("This page is unavailable.", "此页面不可用。")}</h1><p>${t("This task and its replies have left the website. Private archives follow the backup retention policy.", "此任务及其回复已从网站移除。私人存档遵循备份保留政策。")}</p><a class="button" href="/PostList">${t("Back to PostList", "返回帖子列表")}</a></section>`;
    },
    (data) => {
      if (changing || data.serverTime < task.serverTime) return;
      const assignmentChanged = Boolean(data.taskAssigned) !== Boolean(task.taskAssigned);
      if (data.taskState && (data.taskState !== task.taskState || assignmentChanged)) {
        task = { ...task, taskState: data.taskState, taskAssigned: Boolean(data.taskAssigned) };
        renderState(task.taskState);
      }
      // A new public reply means new private contacts may be available.
      if (manage && (assignmentChanged || data.replies?.length !== privateReplies.length))
        refreshPrivateReplies();
    },
    () => task.title,
    wanted,
  );
}
