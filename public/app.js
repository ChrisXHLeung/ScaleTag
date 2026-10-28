import {
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
} from "/common.js";
import { mountSocial } from "/social.js";
import { createTask, taskPage } from "/tasks.js";
function showError(error) {
  document.title = "Post unavailable — ScaleTag";
  main.innerHTML = `<section class="empty-page"><span class="eyebrow">NOT HERE ANYMORE</span><h1>This page is unavailable.</h1><p>${escape(error.message)}</p><p>Polls leave the website 30 days after publication. Private backup copies may remain for disaster recovery; this link no longer provides access.</p><a class="button" href="/PostList">Explore PostList ${icons.arrow}</a></section>`;
}

function home() {
  document.title = "ScaleTag — Small questions. Local voices.";
  main.innerHTML = `<section class="hero">
    <div class="hero-copy"><div class="eyebrow"><span class="live-dot"></span> SMALL QUESTIONS. LOCAL VOICES.</div><h1>Put a question<br>out into <em>the world.</em></h1><p>Post a poll or a task. Share a code. Connect with people nearby.<br class="desktop-only"> No accounts, no complicated setup. Just a little curiosity.</p><a class="button" href="/create">Start a conversation ${icons.arrow}</a><a class="text-link" href="/PostList">Explore PostList ↗</a></div>
    <div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><span class="orbit-dot dot-one"></span><span class="orbit-dot dot-two"></span><div class="art-stamp">A LITTLE QUESTION<br>CAN GO A LONG WAY</div><div class="question-tag"><span class="tag-hole"></span><span class="tag-caption">YOUR NEXT CONVERSATION</span><strong>What if<br>we asked?</strong><div class="tag-bottom"><span>ONE QUESTION<br>MANY PERSPECTIVES</span><span class="tag-arrow">↗</span></div></div><div class="location-chip">${icons.pin} Rooted in a real place</div><div class="seven-badge"><strong>7</strong><span>DAYS TO<br>VOTE IN POLLS</span></div></div>
  </section>
  <section class="home-install" aria-labelledby="home-install-title"><a href="/install" class="home-install-qr"><img src="/install/qr.png" alt="QR code for the ScaleTag installation guide" width="140" height="140"></a><div><span class="eyebrow">TAKE IT WITH YOU</span><h2 id="home-install-title">A little app. One scan away.</h2><p>Scan with your phone for installation steps made for your device.</p><a class="text-link" href="/install">Open the installation guide ↗</a></div></section>
  <section class="principles" aria-label="How ScaleTag works"><div>${icons.clock}<span><strong>7 days to vote</strong><small>Polls vote for 7 days. All posts stay for 30.</small></span></div><div>${icons.qr}<span><strong>One code. Any conversation.</strong><small>Save it, print it, pass it around.</small></span></div><div>${icons.shield}<span><strong>No account needed</strong><small>A name of your choosing is enough.</small></span></div></section>`;
}

