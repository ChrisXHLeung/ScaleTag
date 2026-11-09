import { api, escape, date, count, toast, t } from "/common.js";

export function mountSocial(id, allowReplies, onUnavailable, onState) {
  const host = document.querySelector("#social");
  // Name and message are public. Phone/email are private to whoever holds the
  // task's management link; legacy tasks without a link collect no contacts and accept no replies.
  const replyForm = `<form id="reply-form"><h3>${t("Leave a reply", "写回复")}</h3><div class="reply-privacy-note" role="note"><strong>${t("Your name and message are public.", "你的姓名和留言会公开显示。")}</strong> ${t("Anyone can read them. Never put a phone number, email address or other contact details in them.", "任何人都能看到。请勿在这里填写电话、邮箱或其他联系方式。")}</div><label for="reply-name">${t("Public name ", "公开姓名 ")}<span class="optional">${t("optional, unverified, shown to everyone", "选填，未经验证，所有人可见")}</span></label><input id="reply-name" maxlength="60" placeholder="${t("Anonymous", "匿名")}" autocomplete="off"><label for="reply-message">${t("Public message ", "公开留言 ")}<span class="optional">${t("shown to everyone", "所有人可见")}</span></label><textarea id="reply-message" maxlength="2000" rows="4" required aria-describedby="reply-message-hint"></textarea><p id="reply-message-hint" class="field-hint">${t("Do not include contact details here. Messages that look like they contain a phone number or email address are rejected.", "请勿填写联系方式。系统会拒绝疑似包含电话或邮箱的留言。")}</p><fieldset id="private-contact-fields" class="contact-fields"><legend>${t("Private contact for the task creator", "留给任务发布者的联系方式")}</legend><p class="field-hint">${t("Add a phone number or email address, or both. These are ", "请填写电话、邮箱，或两者都填。这些信息")}<strong>${t("not shown publicly", "不会公开显示")}</strong>. ${t("They are visible only to anyone holding this task’s private management link (normally the person who posted it), and to ScaleTag administrators and private backups.", "只有持有任务私人管理链接的人（通常是任务发布者）和 ScaleTag 管理员可以查看，私人备份中也会保留。")}</p><label for="reply-phone">${t("Phone ", "电话 ")}<span class="optional">${t("private · optional if you provide email", "私人信息 · 已提供邮箱时可不填")}</span></label><input id="reply-phone" type="tel" maxlength="40" autocomplete="tel" placeholder="+1 416 555 0123"><label for="reply-email">${t("Email ", "电子邮箱 ")}<span class="optional">${t("private · optional if you provide phone", "私人信息 · 已提供电话时可不填")}</span></label><input id="reply-email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com"></fieldset><label class="checkbox-row"><input id="contact-consent" type="checkbox" required><span id="consent-private">${t("I understand that my name and message are public until this task leaves the website, 30 days after it was published. My phone/email is not public: it is visible to anyone holding this task’s private management link, and to ScaleTag administrators and private backups kept for up to 90 days. I have not put contact details in my name or message.", "我了解我的姓名和消息会公开，直到任务在发布 30 天后从网站移除。我的电话和邮箱不会公开：持有该任务私人管理链接的人、ScaleTag 管理员以及最多保留 90 天的私人备份可以看到。我没有在姓名或消息中填写联系方式。")}</span></label><p class="field-hint">${t("ScaleTag does not handle payments or transactions. Names, messages and contact details are unverified.", "ScaleTag 不处理付款或交易。姓名、消息和联系方式未经验证。")}</p><button id="send-reply" class="button" type="submit" disabled>${t("Post reply", "发布回复")}</button><p id="reply-error" class="form-error" role="alert" hidden></p></form>`;
  host.innerHTML = `<section class="social-card"><h2>${t("Show your support.", "点个赞")}</h2><button id="like-post" class="button secondary" type="button" aria-pressed="false" disabled><span id="like-label">${t("♡ Like", "♡ 点赞")}</span> <span id="like-count">…</span></button><p class="field-hint">${t("One like per browser, as far as an anonymous cookie allows. No account needed.", "我们使用匿名 Cookie 尽量限制每个浏览器只能点赞一次，无需注册。")}</p><p id="social-error" class="form-error" role="alert" hidden></p>${allowReplies ? `<div class="replies-heading"><h2>${t("Public replies", "公开回复")}</h2><span id="reply-count"></span></div><p class="field-hint">${t("Names and messages are public. Contact details are never shown here.", "姓名和消息是公开的，联系方式不会显示在这里。")}</p><div id="reply-list" aria-live="polite"></div><p id="replies-closed" class="replies-closed" role="status" hidden></p>${replyForm}` : ""}</section>`;
  const like = host.querySelector("#like-post");
  let state,
    liking = false,
    replying = false,
    fetching = false,
    expired = false;
  function error(message) {
    const target = host.querySelector("#social-error");
    target.textContent = message;
    target.hidden = false;
  }
  function render() {
    host.querySelector("#like-count").textContent = count(state.totalLikes);
    host.querySelector("#like-label").textContent = state.hasLiked
      ? t("♥ Liked", "♥ 已赞")
      : t("♡ Like", "♡ 点赞");
    like.setAttribute("aria-pressed", String(state.hasLiked));
    like.disabled = state.hasLiked || liking || expired || !navigator.onLine;
    if (!allowReplies) return;
    host.querySelector("#reply-count").textContent =
      t(`${count(state.replies.length)} ${state.replies.length === 1 ? "reply" : "replies"}`, `${count(state.replies.length)} 条回复`);
    host.querySelector("#reply-list").innerHTML = state.replies.length
      ? state.replies
          .map(
            (r) =>
              `<article class="reply-card"><div class="reply-byline"><strong>${escape(r.name)}</strong><span>${date(r.createdAt)} · ${t("Unverified", "未经验证")}</span></div><p class="reply-message">${escape(r.message)}</p></article>`,
          )
          .join("")
      : `<p class="field-hint">${t("No replies yet. Start the conversation.", "还没有回复，来说两句吧。")}</p>`;
    // Contacts are collected only when the task has a private management link.
    const privateContacts = state.acceptsPrivateContacts === true;
    host.querySelector("#private-contact-fields").hidden = !privateContacts;
    // Completed/closed tasks keep existing replies visible but accept no new ones.
    // Legacy tasks without a management link cannot accept replies because contacts cannot be retrieved.
    const final = ["completed", "closed"].includes(state.taskState);
    const legacy = state.acceptsPrivateContacts === false;
    const closed = final || legacy;
    const closedNote = host.querySelector("#replies-closed");
    closedNote.hidden = !closed;
    closedNote.textContent = final
      ? t(`This task is ${state.taskState === "completed" ? "completed" : "closed"}. It no longer accepts new replies.`, `此任务${state.taskState === "completed" ? "已完成" : "已关闭"}，不再接受新回复。`)
      : legacy
        ? t("This older task has no private management link, so its poster cannot retrieve contact details. It no longer accepts replies.", "此旧任务没有私人管理链接，发布者无法获取联系方式，因此不再接受回复。")
        : "";
    host.querySelector("#reply-form").hidden = closed;
    host.querySelector("#send-reply").disabled =
      closed ||
      replying ||
      expired ||
      !navigator.onLine ||
      state.replies.length >= 200;
  }
  like.onclick = async () => {
    if (liking || !state || state.hasLiked) return;
    liking = true;
    like.disabled = true;
    host.querySelector("#social-error").hidden = true;
    try {
      state = await api(`/api/posts/${id}/likes`, {});
      render();
    } catch (e) {
      error(e.message);
    } finally {
      liking = false;
      if (state) render();
    }
  };
  if (allowReplies)
    host.querySelector("#reply-form").onsubmit = async (event) => {
      event.preventDefault();
      if (replying || !state) return;
      const target = host.querySelector("#reply-error");
      target.hidden = true;
      const value = (key) => host.querySelector(key).value.trim();
      const phone = value("#reply-phone");
      const email = value("#reply-email");
      if (!phone && !email) {
        target.textContent =
          t("Provide a phone number or email address, or both. Only the task creator can see them.", "请填写电话或邮箱，也可以都填。持有私人管理链接的人和 ScaleTag 管理员可以查看，私人备份中也会保留。");
        target.hidden = false;
        return;
      }
      replying = true;
      render();
      try {
        state = await api(`/api/posts/${id}/replies`, {
          name: value("#reply-name"),
          message: value("#reply-message"),
          phone,
          email,
          privacyAccepted: host.querySelector("#contact-consent").checked,
        });
        event.target.reset();
        render();
        toast(
          t("Your name and message are public. Your contact details are visible only to the task creator.", "你的姓名和留言会公开；联系方式仅供持有私人管理链接的人和 ScaleTag 管理员查看，也会保存在私人备份中。"),
        );
      } catch (e) {
        target.textContent = e.message;
        target.hidden = false;
        // A 409 can mean the task was completed or closed meanwhile.
        if (e.status === 409) setTimeout(refresh);
      } finally {
        replying = false;
        render();
      }
    };
  async function refresh() {
    if (document.hidden || fetching || liking || replying || expired) return;
    fetching = true;
    try {
      state = await api(`/api/posts/${id}/social`);
      host.querySelector("#social-error").hidden = true;
      render();
      onState?.(state);
    } catch (e) {
      if (e.status === 404) {
        expired = true;
        clearInterval(timer);
        host.innerHTML =
          `<p role="status">${t("This post and its replies are no longer available.", "此帖子及其回复已不可用。")}</p>`;
        onUnavailable?.();
      } else error(e.message);
    } finally {
      fetching = false;
    }
  }
  const timer = setInterval(refresh, 15000);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", () => {
    if (state && !expired) render();
  });
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
  refresh();
  return { refresh };
}
