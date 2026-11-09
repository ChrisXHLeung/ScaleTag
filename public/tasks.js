import { localizedPath } from "/locale.js";
import {
  main,
  api,
  escape,
  icons,
  date,
  locate,
  notice,
  toast,
  t,
} from "/common.js";
import { mountSocial } from "/social.js";

export function createTask() {
  document.title = t("Create a task — ScaleTag", "发布任务 — ScaleTag");
  document.querySelector('[data-nav="create"]').classList.add("active");
  main.innerHTML = `<section class="create-section"><aside class="section-intro"><a class="back-link" href="/">${t("← Back to home", "← 返回首页")}</a><span class="eyebrow">${t("MAKE SOMETHING HAPPEN", "需要帮忙？")}</span><h1>${t("A little help.<br>A local <em>connection.</em>", "需要帮忙？<br><em>让身边的人搭把手。</em>")}</h1><p>${t("Share a task and the reward you offer. People can reply with a way to reach them.", "说说你需要什么帮助，以及愿意提供什么酬谢。感兴趣的人可以回复并留下联系方式。")}</p><div class="rules"><p>${icons.pin} ${t("Location is required to publish.", "发布时需要位置信息。")}</p><p>${icons.clock} ${t("Tasks stay on the website for 30 days.", "任务发布后保留 30 天。")}</p><p>${icons.shield} ${t("No accounts. Contact each other directly.", "无需注册，双方直接联系。")}</p></div></aside><form id="task-form" class="form-card"><div class="post-kind-switch" aria-label="${t("Post type", "发布类型")}"><a href="/create">${t("Poll", "投票")}</a><a href="/create/task" aria-current="page">${t("Task", "任务")}</a></div><div class="form-heading"><h2>${t("Your new task", "发布新任务")}</h2><span class="pill">${t("LOCAL TASK", "本地任务")}</span></div><label for="task-title">${t("Title", "标题")}</label><input id="task-title" maxlength="140" required placeholder="${t("What could someone help you with?", "你需要什么帮助？")}"><label for="task-description">${t("Description", "描述")}</label><textarea id="task-description" maxlength="4000" rows="6" required placeholder="${t("Describe the task and what you need.", "介绍一下任务，以及你需要什么帮助。")}"></textarea><label for="task-reward">${t("Reward", "酬谢")}</label><input id="task-reward" maxlength="160" required placeholder="${t("e.g. CAD 30, a coffee, or a thank-you", "例如：30 加元、一杯咖啡或一句感谢")}"><p class="field-hint">${t("A description of your offer. ScaleTag does not collect, hold or transfer money.", "说明你愿意提供什么酬谢。ScaleTag 不收取、保管或转账资金。")}</p><label for="task-name">${t("Your name ", "你的名字 ")}<span class="optional">${t("optional, unverified", "选填，未经验证")}</span></label><input id="task-name" maxlength="60" placeholder="${t("Anonymous", "匿名")}"><div class="location-box"><div><strong>${icons.pin} ${t("Give your task a place", "添加任务位置")}</strong><p id="task-location-status" aria-live="polite">${t("People can discover your task nearby.", "添加位置后，附近的人更容易找到你的任务。")}</p></div><button id="task-locate" class="button secondary small" type="button">${t("Enable location", "获取位置")}</button></div><p class="field-hint">${t("Only a rounded area is shown on the map. It can still reveal your neighbourhood.", "地图只显示大致区域，但仍可能透露你所在的社区。")}</p><label class="checkbox-row"><input id="task-map-consent" type="checkbox" required><span>${t("I agree to show my task’s approximate area publicly on the map. This does not guarantee anonymity.", "我同意在地图上公开显示任务的大致区域。我了解这不能保证匿名。")}</span></label>${notice()}<label class="checkbox-row"><input id="task-retention" type="checkbox" required><span>${t("I understand that this task, its replies and contact details leave the website 30 days after publication. Private daily backups are retained for up to 90 days after creation.", "我了解任务、回复及联系方式会在任务发布 30 天后从网站移除，私有每日备份从创建之日起最多保留 90 天。")}</span></label><p class="field-hint">${t("Task descriptions, rewards and names are unverified and public. Respondents’ names and messages are public; their phone numbers and email addresses are shown only on your private management page, so keep that link safe.", "任务描述、酬谢和姓名会公开显示，且未经验证。回复者的姓名和留言也是公开的；电话和邮箱只显示在私人管理页面，请妥善保管管理链接。")}</p><button id="publish-task" class="button publish-button" type="submit">${t("Publish my task ", "发布任务 ")}${icons.arrow}</button><p id="task-error" class="form-error" role="alert" hidden></p></form></section>`;
  let position,
    locatedAt = 0,
    publishing = false;
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
      location.assign(localizedPath(`/task/${task.id}/manage?created=1#key=${task.manageKey}`));
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
  open: t("Open", "开放中"),
  in_progress: t("In progress", "进行中"),
  completed: t("Completed", "已完成"),
  closed: t("Closed", "已关闭"),
};
const FINAL_STATES = ["completed", "closed"];
export const stateLabel = (state) => STATE_LABELS[state] ?? STATE_LABELS.open;
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
        `<article class="reply-card private-reply"><div class="reply-byline"><strong>${escape(r.name)}</strong><span>${date(r.createdAt)} · ${t("Unverified", "未经验证")}</span></div><p class="reply-message">${escape(r.message)}</p><div class="reply-contacts">${r.phone ? `<a href="tel:${escape(r.phone.replace(/[^+0-9]/g, ""))}">${t("Phone", "电话")}: ${escape(r.phone)}</a>` : ""}${r.email ? `<a href="mailto:${escape(encodeURIComponent(r.email))}">${t("Email", "电子邮箱")}: ${escape(r.email)}</a>` : ""}${!r.phone && !r.email ? `<span class="field-hint">${t("No private contact details were provided.", "未提供私人联系方式。")}</span>` : ""}</div></article>`,
    )
    .join("");
}