function installPage() {
  document.title = "Install ScaleTag — ScaleTag";
  const shareIcon =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3"/></svg>';
  main.innerHTML = `<section class="install-page"><a class="back-link" href="/">← Back to home</a><div class="install-page-heading"><img src="/icons/icon-192.png" width="72" height="72" alt=""><span class="eyebrow">KEEP A LITTLE CURIOSITY CLOSE</span><h1>Install ScaleTag.</h1><p>Keep ScaleTag on your home screen for your next conversation.</p></div>
    <div class="installed-notice success-banner" id="install-page-done" role="status" hidden>ScaleTag is installed. Open it from your home screen.</div>
    <button type="button" class="button install-page-native" id="install-page-native" hidden>Install ScaleTag</button>
    <div class="device-picker" role="group" aria-label="Your device"><button type="button" data-install-platform="ios" aria-pressed="false">iPhone / iPad</button><button type="button" data-install-platform="android" aria-pressed="false">Android / desktop</button></div>
    <section class="install-steps" data-platform-panel="ios" aria-labelledby="ios-install-title"><h2 id="ios-install-title">Add it from Safari.</h2><ol><li><span class="step-number">1</span><div><h3>Tap Share ${shareIcon}</h3><p>Find the square with an upward arrow in Safari’s toolbar or menu.</p></div></li><li><span class="step-number">2</span><div><h3>Add to Home Screen</h3><p>Choose this option from the share menu. Scroll down if needed.</p></div></li><li><span class="step-number">3</span><div><h3>Confirm Add</h3><p>Keep Open as Web App enabled if shown, then tap Add. The ScaleTag icon is ready on your home screen.</p></div></li></ol><p class="install-browser-hint">Scanned inside another app? Open this page in Safari to use Add to Home Screen.</p></section>
    <section class="install-steps" data-platform-panel="android" aria-labelledby="android-install-title" hidden><h2 id="android-install-title">Install from your browser.</h2><ol><li><span class="step-number">1</span><div><h3>Tap Install ScaleTag</h3><p>When your browser offers installation, use the blue button above.</p></div></li><li><span class="step-number">2</span><div><h3>Confirm installation</h3><p>Approve the browser’s installation prompt. ScaleTag is added as an app with its own icon.</p></div></li><li><span class="step-number">3</span><div><h3>Open from your app icon</h3><p>Use ScaleTag from your home screen or app launcher.</p></div></li></ol><p class="install-browser-hint" id="android-install-fallback">No install button? In Chrome or Edge, open the browser menu and choose Install app or Add to Home Screen. Some in-app browsers do not support installation.</p></section>
    <p class="install-page-note" data-install-message>Publishing, voting and current results still need an internet connection. No account is required.</p><a class="button secondary" href="/">Continue to ScaleTag ${icons.arrow}</a></section>`;
}

