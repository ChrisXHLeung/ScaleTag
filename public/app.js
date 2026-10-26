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
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
const shortDate = (time) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(time),
  );
const count = (value) => new Intl.NumberFormat("en").format(value);
const percent = (votes, total) =>
  total ? ((votes / total) * 100).toFixed(1).replace(/\.0$/, "") : "0";
function remaining(end, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((end - now) / 60000));
  if (!minutes) return "Voting closed";
  if (minutes >= 1440)
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h left`;
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left`
    : `${minutes}m left`;
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
    throw new Error("Could not connect. Check your connection and try again.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The service is temporarily unavailable. Please try again.",
    );
  }
  if (!response.ok) {
    const error = new Error(
      data.error ?? "Something went wrong. Please try again.",
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
          "Location is not supported in this browser. Try a browser with location access.",
        ),
      );
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === 1
              ? "Location permission is required. Allow it in your browser settings and try again."
              : e.code === 3
                ? "Location timed out. Please try again."
                : "Your location is unavailable. Check your device location settings and try again.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}
function notice() {
  return `<div class="retention-note">${icons.clock}<div><strong>Here for 30 days. Then gone for good.</strong><p>All poll data is permanently deleted 30 days after publication and cannot be recovered. Save anything you need before then.</p></div></div>`;
}
function showError(error) {
  document.title = "Poll unavailable — ScaleTag";
  main.innerHTML = `<section class="empty-page"><span class="eyebrow">NOT HERE ANYMORE</span><h1>This page is unavailable.</h1><p>${escape(error.message)}</p><p>Polls are permanently deleted 30 days after publication. Deleted data cannot be recovered.</p><a class="button" href="/VoteList">Explore VoteList ${icons.arrow}</a></section>`;
}

function home() {
  document.title = "ScaleTag — Small questions. Local voices.";
  main.innerHTML = `<section class="hero">
    <div class="hero-copy"><div class="eyebrow"><span class="live-dot"></span> SMALL QUESTIONS. LOCAL VOICES.</div><h1>Put a question<br>out into <em>the world.</em></h1><p>Create a poll. Share a code. Hear what people think.<br class="desktop-only"> No accounts, no complicated setup. Just a little curiosity.</p><a class="button" href="/create">Start a conversation ${icons.arrow}</a><a class="text-link" href="/VoteList">Explore VoteList ↗</a></div>
    <div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><span class="orbit-dot dot-one"></span><span class="orbit-dot dot-two"></span><div class="art-stamp">A LITTLE QUESTION<br>CAN GO A LONG WAY</div><div class="question-tag"><span class="tag-hole"></span><span class="tag-caption">YOUR NEXT CONVERSATION</span><strong>What if<br>we asked?</strong><div class="tag-bottom"><span>ONE QUESTION<br>MANY PERSPECTIVES</span><span class="tag-arrow">↗</span></div></div><div class="location-chip">${icons.pin} Rooted in a real place</div><div class="seven-badge"><strong>7</strong><span>DAYS TO<br>HAVE YOUR SAY</span></div></div>
  </section>
  <section class="principles" aria-label="How ScaleTag works"><div>${icons.clock}<span><strong>7 days to vote</strong><small>Starts the moment you publish.</small></span></div><div>${icons.qr}<span><strong>One code. Any conversation.</strong><small>Save it, print it, pass it around.</small></span></div><div>${icons.shield}<span><strong>No account needed</strong><small>A name of your choosing is enough.</small></span></div></section>`;
}