export async function taskPage(id, { manage = false } = {}) {
  let key, task;
  if (manage) {
    key = manageKeyFromHash();
    if (!key)
      throw new Error(
        t("This management link is incomplete. Open the full private link saved when the task was published.", "管理链接不完整。请打开发布任务时保存的完整私人链接。"),
      );
    task = await api(`/api/tasks/${id}/manage`, { key });
  } else task = await api(`/api/tasks/${id}`);
  document.title = `${manage ? t("Manage: ", "管理：") : ""}${task.title} — ScaleTag`;
  const created = new URLSearchParams(location.search).has("created");
  const privateLink = `${location.origin}/task/${id}/manage#key=${key}`;
  const manageCard = manage
    ? `<section class="manage-card" aria-labelledby="manage-title"><span class="eyebrow">${t("PRIVATE · ONLY FOR YOU", "私人管理 · 请妥善保管链接")}</span><h2 id="manage-title">${t("Manage this task", "管理此任务")}</h2><p>${t("Anyone with this private link can change the task’s status ", "任何持有此私人链接的人都能更改任务状态，")}<strong>${t("and see respondents’ phone numbers and email addresses", "并查看回复者的电话号码和电子邮箱")}</strong>. ${t("Do not share it or include it in screenshots. It cannot be recovered or reissued if lost. It may remain in this browser’s history; use the public link when sharing.", "请勿分享此链接，也不要将它包含在截图中。链接可能保留在浏览器历史记录中；丢失后无法找回或重新生成。请使用公开链接分享任务。")}</p><label for="manage-link">${t("Private management link", "私人管理链接")}</label><input id="manage-link" readonly value="${escape(privateLink)}"><button class="button secondary small" type="button" id="copy-manage-link">${t("Copy private link", "复制私人链接")}</button><fieldset class="state-buttons"><legend>${t("Task status", "任务状态")}</legend><p class="field-hint">${t("Completed and Closed are final: they stop new replies and cannot be undone. The task still leaves the website on ", "“已完成”和“已关闭”为最终状态：停止接收新回复且无法撤销。任务仍将在以下日期从网站移除：")}${escape(date(task.deleteAt))}.</p><div>${Object.entries(
        STATE_LABELS,
      )
        .map(
          ([value, label]) =>
            `<button type="button" class="button secondary small" data-task-state="${value}" aria-pressed="false">${label}</button>`,
        )
        .join(
          "",
        )}</div></fieldset><p id="manage-error" class="form-error" role="alert" hidden></p><section class="private-replies" aria-labelledby="private-replies-title"><div class="replies-heading"><h3 id="private-replies-title">${t("Private reply contacts", "回复者的私人联系方式")}</h3><span id="private-reply-count"></span></div><p class="field-hint">${t("Only visible with this private link. Respondents shared these details so you can contact them about this task; do not republish them. They leave the website with the task on ", "仅持此私人链接可见。回复者提供这些信息供你就任务联系他们；请勿再次公开。这些信息将随任务于以下日期从网站移除：")}${escape(date(task.deleteAt))}.</p><div id="private-reply-list" aria-live="polite"></div><button class="button secondary small" type="button" id="refresh-private-replies">${t("Refresh contacts", "刷新联系方式")}</button><p id="private-replies-error" class="form-error" role="alert" hidden></p></section></section>`
    : "";
  main.innerHTML = `<section class="poll-layout"><div class="poll-main"><a class="back-link" href="/PostList">${t("← Back to PostList", "← 返回帖子列表")}</a>${created ? `<div class="success-banner" role="status">${t("Your task is live.", "任务已发布。")} ${manage ? t(" Save the private management link below before leaving this page.", " 离开页面前请保存下方的私人管理链接。") : t(" Share its QR code to find a little help.", " 分享二维码，寻找帮助。")}</div>` : ""}<div class="poll-meta"><span class="status-badge">${t("Task", "任务")}</span><span id="task-state" class="status-badge"></span><span>${t("Available until", "有效期至")} ${date(task.deleteAt)}</span></div><h1 class="poll-title">${escape(task.title)}</h1><p class="byline">${t("Posted by", "发布者")} <strong>${escape(task.signature)}</strong><span> · ${date(task.createdAt)}</span><span class="unverified">${t("Unverified name", "姓名未经验证")}</span></p><p class="poll-description">${escape(task.description)}</p><section class="task-reward"><span class="eyebrow">${t("REWARD OFFERED", "提供的酬谢")}</span><h2>${escape(task.reward)}</h2><p>${t("Offered by the poster. Arrange details directly. ScaleTag does not handle payments or transactions.", "酬谢由发布者提供，请双方直接商定细节。ScaleTag 不处理付款或交易。")}</p></section>${manageCard}<section id="social" aria-label="${t("Task likes and replies", "任务点赞和回复")}"></section></div><aside class="poll-sidebar"><section class="share-card"><span class="eyebrow">${t("PASS IT ON", "分享给邻里")}</span><h2>${t("A small code.<br>A local connection.", "分享二维码，<br>让附近的人看到。") }</h2><div class="qr-frame"><img src="/api/tasks/${id}/qr.png" width="256" height="256" alt="${t("QR code linking to this task", "任务二维码")}"></div><p>${t("Scan to read. Save to share.", "扫码查看，保存后分享。")}</p><a class="button" href="/api/tasks/${id}/qr.png?download=1" download="ScaleTag-task-${id}.png">${icons.download}${t(" Save QR image", " 保存二维码")}</a><button class="button secondary" id="copy-task-link">${manage ? t("Copy public task link", "复制公开任务链接") : t("Copy task link", "复制任务链接")}</button><div id="public-link-fallback" hidden><label for="public-task-link">${t("Public task link", "公开任务链接")}</label><input id="public-task-link" readonly></div></section><section class="timeline-card"><div>${icons.clock}<span>${t("Removed with all replies", "任务及所有回复的移除时间")}<strong>${date(task.deleteAt)}</strong></span></div><p>${t("Dates are shown in your local time.", "日期按你的本地时间显示。")}</p></section>${notice()}</aside></section>`;
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
  // Contacts come only from the authenticated manage response; the status
  // response and public social data never include them.
  let privateReplies = task.replies ?? [],
    loadingContacts = false;
  function renderPrivateReplies() {
    const list = main.querySelector("#private-reply-list");
    if (!list) return; // The task may have left the website meanwhile.
    list.innerHTML = privateRepliesHtml(privateReplies);
    main.querySelector("#private-reply-count").textContent =
      t(`${privateReplies.length} ${privateReplies.length === 1 ? "reply" : "replies"}`, `${privateReplies.length} 条回复`);
  }
  async function refreshPrivateReplies() {
    if (!manage || loadingContacts) return;
    loadingContacts = true;
    try {
      const data = await api(`/api/tasks/${id}/manage`, { key });
      privateReplies = data.replies ?? [];
      const error = main.querySelector("#private-replies-error");
      if (error) error.hidden = true;
      renderPrivateReplies();
    } catch (e) {
      const error = main.querySelector("#private-replies-error");
      if (error) {
        error.textContent = e.message;
        error.hidden = false;
      }
    } finally {
      loadingContacts = false;
    }
  }
  if (manage) {
    renderPrivateReplies();
    main.querySelector("#refresh-private-replies").onclick =
      refreshPrivateReplies;
    main.querySelector("#copy-manage-link").onclick = async () => {
      try {
        await navigator.clipboard.writeText(privateLink);
        toast(t("Private management link copied. Keep it safe.", "私人管理链接已复制，请妥善保管。"));
      } catch {
        main.querySelector("#manage-link").select();
        toast(t("Copy the selected private link and keep it safe.", "请复制选中的私人链接并妥善保管。"));
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
            t(`Mark this task as ${stateLabel(state)}? New replies will stop and this cannot be undone.`, `确定将任务标记为${stateLabel(state)}？这将停止新回复且无法撤销。`),
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
          toast(t(`Task marked ${stateLabel(task.taskState)}.`, `任务已标记为${stateLabel(task.taskState)}。`));
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
      document.title = t("Task unavailable — ScaleTag", "任务不可用 — ScaleTag");
      main.innerHTML =
        `<section class="empty-page"><h1>${t("This page is unavailable.", "此页面不可用。")}</h1><p>${t("This task and its replies have left the website. Private archives follow the backup retention policy.", "此任务及其回复已从网站移除。私人存档遵循备份保留政策。")}</p><a class="button" href="/PostList">${t("Back to PostList", "返回帖子列表")}</a></section>`;
    },
    (data) => {
      if (data.taskState && data.taskState !== task.taskState) {
        task = { ...task, taskState: data.taskState };
        renderState(task.taskState);
      }
      // A new public reply means new private contacts may be available.
      if (manage && data.replies?.length !== privateReplies.length)
        refreshPrivateReplies();
    },
  );
}