function createPoll() {
  document.title = "Create a poll — ScaleTag";
  document.querySelector('[data-nav="create"]').classList.add("active");
  main.innerHTML = `<section class="create-section"><aside class="section-intro"><a class="back-link" href="/">← Back to home</a><span class="eyebrow">START SOMETHING</span><h1>What’s on<br>your mind?</h1><p>A neighborhood idea. A small decision.<br>Something you’ve always wondered.</p><div class="intro-note"><span class="tiny-label">KEEP IT SIMPLE</span><p>One question, a few options,<br>and room for a different perspective.</p></div><div class="rules"><p>${icons.pin} Location is required to publish.</p><p>${icons.clock} Voting stays open for exactly 7 days.</p><p>${icons.shield} Your signature is not verified.</p></div></aside>
  <form id="create-form" class="form-card"><div class="post-kind-switch" aria-label="Post type"><a href="/create" aria-current="page">Poll</a><a href="/create/task">Task</a></div>
    <div class="form-heading"><h2>Your new poll</h2><span class="pill">SINGLE CHOICE</span></div>
    <label for="title">The question <span class="required">*</span></label><input id="title" name="title" maxlength="140" placeholder="What should we make happen next?" required><div class="field-hint"><span>Keep it clear and open to everyone.</span><span id="title-count">0 / 140</span></div>
    <label for="description">A little context <span class="optional">optional</span></label><textarea id="description" name="description" maxlength="4000" rows="4" placeholder="Tell people a bit more about your question…"></textarea>
    <details class="image-fields"><summary>Add images using external URLs <span>+</span></summary><p class="field-hint">Up to 3 HTTPS image URLs. ScaleTag does not upload or store images.</p><label class="sr-only" for="images">Image URLs, one per line</label><textarea id="images" rows="3" placeholder="https://example.com/image.jpg&#10;One URL per line"></textarea></details>
    <fieldset class="options-fieldset"><legend>The options <span class="required">*</span></legend><p class="field-hint">Add 2–12 choices. Each person selects one.</p><div id="option-inputs"></div><button class="add-option" type="button" id="add-option">${icons.plus} Add an option</button></fieldset>
    <label for="signature">Your signature <span class="required">*</span></label><input id="signature" name="signature" maxlength="60" placeholder="A name, a nickname, or a little mystery" required><p class="field-hint">Pick any name. No account or identity verification.</p>
    <div class="location-box"><div><strong>${icons.pin} Give your poll a place</strong><p id="location-status" aria-live="polite">Your location helps people discover nearby polls.</p></div><button class="button secondary small" type="button" id="locate">Enable location</button></div><p class="field-hint">We store the poll’s coordinates, not your movement. Exact coordinates are not shown publicly. The map shows a rounded area on a 0.01° grid (about 1 km north–south, narrower east–west).</p>
    <label class="checkbox-row"><input type="checkbox" id="map-consent" required><span>I agree to show my poll’s approximate area publicly on the map. This does not guarantee anonymity.</span></label>${notice()}<label class="checkbox-row"><input type="checkbox" id="retention" required><span>I understand that my poll leaves the website after 30 days and that private daily backups are retained for up to 90 days after each backup is created.</span></label>
    <p id="form-error" class="form-error" role="alert" hidden></p><button class="button publish-button" type="submit" id="publish">Publish my poll ${icons.arrow}</button><p class="publish-note">Starts immediately · Closes in 7 days · Removed in 30 days</p>
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
        mapVisible: document.querySelector("#map-consent").checked,
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
  main.innerHTML = `<section class="poll-layout"><div class="poll-main"><a class="back-link" href="/PostList">← Back to PostList</a>
    ${new URLSearchParams(location.search).has("created") ? '<div class="success-banner" role="status">Your poll is live. Share its QR code to start the conversation.</div>' : ""}
    <div class="poll-meta"><span id="poll-status" class="status-badge"></span><span>Single choice</span><span id="time-left"></span></div><h1 class="poll-title">${escape(poll.title)}</h1><p class="byline">Started by <strong>${escape(poll.signature)}</strong> <span>· ${date(poll.createdAt)}</span><span class="unverified">Unverified signature</span></p>
    ${poll.description ? `<p class="poll-description">${escape(poll.description)}</p>` : ""}
    ${poll.images.length ? `<div class="external-images"><button class="button secondary small" id="load-images">Show ${poll.images.length} external image${poll.images.length > 1 ? "s" : ""}</button><p class="field-hint">Images load from third-party hosts, which may receive your IP address.</p><div id="poll-images"></div></div>` : ""}
    <section class="ballot-card"><div class="ballot-heading"><h2>Have your say.</h2><span class="tiny-label">PICK ONE</span></div><form id="vote-form"><fieldset id="vote-options"><legend class="sr-only">Choose one option</legend>${poll.options.map((o) => `<label class="vote-option"><input type="radio" name="option" value="${o.id}" required><span>${escape(o.label)}</span><span class="option-check" aria-hidden="true"></span></label>`).join("")}</fieldset><p id="vote-message" class="vote-message" role="status"></p><p id="vote-error" class="form-error" role="alert" hidden></p><button class="button" id="cast-vote" type="submit">Cast my vote ${icons.arrow}</button><p class="field-hint">One vote per browser, as far as an anonymous cookie allows.</p></form></section>
    <section class="results-section" aria-label="Current results"><div class="results-heading"><h2>The conversation so far</h2><span id="total-votes"></span></div><div id="results"></div><p class="field-hint" id="results-updated">Results refresh every 15 seconds while this page is visible.</p></section>
    <section id="social" aria-label="Poll likes"></section></div><aside class="poll-sidebar"><section class="share-card"><span class="eyebrow">PASS IT ON</span><h2>A small code.<br>A bigger conversation.</h2><div class="qr-frame"><img src="/api/polls/${id}/qr.png" width="256" height="256" alt="QR code linking to this poll"></div><p>Scan to vote. Save to share.</p><a href="/api/polls/${id}/qr.png?download=1" class="button" download="ScaleTag-${id}.png">${icons.download} Save QR image</a><button class="button secondary" id="copy-link">Copy poll link</button></section><section class="timeline-card"><div>${icons.clock}<span>Voting closes<strong>${date(poll.endsAt)}</strong></span></div><div>${icons.shield}<span>Removed from the website<strong>${date(poll.deleteAt)}</strong></span></div><p>Dates are shown in your local time.</p></section>${notice()}</aside></section>`;
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
  mountSocial(id, false);
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
  window.addEventListener("online", refresh);
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
}

function postList() {
  document.title = "PostList — ScaleTag";
  document.querySelector('[data-nav="list"]').classList.add("active");
  main.innerHTML = `<section class="list-page"><div class="list-heading"><div><span class="eyebrow">THE PUBLIC NOTICEBOARD</span><h1>Every post<br>starts <em>somewhere.</em></h1><p>Explore polls and local tasks, or find conversations closer to home.</p></div><a href="/create" class="button">Create a post ${icons.plus}</a></div><label class="content-filter" for="content-type">Show <select id="content-type"><option value="all">Polls &amp; tasks</option><option value="poll">Polls</option><option value="task">Tasks</option></select></label><div class="view-switch" role="group" aria-label="PostList view"><button type="button" class="selected" data-view="list" aria-pressed="true">List</button><button type="button" data-view="map" aria-pressed="false">Map</button></div><div class="list-toolbar"><div class="filter-tabs" role="group" aria-label="Post status"><button class="selected" data-filter="all" aria-pressed="true">All posts</button><button data-filter="open" aria-pressed="false">Open</button><button data-filter="closed" aria-pressed="false">Ended</button></div><button class="near-button" id="nearby" aria-pressed="false">${icons.pin} Within 100 km <span class="toggle" aria-hidden="true"></span></button></div><div class="list-caption"><span id="list-caption">Newest first · Available for 30 days</span><span id="list-count"></span></div><p class="location-privacy" id="location-privacy" hidden>Your location is used only for this search and is not saved.</p><p id="list-error" class="form-error" role="alert" hidden></p><section id="map-panel" class="map-panel" aria-label="Post map" hidden><div class="map-intro"><strong>Posts on the map</strong><p>Approximate areas only. Loading this view connects to OpenFreeMap, which receives your IP address and the map areas you view. Post content stays on ScaleTag.</p></div><p id="map-message" class="map-message" role="status">Loading the map…</p><div id="poll-map" class="poll-map" role="region" aria-label="Interactive map of approximate post locations"></div><div class="map-legend"><span><i class="legend-dot"></i> Open</span><span><i class="legend-dot ended"></i> Ended</span><button class="text-link" id="map-fit" type="button">Fit all markers ↗</button></div><p id="map-count" class="map-count" aria-live="polite"></p><p class="map-footnote">Only posts published with map consent appear here. Older posts remain in List. Positions use a 0.01° grid, about 1 km north–south and narrower east–west.</p><details class="mapped-polls"><summary>Browse mapped posts without the map</summary><ul id="mapped-poll-links"></ul></details></section><div id="poll-list" class="poll-grid" aria-live="polite"></div><button id="load-more" class="button secondary load-more" hidden>Load more posts</button><p class="list-retention">Posts leave the website after 30 days. Private daily backups are retained for up to 90 days after backup creation.</p></section>`;
  let status = "all",
    location,
    cursor,
    loaded = 0,
    request = 0,
    locating = false,
    mode = "list",
    contentType = "all",
    mapView,
    mapLoading,
    mapGeneration = 0,
    mapRequest = 0,
    mapTimer;
  function getMap() {
    if (mapView) return Promise.resolve(mapView);
    const generation = mapGeneration;
    mapLoading ??= import("/map.js")
      .then((module) => module.createPollMap())
      .then((view) => {
        if (generation !== mapGeneration) {
          view.destroy();
          return null;
        }
        mapView = view;
        return view;
      })
      .catch((error) => {
        if (generation === mapGeneration) mapLoading = undefined;
        throw error;
      });
    return mapLoading;
  }
  async function loadMap(fit = true) {
    clearTimeout(mapTimer);
    const current = ++mapRequest;
    const error = document.querySelector("#list-error");
    error.hidden = true;
    mapView?.setData([]);
    document.querySelector("#mapped-poll-links").replaceChildren();
    document.querySelector("#map-count").textContent = "Finding mapped posts…";
    const started = Date.now();
    try {
      const data = await api("/api/map/search", {
        status,
        type: contentType,
        ...(location ? { location } : {}),
      });
      if (current !== mapRequest || mode !== "map") return;
      const view = await getMap();
      if (!view || current !== mapRequest || mode !== "map") return;
      data.polls = data.polls.filter(
        (p) => p.deleteAt > data.serverTime + Date.now() - started,
      );
      view.setData(data.polls, fit);
      view.resize();
      document.querySelector("#map-count").textContent = data.total
        ? `${count(data.polls.length)} of ${count(data.total)} matching mapped posts${data.total > data.polls.length ? " · Newest 1,000 only" : ""}`
        : "No mapped posts match these filters. Try List to see all posts.";
      for (const p of data.polls) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `/${p.type === "task" ? "task" : "vote"}/${p.id}`;
        a.textContent = `${p.title} · ${p.type === "task" ? "Task" : p.status === "open" ? "Open" : "Ended"}`;
        li.append(a);
        document.querySelector("#mapped-poll-links").append(li);
      }
      const boundary = data.polls.reduce(
        (time, p) =>
          Math.min(
            time,
            p.deleteAt,
            ...(p.endsAt > data.serverTime ? [p.endsAt] : []),
          ),
        data.serverTime + 30000,
      );
      mapTimer = setTimeout(
        () => loadMap(false),
        Math.max(100, boundary - data.serverTime - (Date.now() - started)),
      );
    } catch (e) {
      if (current !== mapRequest || mode !== "map") return;
      mapView?.setData([]);
      document.querySelector("#map-count").textContent =
        "Mapped posts are unavailable. Try Map again or use List.";
      error.textContent = e.message;
      error.hidden = false;
    }
  }
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => {
      const previousMode = mode;
      mode = button.dataset.view;
      request++;
      mapRequest++;
      clearTimeout(mapTimer);
      document.querySelectorAll("[data-view]").forEach((b) => {
        b.classList.toggle("selected", b === button);
        b.setAttribute("aria-pressed", String(b === button));
      });
      document.querySelector("#map-panel").hidden = mode !== "map";
      document.querySelector("#poll-list").hidden = mode === "map";
      document.querySelector("#load-more").hidden = true;
      document.querySelector("#list-count").hidden = mode === "map";
      document.querySelector("#list-caption").textContent =
        mode === "map"
          ? "Approximate areas · Available for 30 days"
          : "Newest first · Available for 30 days";
      if (mode === "list" || previousMode === "map") {
        ++mapGeneration;
        mapView?.destroy();
        mapView = undefined;
        mapLoading = undefined;
        document.querySelector("#poll-map").replaceChildren();
      }
      load();
    };
  });
  document.querySelector("#map-fit").onclick = () => loadMap();
  window.addEventListener(
    "pagehide",
    () => {
      clearTimeout(mapTimer);
      mapView?.destroy();
    },
    { once: true },
  );
  window.addEventListener("offline", () => {
    if (mode !== "map") return;
    ++mapRequest;
    clearTimeout(mapTimer);
    mapView?.setData([]);
    document.querySelector("#mapped-poll-links").replaceChildren();
    document.querySelector("#map-count").textContent =
      "You’re offline. Reconnect to see current mapped posts.";
  });
  window.addEventListener("online", () => {
    if (mode === "map") loadMap(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (mode !== "map") return;
    if (document.hidden) {
      ++mapRequest;
      clearTimeout(mapTimer);
      mapView?.setData([]);
      document.querySelector("#mapped-poll-links").replaceChildren();
    } else loadMap(false);
  });
  document.querySelector("#content-type").onchange = (event) => {
    contentType = event.target.value;
    load();
  };
  function card(p) {
    if (p.type === "task")
      return `<a class="poll-list-card task-list-card" href="/task/${p.id}"><div class="card-top"><span class="status-badge">Task</span><span>${shortDate(p.createdAt)}</span></div><h2>${escape(p.title)}</h2><p class="card-signature">by ${escape(p.signature)}</p><div class="task-card-reward"><span>Reward offered</span><strong>${escape(p.reward)}</strong></div><div class="card-bottom"><span>♡ ${count(p.totalLikes ?? 0)} likes · ${count(p.replyCount ?? 0)} replies</span>${icons.arrow}</div></a>`;
    return `<a class="poll-list-card" href="/vote/${p.id}"><div class="card-top"><span class="status-badge ${p.status === "closed" ? "closed" : ""}">${p.status === "closed" ? "Ended" : "Open"}</span><span>${shortDate(p.createdAt)}</span></div><h2>${escape(p.title)}</h2><p class="card-signature">by ${escape(p.signature)}</p><div class="mini-results">${p.options
      .slice(0, 3)
      .map(
        (o) =>
          `<div><span>${escape(o.label)}</span><strong>${percent(o.votes, p.totalVotes)}%</strong><progress value="${o.votes}" max="${p.totalVotes || 1}" aria-label="${escape(o.label)}: ${percent(o.votes, p.totalVotes)} percent"></progress></div>`,
      )
      .join(
        "",
      )}${p.options.length > 3 ? `<small>+ ${p.options.length - 3} more options</small>` : ""}</div><div class="card-bottom"><span>${count(p.totalVotes)} votes <span class="separator">·</span> ♡ ${count(p.totalLikes ?? 0)} likes <span class="separator">·</span> ${remaining(p.endsAt, p.serverTime)}</span>${icons.arrow}</div></a>`;
  }
  async function load(reset = true) {
    if (mode === "map") return loadMap();
    const current = ++request;
    const list = document.querySelector("#poll-list");
    const more = document.querySelector("#load-more");
    document.querySelector("#list-error").hidden = true;
    more.disabled = true;
    if (reset) {
      cursor = undefined;
      loaded = 0;
      list.innerHTML =
        '<div class="list-empty" role="status">Finding posts…</div>';
      more.hidden = true;
    }
    try {
      const data = await api("/api/posts/search", {
        status,
        type: contentType,
        ...(location ? { location } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (current !== request) return;
      if (reset) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", data.polls.map(card).join(""));
      loaded += data.polls.length;
      cursor = data.nextCursor;
      if (!loaded)
        list.innerHTML = `<div class="list-empty"><span class="empty-symbol">${icons.pin}</span><h2>${location ? "A little quiet around here." : "The first post could be yours."}</h2><p>${location ? "No matching posts within 100 km. Try all locations, or start a conversation nearby." : "No posts match this filter yet. Share a poll or task with your neighbourhood."}</p><a class="text-link" href="/create">Create a post ↗</a></div>`;
      document.querySelector("#list-count").textContent =
        `${count(loaded)} ${loaded === 1 ? "post" : "posts"} shown`;
      more.hidden = !cursor;
    } catch (e) {
      if (current !== request) return;
      const error = document.querySelector("#list-error");
      error.textContent = e.message;
      error.hidden = false;
      if (reset)
        list.innerHTML =
          '<div class="list-empty">Could not load posts. Select a filter to try again.</div>';
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
  main.innerHTML = `<article class="privacy-page"><a class="back-link" href="/">← Back to ScaleTag</a><span class="eyebrow">A SMALL DATA FOOTPRINT</span><h1>A few things<br>you should know.</h1><h2>No account. No fingerprint.</h2><p>We don’t ask voters for a name, email address, or account. A separate random, HttpOnly, Secure, SameSite cookie is used for each poll in production. Its hashed identifier prevents repeat votes from that browser and is removed from the active data store after voting closes. Private backup copies follow the retention policy below. We don’t use a cross-poll identifier or device fingerprint.</p><p>This is not identity verification or a guarantee of one vote per person. Clearing cookies, using private browsing, or switching browsers can allow another vote. Cookies must be enabled to vote.</p><h2>A place, not a trail.</h2><p>Creating a poll requires browser location permission. We store its latitude and longitude with the poll to support nearby discovery. Exact coordinates are not included in public responses. New polls can appear on the public map only with explicit map consent at creation. Their displayed position is rounded to a 0.01° grid (about 1 km north–south, narrower east–west). This is an approximate area, not an anonymity guarantee; locations already on grid points may be unchanged. Older polls without consent remain in the list only. Nearby filtering uses your current coordinates for that request only; they are not saved or added to a URL. Location supplied by a browser is not independently verified.</p><h2>Seven days to vote. Thirty days online.</h2><p>Voting starts at publication and closes exactly 168 hours later. Results remain visible until 30 days after publication. At that point, the poll, its results, location, and related identifiers are removed from the active website. The original link and QR code stop opening the poll. Save what you need before the public link expires.</p><p>Private daily backups include poll JSON data, including location and any deduplication hashes present at backup time. Each archive is retained for up to 90 days after creation for administrator-managed disaster recovery. This means a backup copy may remain for up to about 120 days after a poll was published. Backups are not publicly accessible and there is no user-facing recovery feature. Expired polls are not republished by restoring their original records.</p><p>Expired polls become inaccessible at the deadline. Active files are removed by a background cleanup, normally within 30 seconds while the service is running, and at startup. Archive expiry is enforced by the daily backup job; downtime or storage failures can delay physical cleanup. The application does not keep request access logs. External screenshots, downloaded QR codes, and copies made by other people cannot be recalled.</p><h2>Installed app and offline resources.</h2><p>You can install ScaleTag as a web app. Your browser may keep public scripts, styles, icons and a generic offline page. Poll pages, results, QR responses, location searches and vote requests are not saved in the offline cache. Votes are never queued for later submission. Installing the app does not verify your identity or change the anonymous-cookie voting limits.</p><h2>Maps load only when you choose Map.</h2><p>PostList starts in List view. Choosing Map loads a third-party OpenFreeMap basemap. OpenFreeMap receives your IP address and the map areas requested; poll titles, votes and signatures are not sent to it. ScaleTag serves the MapLibre library itself and does not use a map account or API key. Required map attribution remains visible. Map responses, marker searches and third-party map resources are not saved in ScaleTag’s offline cache. Your browser may cache basemap resources according to their provider’s headers. No offline maps are downloaded by ScaleTag. If the map is unavailable, use List.</p><h2>Tasks, likes and public replies.</h2><p>Tasks contain a title, description and reward offer, with required GPS and the same approximate-map disclosure as polls. Tasks and their replies leave the website 30 days after the task is published; a late reply does not extend that deadline. Private daily archives follow the 90-day retention rule above.</p><p>Tasks and polls support likes. A separate anonymous cookie for each post limits this browser to one like; it expires when the post leaves the website. Its SHA-256 hash and task reply-rate timestamps remain in the private record until removal and follow the archive policy. It is separate from the voting cookie and does not identify you across posts. Clearing cookies can bypass this limit.</p><p>Task replies require a phone number or email address, or both. Replies, names and contact details are public and unverified. Publish only contact details you have permission to share. There is no private inbox, account-based editing or user recovery. Copies made by others cannot be recalled. Contacts are not included in list/map responses or sent to the map provider. ScaleTag displays reward offers and contact information; it does not process payments, hold funds, accept bookings or manage transactions.</p><h2>Images stay with their hosts.</h2><p>We only store external HTTPS image URLs. Images load when you choose to show them. Their hosts may receive your IP address and may change or remove an image. ScaleTag does not proxy or store those images.</p><h2>Infrastructure still carries requests.</h2><p>The application does not store IP addresses for voting or keep request access logs. Requests pass through Cloudflare, which processes connection information according to its own policies. Server security logs may also exist; an anonymous poll does not mean every network layer is anonymous.</p><h2>Signatures are just signatures.</h2><p>Creators choose any name. A signature is not verified and should not be treated as proof of someone’s identity. Polls appear publicly in PostList. Only publish information you are comfortable sharing.</p><a class="text-link" href="https://github.com/ChrisXHLeung/ScaleTag" target="_blank" rel="noopener noreferrer">Read the source on GitHub ↗</a></article>`;
}
const route = window.location.pathname;
try {
  if (route === "/" && location.hash === "#create")
    window.location.replace("/create");
  else if (route === "/") home();
  else if (route === "/create") createPoll();
  else if (route === "/create/task") createTask();
  else if (route === "/install") installPage();
  else if (route === "/PostList") postList();
  else if (route === "/privacy") privacy();
  else if (/^\/vote\/[a-f0-9]{24}$/.test(route))
    await votePage(route.split("/")[2]);
  else if (/^\/task\/[a-f0-9]{24}$/.test(route))
    await taskPage(route.split("/")[2]);
  else showError(new Error("This link does not point to an available post."));
} catch (e) {
  showError(e);
}