function createPoll() {
  document.title = "Create a poll — ScaleTag";
  document.querySelector('[data-nav="create"]').classList.add("active");
  main.innerHTML = `<section class="create-section"><aside class="section-intro"><a class="back-link" href="/">← Back to home</a><span class="eyebrow">START SOMETHING</span><h1>What’s on<br>your mind?</h1><p>A neighborhood idea. A small decision.<br>Something you’ve always wondered.</p><div class="intro-note"><span class="tiny-label">KEEP IT SIMPLE</span><p>One question, a few options,<br>and room for a different perspective.</p></div><div class="rules"><p>${icons.pin} Location is required to publish.</p><p>${icons.clock} Voting stays open for exactly 7 days.</p><p>${icons.shield} Your signature is not verified.</p></div></aside>
  <form id="create-form" class="form-card">
    <div class="form-heading"><h2>Your new poll</h2><span class="pill">SINGLE CHOICE</span></div>
    <label for="title">The question <span class="required">*</span></label><input id="title" name="title" maxlength="140" placeholder="What should we make happen next?" required><div class="field-hint"><span>Keep it clear and open to everyone.</span><span id="title-count">0 / 140</span></div>
    <label for="description">A little context <span class="optional">optional</span></label><textarea id="description" name="description" maxlength="4000" rows="4" placeholder="Tell people a bit more about your question…"></textarea>
    <details class="image-fields"><summary>Add images using external URLs <span>+</span></summary><p class="field-hint">Up to 3 HTTPS image URLs. ScaleTag does not upload or store images.</p><label class="sr-only" for="images">Image URLs, one per line</label><textarea id="images" rows="3" placeholder="https://example.com/image.jpg&#10;One URL per line"></textarea></details>
    <fieldset class="options-fieldset"><legend>The options <span class="required">*</span></legend><p class="field-hint">Add 2–12 choices. Each person selects one.</p><div id="option-inputs"></div><button class="add-option" type="button" id="add-option">${icons.plus} Add an option</button></fieldset>
    <label for="signature">Your signature <span class="required">*</span></label><input id="signature" name="signature" maxlength="60" placeholder="A name, a nickname, or a little mystery" required><p class="field-hint">Pick any name. No account or identity verification.</p>
    <div class="location-box"><div><strong>${icons.pin} Give your poll a place</strong><p id="location-status" aria-live="polite">Your location helps people discover nearby polls.</p></div><button class="button secondary small" type="button" id="locate">Enable location</button></div><p class="field-hint">We store the poll’s coordinates, not your movement. Exact coordinates are not shown publicly.</p>
    ${notice()}<label class="checkbox-row"><input type="checkbox" id="retention" required><span>I understand that all data will be permanently deleted after 30 days and cannot be recovered.</span></label>
    <p id="form-error" class="form-error" role="alert" hidden></p><button class="button publish-button" type="submit" id="publish">Publish my poll ${icons.arrow}</button><p class="publish-note">Starts immediately · Closes in 7 days · Deleted in 30 days</p>
  </form></section>`;
  let location;
  let locatedAt = 0;
  const form = document.querySelector("#create-form");
  const inputs = document.querySelector("#option-inputs");
  function renumber() {
    inputs.querySelectorAll(".option-input").forEach((row, i) => {
      row.querySelector(".option-number").textContent = String(i + 1).padStart(
        2,
        "0",
      );
      row.querySelector("input").setAttribute("aria-label", `Option ${i + 1}`);
      row.querySelector("input").placeholder = `Option ${i + 1}`;
      row.querySelector("button").disabled = inputs.children.length <= 2;
      row
        .querySelector("button")
        .setAttribute("aria-label", `Remove option ${i + 1}`);
    });
    document.querySelector("#add-option").disabled =
      inputs.children.length >= 12;
  }
  function addOption(focus = false) {
    if (inputs.children.length >= 12) return;
    const row = document.createElement("div");
    row.className = "option-input";
    row.innerHTML =
      '<span class="option-number"></span><input type="text" maxlength="120" required><button type="button" class="remove-option" title="Remove option">×</button>';
    row.querySelector("button").onclick = () => {
      row.remove();
      renumber();
    };
    inputs.append(row);
    renumber();
    if (focus) row.querySelector("input").focus();
  }
  addOption();
  addOption();
  document.querySelector("#add-option").onclick = () => addOption(true);
  document.querySelector("#title").oninput = (e) => {
    document.querySelector("#title-count").textContent =
      `${e.target.value.length} / 140`;
  };
  const locateButton = document.querySelector("#locate");
  locateButton.onclick = async () => {
    locateButton.disabled = true;
    locateButton.textContent = "Locating…";
    try {
      location = await locate();
      locatedAt = Date.now();
      document.querySelector("#location-status").textContent =
        "Location ready. You’re all set to publish.";
      locateButton.textContent = "Refresh location";
      document.querySelector(".location-box").classList.add("located");
    } catch (e) {
      location = undefined;
      document.querySelector("#location-status").textContent = e.message;
      locateButton.textContent = "Try again";
    } finally {
      locateButton.disabled = false;
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const error = document.querySelector("#form-error");
    const publish = document.querySelector("#publish");
    error.hidden = true;
    publish.disabled = true;
    publish.textContent = "Publishing…";
    try {
      if (!location || Date.now() - locatedAt > 5 * 60000) {
        location = await locate();
        locatedAt = Date.now();
      }
      const images = document
        .querySelector("#images")
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const poll = await api("/api/polls", {
        title: form.elements.namedItem("title").value,
        description: form.elements.namedItem("description").value,
        signature: form.elements.namedItem("signature").value,
        options: [...inputs.querySelectorAll("input")].map((el) => el.value),
        images,
        location,
        retentionAccepted: document.querySelector("#retention").checked,
      });
      window.location.assign(`/vote/${poll.id}?created=1`);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      error.scrollIntoView({ block: "nearest", behavior: "smooth" });
      publish.disabled = false;
      publish.innerHTML = `Publish my poll ${icons.arrow}`;
    }
  };
}

async function votePage(id) {
  let poll = await api(`/api/polls/${id}`);
  document.title = `${poll.title} — ScaleTag`;
  main.innerHTML = `<section class="poll-layout"><div class="poll-main"><a class="back-link" href="/VoteList">← Back to VoteList</a>
    ${new URLSearchParams(location.search).has("created") ? '<div class="success-banner" role="status">Your poll is live. Share its QR code to start the conversation.</div>' : ""}
    <div class="poll-meta"><span id="poll-status" class="status-badge"></span><span>Single choice</span><span id="time-left"></span></div><h1 class="poll-title">${escape(poll.title)}</h1><p class="byline">Started by <strong>${escape(poll.signature)}</strong> <span>· ${date(poll.createdAt)}</span><span class="unverified">Unverified signature</span></p>
    ${poll.description ? `<p class="poll-description">${escape(poll.description)}</p>` : ""}
    ${poll.images.length ? `<div class="external-images"><button class="button secondary small" id="load-images">Show ${poll.images.length} external image${poll.images.length > 1 ? "s" : ""}</button><p class="field-hint">Images load from third-party hosts, which may receive your IP address.</p><div id="poll-images"></div></div>` : ""}
    <section class="ballot-card"><div class="ballot-heading"><h2>Have your say.</h2><span class="tiny-label">PICK ONE</span></div><form id="vote-form"><fieldset id="vote-options"><legend class="sr-only">Choose one option</legend>${poll.options.map((o) => `<label class="vote-option"><input type="radio" name="option" value="${o.id}" required><span>${escape(o.label)}</span><span class="option-check" aria-hidden="true"></span></label>`).join("")}</fieldset><p id="vote-message" class="vote-message" role="status"></p><p id="vote-error" class="form-error" role="alert" hidden></p><button class="button" id="cast-vote" type="submit">Cast my vote ${icons.arrow}</button><p class="field-hint">One vote per browser, as far as an anonymous cookie allows.</p></form></section>
    <section class="results-section" aria-label="Current results"><div class="results-heading"><h2>The conversation so far</h2><span id="total-votes"></span></div><div id="results"></div><p class="field-hint" id="results-updated">Results refresh every 15 seconds while this page is visible.</p></section>
    </div><aside class="poll-sidebar"><section class="share-card"><span class="eyebrow">PASS IT ON</span><h2>A small code.<br>A bigger conversation.</h2><div class="qr-frame"><img src="/api/polls/${id}/qr.png" width="256" height="256" alt="QR code linking to this poll"></div><p>Scan to vote. Save to share.</p><a href="/api/polls/${id}/qr.png?download=1" class="button" download="ScaleTag-${id}.png">${icons.download} Save QR image</a><button class="button secondary" id="copy-link">Copy poll link</button></section><section class="timeline-card"><div>${icons.clock}<span>Voting closes<strong>${date(poll.endsAt)}</strong></span></div><div>${icons.shield}<span>Permanently deleted<strong>${date(poll.deleteAt)}</strong></span></div><p>Dates are shown in your local time.</p></section>${notice()}</aside></section>`;
  if (poll.images.length)
    document.querySelector("#load-images").onclick = (e) => {
      const target = document.querySelector("#poll-images");
      for (const [i, url] of poll.images.entries()) {
        const image = document.createElement("img");
        image.src = url;
        image.alt = `Poll illustration ${i + 1}`;
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.onerror = () => {
          const p = document.createElement("p");
          p.className = "field-hint";
          p.textContent = `Image ${i + 1} is unavailable from its host.`;
          image.replaceWith(p);
        };
        target.append(image);
      }
      e.currentTarget.remove();
    };
  document.querySelector("#copy-link").onclick = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/vote/${id}`);
      toast("Poll link copied.");
    } catch {
      toast(
        "Could not copy automatically. Copy the link from your address bar.",
      );
    }
  };
  function render() {
    const closed = poll.status === "closed";
    const badge = document.querySelector("#poll-status");
    badge.textContent = closed ? "Voting closed" : "Open for votes";
    badge.classList.toggle("closed", closed);
    document.querySelector("#time-left").textContent = remaining(
      poll.endsAt,
      poll.serverTime,
    );
    document.querySelector("#total-votes").textContent =
      `${count(poll.totalVotes)} ${poll.totalVotes === 1 ? "vote" : "votes"}`;
    document.querySelector("#results").innerHTML = poll.options
      .map(
        (o) =>
          `<div class="result-row"><div><span>${escape(o.label)}</span><strong>${percent(o.votes, poll.totalVotes)}% <small>${count(o.votes)} ${o.votes === 1 ? "vote" : "votes"}</small></strong></div><progress value="${o.votes}" max="${poll.totalVotes || 1}" aria-label="${escape(o.label)}: ${percent(o.votes, poll.totalVotes)} percent"></progress></div>`,
      )
      .join("");
    document.querySelector("#vote-options").disabled = closed || poll.hasVoted;
    document.querySelector("#cast-vote").disabled = closed || poll.hasVoted;
    document.querySelector("#cast-vote").innerHTML = closed
      ? "Voting has ended"
      : poll.hasVoted
        ? "Your vote is counted ✓"
        : `Cast my vote ${icons.arrow}`;
    document.querySelector("#vote-message").textContent = closed
      ? "This poll has ended. You can still view the results and share its QR code until deletion."
      : poll.hasVoted
        ? "Thanks for adding your voice. This browser has already voted."
        : "Results are visible to everyone, before and after voting.";
    if (closed)
      document.querySelector("#results-updated").textContent =
        "Final results. This poll is no longer accepting votes.";
  }
  render();
  let submitting = false;
  document.querySelector("#vote-form").onsubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    const button = document.querySelector("#cast-vote");
    const error = document.querySelector("#vote-error");
    button.disabled = true;
    error.hidden = true;
    try {
      poll = await api(`/api/polls/${id}/votes`, {
        optionId: Number(new FormData(e.target).get("option")),
      });
      toast("Your vote is in. Thank you!");
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      try {
        poll = await api(`/api/polls/${id}`);
      } catch {}
    } finally {
      submitting = false;
      render();
    }
  };
  let fetching = false;
  async function refresh() {
    if (document.hidden || submitting || fetching) return;
    fetching = true;
    try {
      poll = await api(`/api/polls/${id}`);
      render();
    } catch (e) {
      if (e.status === 404) {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", refresh);
        showError(e);
      } else
        document.querySelector("#results-updated").textContent =
          "Could not refresh results. We’ll try again shortly.";
    } finally {
      fetching = false;
    }
  }
  const timer = setInterval(refresh, 15000);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
}

function voteList() {
  document.title = "VoteList — ScaleTag";
  document.querySelector('[data-nav="list"]').classList.add("active");
  main.innerHTML = `<section class="list-page"><div class="list-heading"><div><span class="eyebrow">THE PUBLIC NOTICEBOARD</span><h1>Every question<br>starts <em>somewhere.</em></h1><p>Explore the latest polls, or find conversations closer to home.</p></div><a href="/create" class="button">Create a poll ${icons.plus}</a></div><div class="list-toolbar"><div class="filter-tabs" role="group" aria-label="Poll status"><button class="selected" data-filter="all" aria-pressed="true">All polls</button><button data-filter="open" aria-pressed="false">Open</button><button data-filter="closed" aria-pressed="false">Ended</button></div><button class="near-button" id="nearby" aria-pressed="false">${icons.pin} Within 100 km <span class="toggle" aria-hidden="true"></span></button></div><div class="list-caption"><span id="list-caption">Newest first · Available for 30 days</span><span id="list-count"></span></div><p class="location-privacy" id="location-privacy" hidden>Your location is used only for this search and is not saved.</p><p id="list-error" class="form-error" role="alert" hidden></p><div id="poll-list" class="poll-grid" aria-live="polite"></div><button id="load-more" class="button secondary load-more" hidden>Load more polls</button><p class="list-retention">Every poll is permanently deleted 30 days after publication. Deleted data cannot be recovered.</p></section>`;
  let status = "all",
    location,
    cursor,
    loaded = 0,
    request = 0,
    locating = false;
  function card(p) {
    return `<a class="poll-list-card" href="/vote/${p.id}"><div class="card-top"><span class="status-badge ${p.status === "closed" ? "closed" : ""}">${p.status === "closed" ? "Ended" : "Open"}</span><span>${shortDate(p.createdAt)}</span></div><h2>${escape(p.title)}</h2><p class="card-signature">by ${escape(p.signature)}</p><div class="mini-results">${p.options
      .slice(0, 3)
      .map(
        (o) =>
          `<div><span>${escape(o.label)}</span><strong>${percent(o.votes, p.totalVotes)}%</strong><progress value="${o.votes}" max="${p.totalVotes || 1}" aria-label="${escape(o.label)}: ${percent(o.votes, p.totalVotes)} percent"></progress></div>`,
      )
      .join(
        "",
      )}${p.options.length > 3 ? `<small>+ ${p.options.length - 3} more options</small>` : ""}</div><div class="card-bottom"><span>${count(p.totalVotes)} votes <span class="separator">·</span> ${remaining(p.endsAt, p.serverTime)}</span>${icons.arrow}</div></a>`;
  }
  async function load(reset = true) {
    const current = ++request;
    const list = document.querySelector("#poll-list");
    const more = document.querySelector("#load-more");
    document.querySelector("#list-error").hidden = true;
    more.disabled = true;
    if (reset) {
      cursor = undefined;
      loaded = 0;
      list.innerHTML =
        '<div class="list-empty" role="status">Finding conversations…</div>';
      more.hidden = true;
    }
    try {
      const data = await api("/api/polls/search", {
        status,
        ...(location ? { location } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (current !== request) return;
      if (reset) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", data.polls.map(card).join(""));
      loaded += data.polls.length;
      cursor = data.nextCursor;
      if (!loaded)
        list.innerHTML = `<div class="list-empty"><span class="empty-symbol">${icons.pin}</span><h2>${location ? "A little quiet around here." : "The first question could be yours."}</h2><p>${location ? "No matching polls within 100 km. Try all locations, or start a conversation nearby." : "No polls match this filter yet. Create a poll and invite a few voices in."}</p><a class="text-link" href="/create">Create a poll ↗</a></div>`;
      document.querySelector("#list-count").textContent =
        `${count(loaded)} ${loaded === 1 ? "poll" : "polls"} shown`;
      more.hidden = !cursor;
    } catch (e) {
      if (current !== request) return;
      const error = document.querySelector("#list-error");
      error.textContent = e.message;
      error.hidden = false;
      if (reset)
        list.innerHTML =
          '<div class="list-empty">Could not load polls. Select a filter to try again.</div>';
    } finally {
      if (current === request) more.disabled = false;
    }
  }
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.onclick = () => {
      status = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((b) => {
        b.classList.toggle("selected", b === button);
        b.setAttribute("aria-pressed", String(b === button));
      });
      load();
    };
  });
  document.querySelector("#nearby").onclick = async (e) => {
    if (locating) return;
    const button = e.currentTarget;
    if (location) {
      location = undefined;
      button.classList.remove("enabled");
      button.setAttribute("aria-pressed", "false");
      document.querySelector("#location-privacy").hidden = true;
      load();
      return;
    }
    locating = true;
    button.disabled = true;
    document.querySelector("#list-error").hidden = true;
    try {
      location = await locate();
      button.classList.add("enabled");
      button.setAttribute("aria-pressed", "true");
      document.querySelector("#location-privacy").hidden = false;
      await load();
    } catch (e) {
      const error = document.querySelector("#list-error");
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      locating = false;
      button.disabled = false;
    }
  };
  document.querySelector("#load-more").onclick = () => load(false);
  load();
}

function privacy() {
  document.title = "Privacy & retention — ScaleTag";
  main.innerHTML = `<article class="privacy-page"><a class="back-link" href="/">← Back to ScaleTag</a><span class="eyebrow">A SMALL DATA FOOTPRINT</span><h1>A few things<br>you should know.</h1><h2>No account. No fingerprint.</h2><p>We don’t ask voters for a name, email address, or account. A separate random, HttpOnly, Secure, SameSite cookie is used for each poll in production. Its hashed identifier prevents repeat votes from that browser and is removed after voting closes. We don’t use a cross-poll identifier or device fingerprint.</p><p>This is not identity verification or a guarantee of one vote per person. Clearing cookies, using private browsing, or switching browsers can allow another vote. Cookies must be enabled to vote.</p><h2>A place, not a trail.</h2><p>Creating a poll requires browser location permission. We store its latitude and longitude with the poll to support nearby discovery. Exact coordinates are not included in public responses. Nearby filtering uses your current coordinates for that request only; they are not saved or added to a URL. Location supplied by a browser is not independently verified.</p><h2>Seven days to vote. Thirty days to exist.</h2><p>Voting starts at publication and closes exactly 168 hours later. Results remain visible until 30 days after publication. At that point, the poll, its results, location, and related identifiers are permanently deleted and cannot be recovered. The original link and QR code stop opening the poll. Save what you need before deletion.</p><p>ScaleTag keeps no application-level backups or access logs containing poll data. Expired polls become inaccessible immediately and their files are removed by a background cleanup, normally within 30 seconds while the service is running. Cleanup also runs at startup. External screenshots, downloaded QR codes, and copies made by other people cannot be recalled.</p><h2>Images stay with their hosts.</h2><p>We only store external HTTPS image URLs. Images load when you choose to show them. Their hosts may receive your IP address and may change or remove an image. ScaleTag does not proxy or store those images.</p><h2>Infrastructure still carries requests.</h2><p>The application does not store IP addresses for voting or keep request access logs. Requests pass through Cloudflare, which processes connection information according to its own policies. Server security logs may also exist; an anonymous poll does not mean every network layer is anonymous.</p><h2>Signatures are just signatures.</h2><p>Creators choose any name. A signature is not verified and should not be treated as proof of someone’s identity. Polls appear publicly in VoteList. Only publish information you are comfortable sharing.</p><a class="text-link" href="https://github.com/ChrisXHLeung/ScaleTag" target="_blank" rel="noopener noreferrer">Read the source on GitHub ↗</a></article>`;
}
const route = window.location.pathname;
try {
  if (route === "/" && location.hash === "#create") window.location.replace("/create");
  else if (route === "/") home();
  else if (route === "/create") createPoll();
  else if (route === "/VoteList") voteList();
  else if (route === "/privacy") privacy();
  else if (/^\/vote\/[a-f0-9]{24}$/.test(route))
    await votePage(route.split("/")[2]);
  else showError(new Error("This link does not point to an available poll."));
} catch (e) {
  showError(e);
}
