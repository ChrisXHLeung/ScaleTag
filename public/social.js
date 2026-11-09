import { api, escape, date, count, toast } from "/common.js";

export function mountSocial(id, allowReplies, onUnavailable, onState) {
  const host = document.querySelector("#social");
  // Name and message are public. Phone/email are private to whoever holds the
  // task's management link; legacy tasks without a link collect no contacts and accept no replies.
  const replyForm = `<form id="reply-form"><h3>Leave a reply</h3><div class="reply-privacy-note" role="note"><strong>Your name and message are public.</strong> Anyone can read them. Never put a phone number, email address or other contact details in them.</div><label for="reply-name">Public name <span class="optional">optional, unverified, shown to everyone</span></label><input id="reply-name" maxlength="60" placeholder="Anonymous" autocomplete="off"><label for="reply-message">Public message <span class="optional">shown to everyone</span></label><textarea id="reply-message" maxlength="2000" rows="4" required aria-describedby="reply-message-hint"></textarea><p id="reply-message-hint" class="field-hint">Do not include contact details here. Messages that look like they contain a phone number or email address are rejected.</p><fieldset id="private-contact-fields" class="contact-fields"><legend>Private contact for the task creator</legend><p class="field-hint">Add a phone number or email address, or both. These are <strong>not shown publicly</strong>. They are visible only to anyone holding this task’s private management link (normally the person who posted it), and to ScaleTag administrators and private backups.</p><label for="reply-phone">Phone <span class="optional">private · optional if you provide email</span></label><input id="reply-phone" type="tel" maxlength="40" autocomplete="tel" placeholder="+1 416 555 0123"><label for="reply-email">Email <span class="optional">private · optional if you provide phone</span></label><input id="reply-email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com"></fieldset><label class="checkbox-row"><input id="contact-consent" type="checkbox" required><span id="consent-private">I understand that my name and message are public until this task leaves the website, 30 days after it was published. My phone/email is not public: it is visible to anyone holding this task’s private management link, and to ScaleTag administrators and private backups kept for up to 90 days. I have not put contact details in my name or message.</span></label><p class="field-hint">ScaleTag does not handle payments or transactions. Names, messages and contact details are unverified.</p><button id="send-reply" class="button" type="submit" disabled>Post reply</button><p id="reply-error" class="form-error" role="alert" hidden></p></form>`;
  host.innerHTML = `<section class="social-card"><h2>Show your support.</h2><button id="like-post" class="button secondary" type="button" aria-pressed="false" disabled><span id="like-label">♡ Like</span> <span id="like-count">…</span></button><p class="field-hint">One like per browser, as far as an anonymous cookie allows. No account needed.</p><p id="social-error" class="form-error" role="alert" hidden></p>${allowReplies ? `<div class="replies-heading"><h2>Public replies</h2><span id="reply-count"></span></div><p class="field-hint">Names and messages are public. Contact details are never shown here.</p><div id="reply-list" aria-live="polite"></div><p id="replies-closed" class="replies-closed" role="status" hidden></p>${replyForm}` : ""}</section>`;
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
      ? "♥ Liked"
      : "♡ Like";
    like.setAttribute("aria-pressed", String(state.hasLiked));
    like.disabled = state.hasLiked || liking || expired || !navigator.onLine;
    if (!allowReplies) return;
    host.querySelector("#reply-count").textContent =
      `${count(state.replies.length)} ${state.replies.length === 1 ? "reply" : "replies"}`;
    host.querySelector("#reply-list").innerHTML = state.replies.length
      ? state.replies
          .map(
            (r) =>
              `<article class="reply-card"><div class="reply-byline"><strong>${escape(r.name)}</strong><span>${date(r.createdAt)} · Unverified</span></div><p class="reply-message">${escape(r.message)}</p></article>`,
          )
          .join("")
      : '<p class="field-hint">No replies yet. Start the conversation.</p>';
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
      ? `This task is ${state.taskState === "completed" ? "completed" : "closed"}. It no longer accepts new replies.`
      : legacy
        ? "This older task has no private management link, so its poster cannot retrieve contact details. It no longer accepts replies."
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
          "Provide a phone number or email address, or both. Only the task creator can see them.";
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
          "Your name and message are public. Your contact details are visible only to the task creator.",
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
          '<p role="status">This post and its replies are no longer available.</p>';
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
