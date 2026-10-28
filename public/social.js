import { api, escape, date, count, toast } from "/common.js";

export function mountSocial(id, allowReplies, onUnavailable) {
  const host = document.querySelector("#social");
  host.innerHTML = `<section class="social-card"><h2>Show your support.</h2><button id="like-post" class="button secondary" type="button" aria-pressed="false" disabled><span id="like-label">♡ Like</span> <span id="like-count">…</span></button><p class="field-hint">One like per browser, as far as an anonymous cookie allows. No account needed.</p><p id="social-error" class="form-error" role="alert" hidden></p>${allowReplies ? `<div class="replies-heading"><h2>Replies</h2><span id="reply-count"></span></div><div id="reply-list" aria-live="polite"></div><form id="reply-form"><h3>Leave a reply</h3><label for="reply-name">Name <span class="optional">optional, unverified</span></label><input id="reply-name" maxlength="60" placeholder="Anonymous"><label for="reply-message">Your reply</label><textarea id="reply-message" maxlength="2000" rows="4" required></textarea><fieldset class="contact-fields"><legend>How can the poster reach you?</legend><p class="field-hint">Add a phone number or email address. You can provide both.</p><label for="reply-phone">Phone <span class="optional">optional if you provide email</span></label><input id="reply-phone" type="tel" maxlength="40" autocomplete="tel" placeholder="+1 416 555 0123"><label for="reply-email">Email <span class="optional">optional if you provide phone</span></label><input id="reply-email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com"></fieldset><label class="checkbox-row"><input id="contact-consent" type="checkbox" required><span>I understand that my reply and contact details will be publicly visible until this task leaves the website. Private backups follow the 90-day archive policy. I am sharing contact details I have permission to publish.</span></label><p class="field-hint">Contact each other directly. ScaleTag does not handle payments or transactions. Replies and contact details are unverified.</p><button id="send-reply" class="button" type="submit" disabled>Post reply</button><p id="reply-error" class="form-error" role="alert" hidden></p></form>` : ""}</section>`;
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
              `<article class="reply-card"><div class="reply-byline"><strong>${escape(r.name)}</strong><span>${date(r.createdAt)} · Unverified</span></div><p class="reply-message">${escape(r.message)}</p><div class="reply-contacts">${r.phone ? `<a href="tel:${escape(r.phone.replace(/[^+0-9]/g, ""))}">Phone: ${escape(r.phone)}</a>` : ""}${r.email ? `<a href="mailto:${escape(encodeURIComponent(r.email))}">Email: ${escape(r.email)}</a>` : ""}</div></article>`,
          )
          .join("")
      : '<p class="field-hint">No replies yet. Start the conversation.</p>';
    host.querySelector("#send-reply").disabled =
      replying || expired || !navigator.onLine || state.replies.length >= 200;
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
      if (!value("#reply-phone") && !value("#reply-email")) {
        target.textContent =
          "Provide a phone number or email address, or both.";
        target.hidden = false;
        return;
      }
      replying = true;
      render();
      try {
        state = await api(`/api/posts/${id}/replies`, {
          name: value("#reply-name"),
          message: value("#reply-message"),
          phone: value("#reply-phone"),
          email: value("#reply-email"),
          contactAccepted: host.querySelector("#contact-consent").checked,
        });
        event.target.reset();
        render();
        toast("Your reply is public. Contact each other directly.");
      } catch (e) {
        target.textContent = e.message;
        target.hidden = false;
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
}
