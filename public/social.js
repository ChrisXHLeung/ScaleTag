import { api, escape, date, count, toast, t, showFormError, bindLinkCopy, linkCopyFallback } from "/common.js";
import { localizedPath } from "/locale.js";
import { mountSavedPost, syncSavedButtons } from "/local-posts.js";
import { encryptReplyContact } from "/task-crypto.js";

export function mountSocial(id, allowReplies, onUnavailable, onState, taskTitle, wanted = false) {
  const host = document.querySelector("#social");
  // Name and message are public. Phone/email are private to whoever holds the
  // task's management link; legacy tasks without a link collect no contacts and accept no replies.
  const replyForm = `<form id="reply-form"><h3>${wanted ? t("Offer an item", "我可以赠予") : t("Leave a reply", "写回复")}</h3><div class="reply-privacy-note" role="note"><strong>${t("Your name and message are public.", "你的姓名和留言会公开显示。")}</strong> ${t("Anyone can read them. Never put a phone number, email address or other contact details in them.", "任何人都能看到。请勿在这里填写电话、邮箱或其他联系方式。")}</div><label for="reply-name">${t("Public name ", "公开姓名 ")}<span class="optional">${t("optional, unverified, shown to everyone", "选填，未经验证，所有人可见")}</span></label><input id="reply-name" maxlength="60" placeholder="${t("Anonymous", "匿名")}" autocomplete="off"><label for="reply-message">${t("Public message ", "公开留言 ")}<span class="optional">${t("shown to everyone", "所有人可见")}</span></label><textarea id="reply-message" maxlength="2000" rows="4" required aria-describedby="reply-message-hint reply-message-length"></textarea><p id="reply-message-length" class="field-hint">${t("Reply length", "回复长度")} <span></span></p><p id="reply-message-limit-status" class="field-hint reply-length-status" role="status"></p><p id="reply-message-hint" class="field-hint">${t("Do not include contact details here. Messages that look like they contain a phone number or email address are rejected.", "请勿填写联系方式。系统会拒绝疑似包含电话或邮箱的留言。")}</p><fieldset id="private-contact-fields" class="contact-fields"><legend>${wanted ? t("Private contact for the requester", "留给求赠发布者的联系方式") : t("Private contact for the task creator", "留给任务发布者的联系方式")}</legend><p class="field-hint">${t("Add a phone number or email address, or both. These are ", "请填写电话、邮箱，或两者都填。这些信息")}<strong>${t("not shown publicly", "不会公开显示")}</strong>. ${t("They are encrypted in your browser and can be decrypted with the task management password.", "这些信息会在浏览器中加密，只有使用任务管理密码才能解密。")}</p><p id="reply-contact-error" class="form-error" role="alert" hidden></p><label for="reply-phone">${t("Phone ", "电话 ")}<span class="optional">${t("private · optional if you provide email", "私人信息 · 已提供邮箱时可不填")}</span></label><input id="reply-phone" type="tel" maxlength="40" autocomplete="tel" placeholder="+1 416 555 0123"><label for="reply-email">${t("Email ", "电子邮箱 ")}<span class="optional">${t("private · optional if you provide phone", "私人信息 · 已提供电话时可不填")}</span></label><input id="reply-email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com"></fieldset><label class="checkbox-row"><input id="contact-consent" type="checkbox" required><span id="consent-private">${wanted ? t("I understand my name and message are public for up to 30 days. My phone or email is encrypted for the requester. Encrypted backups are kept for up to 90 days. I have left contact details out of my public message and name.", "我了解姓名和留言最多公开 30 天，电话或邮箱会加密，只有求赠发布者才能解密。加密备份最多保留 90 天。公开的姓名和留言里没有联系方式。") : t("I understand that my name and message are public until this task leaves the website, 30 days after it was published. My phone/email is not public: it is encrypted and can be decrypted with the task management password; encrypted backups are kept for up to 90 days. I have not put contact details in my name or message.", "我了解我的姓名和消息会公开，直到任务在发布 30 天后从网站移除。我的电话和邮箱不会公开：这些信息会加密保存，只有使用任务管理密码才能解密；加密备份最多保留 90 天。我没有在姓名或消息中填写联系方式。")}</span></label><p class="field-hint">${t("ScaleTag does not handle payments or transactions. Names, messages and contact details are unverified.", "ScaleTag 不处理付款或交易。姓名、消息和联系方式未经验证。")}</p><p id="reply-error" class="form-error" role="alert" hidden></p><button id="send-reply" class="button" type="submit" disabled>${wanted ? t("Send offer", "提交赠予回复") : t("Post reply", "发布回复")}</button></form>`;
  const reportControl = `<label class="content-filter" id="report-reason-control" for="report-reason" hidden>
    ${t("Report reason", "举报理由")}<select id="report-reason" disabled>
      <option value="">${t("Select a reason", "选择理由")}</option>
      <option value="spam">${t("Spam", "垃圾信息")}</option>
      <option value="privacy">${t("Privacy violation", "泄露隐私")}</option>
      <option value="inappropriate">${t("Inappropriate content", "内容不当")}</option>
      <option value="other">${t("Other reason", "其他理由")}</option>
    </select></label><button id="report-post" class="button secondary small" type="button" disabled>${t("Report this post", "举报此帖子")}</button><p id="report-status" class="field-hint" role="status"></p><p id="report-error" class="form-error" role="alert" hidden></p>`;
  host.innerHTML = `<section class="social-card"><h2>${t("Show your support.", "点个赞")}</h2><button id="like-post" class="button secondary" type="button" aria-pressed="false" disabled><span id="like-label">${t("♡ Like", "♡ 点赞")}</span> <span id="like-count">…</span></button><p class="field-hint">${t("One like per browser, as far as an anonymous cookie allows. No account needed.", "我们使用匿名 Cookie 尽量限制每个浏览器只能点赞一次，无需注册。")}</p><p id="social-error" class="form-error" role="alert" hidden></p>${reportControl}${allowReplies ? `<div class="replies-heading"><h2>${t("Public replies", "公开回复")}</h2><span id="reply-count"></span></div><p class="field-hint">${t("Names and messages are public. Contact details are never shown here.", "姓名和消息是公开的，联系方式不会显示在这里。")}</p><div id="reply-list" aria-live="polite"></div><p id="replies-closed" class="replies-closed" role="status" hidden></p>${replyForm}` : ""}</section>`;
  const like = host.querySelector("#like-post");
  const report = host.querySelector("#report-post");
  const reportStatus = host.querySelector("#report-status");
  const reportError = host.querySelector("#report-error");
  const reportReasonControl = host.querySelector("#report-reason-control");
  const reportReason = host.querySelector("#report-reason");
  let state,
    liking = false,
    replying = false,
    replyVersion = 0,
    reporting = false,
    reported = false,
    fetching = false,
    refreshPending = false,
    stopped = false,
    expired = false;
  const isMounted = () => !stopped && host.isConnected;
  function error(message) {
    const target = host.querySelector("#social-error");
    target.textContent = message;
    target.hidden = false;
  }
  const publicTaskPath = `/task/${id}`;
  const linkReplies = allowReplies && location.pathname === publicTaskPath;
  const replyList = host.querySelector("#reply-list");
  if (linkReplies) replyList.insertAdjacentHTML("beforebegin", `<div class="content-filter reply-order" hidden>
    <label for="reply-order">${t("Reply order", "回复排序")}</label>
    <select id="reply-order">
      <option value="oldest">${t("Oldest first", "最早优先")}</option>
      <option value="newest">${t("Newest first", "最新优先")}</option>
    </select>
  </div>`);
  const replyOrder = host.querySelector("#reply-order");
  if (replyOrder) replyOrder.onchange = () => renderReplies(state.replies);
  let pendingReplyHash = linkReplies ? location.hash : "";
  let lastRepliesHtml;

  function focusLinkedReply() {
    if (!/^#reply-[a-f0-9]{24}$/.test(pendingReplyHash)) return;
    const reply = document.getElementById(pendingReplyHash.slice(1));
    if (!replyList.contains(reply)) return;
    pendingReplyHash = "";
    reply.focus({ preventScroll: true });
    reply.scrollIntoView({ block: "nearest" });
  }

  function onReplyHashChange() {
    pendingReplyHash = location.hash;
    focusLinkedReply();
  }

  function renderReplies(replies) {
    if (replyOrder) replyOrder.parentElement.hidden = replies.length < 2;
    const ordered = replyOrder?.value === "newest" ? [...replies].reverse() : replies;
    const replyTitles = new Map();
    // Read the task title when the reply is saved so owner edits are reflected.
    const currentTaskTitle = () => typeof taskTitle === "function" ? taskTitle() : taskTitle;
    const html = ordered.length ? ordered.map(reply => {
      const target = linkReplies && /^[a-f0-9]{24}$/.test(reply.id) ? `reply-${reply.id}` : "";
      const time = date(reply.createdAt);
      if (target) replyTitles.set(target, () => `${currentTaskTitle()} · ${reply.name} · ${time}`);
      const byline = target
        ? `<a class="reply-permalink" href="#${target}"><span class="sr-only">${t("Link to this reply", "链接到此回复")} </span>${time}</a>`
        : `<span>${time}</span>`;
      const saveControl = target ? '<div class="local-post-controls reply-actions"></div>' : "";
      return `<article class="reply-card"${target ? ` id="${target}" tabindex="-1"` : ""}><div class="reply-byline"><strong>${escape(reply.name)}</strong>${byline}</div><p class="reply-message">${escape(reply.message)}</p>${saveControl}</article>`;
    }).join("") : `<p class="field-hint">${t("No replies yet. Start the conversation.", "还没有回复，来说两句吧。")}</p>`;
    if (html !== lastRepliesHtml) {
      const active = document.activeElement;
      const focused = replyList.contains(active) ? active.closest(".reply-card[id]") : null;
      replyList.innerHTML = lastRepliesHtml = html;
      if (linkReplies) {
        for (const [target, title] of replyTitles) {
          mountSavedPost(document.getElementById(target)?.querySelector(".reply-actions"), {
            path: `${publicTaskPath}#${target}`,
            title,
            sync: false,
          });
        }
        syncSavedButtons(replyList);
      }
      if (focused) {
        const updated = document.getElementById(focused.id);
        const selector = active.matches("button[data-saved-post-path]") ? "button[data-saved-post-path]" : ".reply-permalink";
        (active === focused ? updated : updated?.querySelector(selector))?.focus({ preventScroll: true });
      }
    }
    if (linkReplies) focusLinkedReply();
  }
  function render() {
    host.querySelector("#like-count").textContent = count(state.totalLikes);
    host.querySelector("#like-label").textContent = state.hasLiked
      ? t("♥ Liked", "♥ 已赞")
      : t("♡ Like", "♡ 点赞");
    like.setAttribute("aria-pressed", String(state.hasLiked));
    like.disabled = state.hasLiked || liking || expired || !navigator.onLine;
    reported ||= state.hasReported === true;
    report.disabled = reported || reporting || expired || !navigator.onLine;
    reportReasonControl.hidden = state.reportReviewEnabled !== true;
    reportReason.disabled = report.disabled || reportReasonControl.hidden;
    reportStatus.textContent = reported ? t("Report submitted.", "举报已提交。") : "";
    if (!allowReplies) return;
    host.querySelector("#reply-count").textContent =
      t(`${count(state.replies.length)} ${state.replies.length === 1 ? "reply" : "replies"}`, `${count(state.replies.length)} 条回复`);
    renderReplies(state.replies);
    // Contacts are collected only when the task has a private management link.
    const privateContacts = state.acceptsPrivateContacts === true;
    host.querySelector("#private-contact-fields").hidden = !privateContacts;
    // Completed/closed tasks keep existing replies visible but accept no new ones.
    // Legacy tasks without a management link cannot accept replies because contacts cannot be retrieved.
    const final = ["completed", "closed"].includes(state.taskState);
    const legacy = state.acceptsPrivateContacts === false;
    const closed = final || legacy || state.taskAssigned;
    const closedNote = host.querySelector("#replies-closed");
    closedNote.hidden = !closed;
    closedNote.textContent = wanted && closed
      ? t("This item request is not accepting offers.", "这条求赠暂不接受赠予回复。")
      : final
      ? t(`This task is ${state.taskState === "completed" ? "completed" : "closed"}. It no longer accepts new replies.`, `此任务${state.taskState === "completed" ? "已完成" : "已关闭"}，不再接受新回复。`)
      : legacy
        ? t("This older task has no private management link, so its poster cannot retrieve contact details. It no longer accepts replies.", "此旧任务没有私人管理链接，发布者无法获取联系方式，因此不再接受回复。")
        : state.taskAssigned
          ? t("This task already has someone assigned.", "此任务已有接单人，暂不接受新回复。")
          : "";
    host.querySelector("#reply-form").hidden = closed;
    host.querySelector("#send-reply").disabled =
      closed ||
      replying ||
      expired ||
      !navigator.onLine ||
      state.replies.length >= 200;
  }
  report.onclick = async () => {
    if (report.disabled) return;
    const reviewEnabled = state.reportReviewEnabled === true;
    if (reviewEnabled && !reportReason.value) {
      reportError.textContent = t("Choose a valid report reason.", "请选择有效的举报理由。");
      reportError.hidden = false;
      reportReason.focus();
      return;
    }
    if (!confirm(t("Report this post?", "确定举报此帖子吗？"))) return;
    reporting = true;
    report.disabled = true;
    reportReason.disabled = true;
    reportError.hidden = true;
    try {
      const result = await api(`/api/posts/${id}/reports`, reviewEnabled ? { reason: reportReason.value } : {});
      if (result.frozen) {
        expired = true;
        location.reload();
        return;
      }
      reported = result.hasReported;
    } catch (e) {
      if (e.status === 404) {
        expired = true;
        location.reload();
        return;
      }
      reportError.textContent = e.message;
      reportError.hidden = false;
    } finally {
      reporting = false;
      if (isMounted() && !expired) render();
      if (refreshPending) void refresh();
    }
  };
  like.onclick = async () => {
    if (liking || !state || state.hasLiked) return;
    liking = true;
    const version = replyVersion;
    like.disabled = true;
    host.querySelector("#social-error").hidden = true;
    try {
      const updated = await api(`/api/posts/${id}/likes`, {});
      if (!isMounted()) return;
      state = version === replyVersion && !replying ? updated
        : { ...state, hasLiked: updated.hasLiked, totalLikes: updated.totalLikes };
      render();
    } catch (e) {
      if (isMounted()) error(e.message);
    } finally {
      liking = false;
      if (isMounted() && state) render();
      if (refreshPending) void refresh();
    }
  };
  if (allowReplies) {
    const form = host.querySelector("#reply-form");
    const target = form.querySelector("#reply-error");
    const phoneInput = form.querySelector("#reply-phone");
    const emailInput = form.querySelector("#reply-email");
    const contactError = form.querySelector("#reply-contact-error");
    const messageInput = form.querySelector("#reply-message");
    const length = form.querySelector("#reply-message-length span");
    const lengthStatus = form.querySelector("#reply-message-limit-status");
    form.insertAdjacentHTML("afterend", `<div id="reply-confirmation" class="success-banner" hidden>
      <p role="status" id="reply-confirmation-message">${t("Reply posted.", "回复已发布。")}</p>
      <div class="local-post-controls">
        <a class="button secondary small" aria-describedby="reply-confirmation-message" hidden>${t("View your reply", "查看你的回复")}</a>
        <button class="button secondary small" type="button" hidden>${t("Copy reply link", "复制回复链接")}</button>
        ${linkCopyFallback("posted-reply-link")}
      </div>
    </div>`);
    const confirmation = host.querySelector("#reply-confirmation");
    const viewReply = confirmation.querySelector("a");
    const copyReply = confirmation.querySelector("button");
    const copyFallback = copyReply.nextElementSibling;
    let publicReplyLink;
    bindLinkCopy(copyReply, () => publicReplyLink, t("Link copied.", "链接已复制。"));
    function updateReplyLength() {
      const used = messageInput.value.length;
      const max = messageInput.maxLength;
      length.textContent = `${count(used)} / ${count(max)}`;
      const status = used >= max ? t("Reply length limit reached.", "回复已达到长度上限。")
        : used >= max * 0.9 ? t("You are close to the reply length limit.", "回复已接近长度上限。") : "";
      if (lengthStatus.textContent !== status) lengthStatus.textContent = status;
    }
    messageInput.addEventListener("input", updateReplyLength);
    updateReplyLength();
    function clearContactError() {
      showFormError(contactError, "");
      phoneInput.removeAttribute("aria-describedby");
      emailInput.removeAttribute("aria-describedby");
    }
    form.addEventListener("input", (event) => {
      if ((event.target === phoneInput || event.target === emailInput) && event.target.value.trim()) clearContactError();
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (replying || !state) return;
      showFormError(target, "");
      const value = (key) => form.querySelector(key).value.trim();
      const phone = phoneInput.value.trim();
      const email = emailInput.value.trim();
      if (!phone && !email) {
        showFormError(contactError, t("Provide a phone number or email address, or both. Only the task creator can see them.", "请填写电话或邮箱，也可以都填。只有使用任务管理密码才能解密。"), { focus: false });
        phoneInput.setAttribute("aria-describedby", contactError.id);
        emailInput.setAttribute("aria-describedby", contactError.id);
        phoneInput.focus();
        return;
      }
      clearContactError();
      const returnFocus = form.contains(document.activeElement);
      confirmation.hidden = true;
      copyFallback.hidden = true;
      publicReplyLink = undefined;
      ++replyVersion;
      replying = true;
      render();
      try {
        const task = await api(`/api/tasks/${id}`);
        const encryptedContact = await encryptReplyContact(
          task.contactPublicKey,
          { phone, email },
          id,
        );
        const posted = await api(`/api/posts/${id}/replies`, {
          name: value("#reply-name"),
          message: value("#reply-message"),
          encryptedContact,
          privacyAccepted: host.querySelector("#contact-consent").checked,
        });
        if (!isMounted()) return;
        state = posted;
        event.target.reset();
        updateReplyLength();
        render();
        const replyId = state.createdReplyId;
        const hasPublicReply = typeof replyId === "string" && /^[a-f0-9]{24}$/.test(replyId)
          && state.replies.some(reply => reply.id === replyId);
        if (hasPublicReply) {
          const fragment = `#reply-${replyId}`;
          const path = publicTaskPath + fragment;
          viewReply.href = linkReplies ? fragment : localizedPath(path);
          publicReplyLink = new URL(path, location.origin).href;
        }
        copyReply.hidden = viewReply.hidden = !hasPublicReply;
        confirmation.hidden = false;
        if (hasPublicReply && returnFocus
          && (form.contains(document.activeElement) || document.activeElement === document.body)) viewReply.focus();
        toast(
          t("Your name and message are public. Your contact details are visible only to the task creator.", "你的姓名和留言会公开；联系方式已加密，只有使用任务管理密码才能解密。"),
        );
      } catch (e) {
        if (!isMounted()) return;
        showFormError(target, e);
        // A 409 can mean the task was completed or closed meanwhile.
        if (e.status === 409) refreshPending = true;
      } finally {
        replying = false;
        ++replyVersion;
        if (isMounted()) render();
        if (refreshPending) void refresh();
      }
    };
  }
  async function refresh() {
    if (!isMounted()) return;
    if (document.hidden || fetching || liking || replying || reporting || expired) return;
    fetching = true;
    refreshPending = false;
    const version = replyVersion;
    try {
      const updated = await api(`/api/posts/${id}/social`);
      if (!isMounted()) return;
      if (version !== replyVersion) return;
      state = updated;
      host.querySelector("#social-error").hidden = true;
      render();
      onState?.(state);
    } catch (e) {
      if (!isMounted()) return;
      if (e.status === 404) {
        expired = true;
        stop();
        host.innerHTML =
          `<p role="status">${t("This post and its replies are no longer available.", "此帖子及其回复已不可用。")}</p>`;
        onUnavailable?.();
      } else if (version === replyVersion) error(e.message);
    } finally {
      fetching = false;
      if (refreshPending) void refresh();
    }
  }
  let timer;
  function startPolling() {
    if (stopped || timer) return;
    timer = setInterval(refresh, 15000);
  }
  function stopPolling() {
    clearInterval(timer);
    timer = undefined;
  }
  function onVisibilityChange() {
    void refresh();
  }
  function onOnline() {
    void refresh();
  }
  function onOffline() {
    if (state && !expired && !stopped) render();
  }
  function onPageHide() {
    stopPolling();
  }
  function onPageShow(event) {
    if (!event.persisted || expired || stopped) return;
    startPolling();
    void refresh();
  }
  // Idempotent: unbinds every listener and clears the timer so a removed post
  // (or a page that tore down this widget) never keeps polling /social.
  function stop() {
    if (stopped) return;
    stopped = true;
    stopPolling();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    if (linkReplies) window.removeEventListener("hashchange", onReplyHashChange);
  }
  startPolling();
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  if (linkReplies) window.addEventListener("hashchange", onReplyHashChange);
  refresh();
  return { refresh, stop };
}
