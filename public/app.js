import {
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
} from "/common.js";
import { mountSocial } from "/social.js";
import { createTask, taskPage, stateLabel, isFinalState } from "/tasks.js";
function showError(error) {
  document.title = t("Post unavailable — ScaleTag", "帖子不可用 — ScaleTag");
  main.innerHTML = `<section class="empty-page"><span class="eyebrow">${t("NOT HERE ANYMORE", "此页面已不可用")}</span><h1>${t("This page is unavailable.", "此页面不可用。")}</h1><p>${escape(error.message)}</p><p>${t("Polls leave the website 30 days after publication. Private backup copies may remain for disaster recovery; this link no longer provides access.", "投票发布 30 天后从网站移除。私有备份可能保留用于灾难恢复；此链接已无法访问。")}</p><a class="button" href="/PostList">${t("Explore PostList", "浏览帖子列表")} ${icons.arrow}</a></section>`;
}

function home() {
  document.title = t("ScaleTag — Small questions. Local voices.", "ScaleTag — 小小问题，邻里心声。");
  main.innerHTML = `<div class="home-page">
  <section class="home-hero" aria-labelledby="home-title">
    <div class="home-hero-copy"><p class="home-kicker">${t("Small questions. Local voices.", "小小问题，邻里心声。")}</p><h1 id="home-title">${t("Local questions.", "身边的问题。")}<br><span>${t("Real conversations.", "真实的交流。")}</span></h1><p class="home-lede">${t("Create a poll or post a local task. Share a code and connect with people nearby. No account needed.", "创建投票或发布本地任务，分享二维码，与附近的人联系。无需账号。")}</p><div class="home-actions"><a class="button home-primary" href="/create">${t("Create a poll", "创建投票")} ${icons.arrow}</a><a class="button secondary home-secondary" href="/create/task">${t("Create a task", "创建任务")} ${icons.arrow}</a></div><a class="home-explore" href="/PostList">${t("Explore PostList", "浏览帖子列表")} ${icons.arrow}</a></div>
    <div class="home-map"><img src="/neighborhood.png" alt="" fetchpriority="high"><span class="home-map-caption">${t("A question can start right here.", "一个问题可以从这里开始。")}</span></div>
  </section>
  <section class="home-facts" aria-label="${t("How ScaleTag works", "ScaleTag 的使用方式")}"><div>${icons.pin}<span><strong>${t("Rooted in a place", "立足本地")}</strong><small>${t("Posts start with a real location.", "帖子从真实位置开始。")}</small></span></div><div>${icons.clock}<span><strong>${t("Time to have your say", "说出你的想法")}</strong><small>${t("Polls stay open for seven days.", "投票开放七天。")}</small></span></div><div>${icons.shield}<span><strong>${t("No account needed", "无需账号")}</strong><small>${t("Join in without signing up.", "无需注册即可参与。")}</small></span></div></section>
  <section class="home-story" aria-labelledby="home-story-title"><div class="home-story-image" aria-hidden="true"></div><div class="home-story-copy"><p class="home-kicker">${t("On the map, in real life", "地图上的位置，现实中的联系")}</p><h2 id="home-story-title">${t("A neighborhood idea.", "一个邻里想法。")}<br><span>${t("A real conversation.", "一次真实交流。")}</span></h2><p>${t("From small questions to local tasks, ScaleTag gives ideas a place to start.", "从小问题到本地任务，ScaleTag 让想法有一个起点。")}</p><div class="home-story-links"><a href="/create"><strong>${t("Create a poll", "创建投票")}</strong><span>${t("Ask a question and hear what people think.", "提出问题，听听大家的想法。")}</span>${icons.arrow}</a><a href="/create/task"><strong>${t("Create a task", "创建任务")}</strong><span>${t("Post a task and an offer for help.", "发布任务与提供的报酬。")}</span>${icons.arrow}</a><a href="/PostList"><strong>${t("Explore PostList", "浏览帖子列表")}</strong><span>${t("Find polls and tasks in the list or map.", "在列表或地图中查找投票和任务。")}</span>${icons.arrow}</a></div></div></section>
  <section class="home-install" aria-labelledby="home-install-title"><div class="home-install-copy"><p class="home-kicker">${t("Take ScaleTag with you", "随身使用 ScaleTag")}</p><h2 id="home-install-title">${t("Install the app.", "安装应用。")}<br>${t("Explore locally.", "探索周边。")}</h2><p>${t("Scan with your phone for installation steps made for your device.", "使用手机扫码，查看适合设备的安装步骤。")}</p><a class="home-install-link" href="/install">${t("Open the installation guide", "打开安装指南")} ${icons.arrow}</a></div><a href="/install" class="home-install-qr"><img src="/install/qr.png" alt="${t("QR code for the ScaleTag installation guide", "ScaleTag 安装指南二维码")}" width="140" height="140"></a></section>
  </div>`;
}

function installPage() {
  document.title = t("Install ScaleTag — ScaleTag", "安装 ScaleTag — ScaleTag");
  const shareIcon =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3"/></svg>';
  main.innerHTML = `<section class="install-page"><a class="back-link" href="/">${t("← Back to home", "← 返回首页")}</a><div class="install-page-heading"><img src="/icons/icon-192.png" width="72" height="72" alt=""><span class="eyebrow">${t("KEEP A LITTLE CURIOSITY CLOSE", "随时探索身边")}</span><h1>${t("Install ScaleTag.", "安装 ScaleTag。")}</h1><p>${t("Keep ScaleTag on your home screen for your next conversation.", "将 ScaleTag 添加到主屏幕，方便下次交流。")}</p></div>
    <div class="installed-notice success-banner" id="install-page-done" role="status" hidden>${t("ScaleTag is installed. Open it from your home screen.", "ScaleTag 已安装，可从主屏幕打开。")}</div>
    <button type="button" class="button install-page-native" id="install-page-native" hidden>${t("Install ScaleTag", "安装 ScaleTag")}</button>
    <div class="device-picker" role="group" aria-label="${t("Your device", "你的设备")}"><button type="button" data-install-platform="ios" aria-pressed="false">${t("iPhone / iPad", "iPhone / iPad")}</button><button type="button" data-install-platform="android" aria-pressed="false">${t("Android / desktop", "安卓 / 电脑")}</button></div>
    <section class="install-steps" data-platform-panel="ios" aria-labelledby="ios-install-title"><h2 id="ios-install-title">${t("Add it from Safari.", "通过 Safari 添加。")}</h2><ol><li><span class="step-number">1</span><div><h3>${t("Tap Share", "点击分享")} ${shareIcon}</h3><p>${t("Find the square with an upward arrow in Safari’s toolbar or menu.", "在 Safari 工具栏或菜单中找到带向上箭头的方框。")}</p></div></li><li><span class="step-number">2</span><div><h3>${t("Add to Home Screen", "添加到主屏幕")}</h3><p>${t("Choose this option from the share menu. Scroll down if needed.", "在分享菜单中选择此项；如有需要请向下滚动。")}</p></div></li><li><span class="step-number">3</span><div><h3>${t("Confirm Add", "确认添加")}</h3><p>${t("Keep Open as Web App enabled if shown, then tap Add. The ScaleTag icon is ready on your home screen.", "如果出现“作为网页应用打开”，请保持启用，然后点击“添加”。ScaleTag 图标将出现在主屏幕。")}</p></div></li></ol><p class="install-browser-hint">${t("Scanned inside another app? Open this page in Safari to use Add to Home Screen.", "在其他应用中扫码？请在 Safari 中打开此页面以添加到主屏幕。")}</p></section>
    <section class="install-steps" data-platform-panel="android" aria-labelledby="android-install-title" hidden><h2 id="android-install-title">${t("Install from your browser.", "通过浏览器安装。")}</h2><ol><li><span class="step-number">1</span><div><h3>${t("Tap Install ScaleTag", "点击安装 ScaleTag")}</h3><p>${t("When your browser offers installation, use the Install ScaleTag button above.", "浏览器提供安装选项时，请使用上方的安装按钮。")}</p></div></li><li><span class="step-number">2</span><div><h3>${t("Confirm installation", "确认安装")}</h3><p>${t("Approve the browser’s installation prompt. ScaleTag is added as an app with its own icon.", "确认浏览器的安装提示，ScaleTag 将作为应用添加并显示图标。")}</p></div></li><li><span class="step-number">3</span><div><h3>${t("Open from your app icon", "通过应用图标打开")}</h3><p>${t("Use ScaleTag from your home screen or app launcher.", "从主屏幕或应用启动器打开 ScaleTag。")}</p></div></li></ol><p class="install-browser-hint" id="android-install-fallback">${t("No install button? In Chrome or Edge, open the browser menu and choose Install app or Add to Home Screen. Some in-app browsers do not support installation.", "没有安装按钮？在 Chrome 或 Edge 中打开浏览器菜单，选择安装应用或添加到主屏幕。部分应用内浏览器不支持安装。")}</p></section>
    <p class="install-page-note" data-install-message>${t("Publishing, voting and current results still need an internet connection. No account is required.", "发布、投票和查看最新结果仍需联网。无需账号。")}</p><a class="button secondary" href="/">${t("Continue to ScaleTag", "进入 ScaleTag")} ${icons.arrow}</a></section>`;
}

function createPoll() {
  document.title = t("Create a poll — ScaleTag", "创建投票 — ScaleTag");
  document.querySelector('[data-nav="create"]').classList.add("active");
  main.innerHTML = `<section class="create-section"><aside class="section-intro"><a class="back-link" href="/">${t("← Back to home", "← 返回首页")}</a><span class="eyebrow">${t("START SOMETHING", "发起新话题")}</span><h1>${t("What’s on", "你在想")}<br>${t("your mind?", "什么？")}</h1><p>${t("A neighborhood idea. A small decision.", "一个邻里想法，一项小决定。")}<br>${t("Something you’ve always wondered.", "一个你一直好奇的问题。")}</p><div class="intro-note"><span class="tiny-label">${t("KEEP IT SIMPLE", "简单就好")}</span><p>${t("One question, a few options,", "一个问题，几个选项，")}<br>${t("and room for a different perspective.", "为不同观点留出空间。")}</p></div><div class="rules"><p>${icons.pin} ${t("Location is required to publish.", "发布时需要定位。")}</p><p>${icons.clock} ${t("Voting stays open for exactly 7 days.", "投票开放整整 7 天。")}</p><p>${icons.shield} ${t("Your signature is not verified.", "署名未经验证。")}</p></div></aside>
  <form id="create-form" class="form-card"><div class="post-kind-switch" aria-label="${t("Post type", "帖子类型")}"><a href="/create" aria-current="page">${t("Poll", "投票")}</a><a href="/create/task">${t("Task", "任务")}</a></div>
    <div class="form-heading"><h2>${t("Your new poll", "创建投票")}</h2><span class="pill">${t("SINGLE CHOICE", "单选")}</span></div>
    <label for="title">${t("The question", "问题")} <span class="required">*</span></label><input id="title" name="title" maxlength="140" placeholder="${t("What should we make happen next?", "接下来应该做什么？")}" required><div class="field-hint"><span>${t("Keep it clear and open to everyone.", "请清晰表达，让所有人都能参与。")}</span><span id="title-count">0 / 140</span></div>
    <label for="description">${t("A little context", "补充说明")} <span class="optional">${t("optional", "可选")}</span></label><textarea id="description" name="description" maxlength="4000" rows="4" placeholder="${t("Tell people a bit more about your question\u2026", "向大家多介绍一下你的问题…")}"></textarea>
    <details class="image-fields"><summary>${t("Add images using external URLs", "使用外部链接添加图片")} <span>+</span></summary><p class="field-hint">${t("Up to 3 HTTPS image URLs. ScaleTag does not upload or store images.", "最多添加 3 个 HTTPS 图片链接。ScaleTag 不上传或存储图片。")}</p><label class="sr-only" for="images">${t("Image URLs, one per line", "图片链接，每行一个")}</label><textarea id="images" rows="3" placeholder="${t("https://example.com/image.jpg&#10;One URL per line", "https://example.com/image.jpg&#10;每行一个链接")}"></textarea></details>
    <fieldset class="options-fieldset"><legend>${t("The options", "选项")} <span class="required">*</span></legend><p class="field-hint">${t("Add 2–12 choices. Each person selects one.", "添加 2 至 12 个选项，每人选择一项。")}</p><div id="option-inputs"></div><button class="add-option" type="button" id="add-option">${icons.plus} ${t("Add an option", "添加选项")}</button></fieldset>
    <label for="signature">${t("Your signature", "署名")} <span class="required">*</span></label><input id="signature" name="signature" maxlength="60" placeholder="${t("A name, a nickname, or a little mystery", "姓名、昵称或其他署名")}" required><p class="field-hint">${t("Pick any name. No account or identity verification.", "可使用任意名称，无需账号或身份验证。")}</p>
    <div class="location-box"><div><strong>${icons.pin} ${t("Give your poll a place", "为投票设置位置")}</strong><p id="location-status" aria-live="polite">${t("Your location helps people discover nearby polls.", "你的位置可帮助人们发现附近的投票。")}</p></div><button class="button secondary small" type="button" id="locate">${t("Enable location", "启用定位")}</button></div><p class="field-hint">${t("We store the poll’s coordinates, not your movement. Exact coordinates are not shown publicly. The map shows a rounded area on a 0.01° grid (about 1 km north–south, narrower east–west).", "我们存储投票的坐标，不记录你的移动轨迹，也不公开精确坐标。地图按 0.01° 网格显示约略区域（南北约 1 公里，东西更窄）。")}</p>
    <label class="checkbox-row"><input type="checkbox" id="map-consent" required><span>${t("I agree to show my poll’s approximate area publicly on the map. This does not guarantee anonymity.", "我同意在地图上公开显示投票的大致区域。这不能保证匿名。")}</span></label>${notice()}<label class="checkbox-row"><input type="checkbox" id="retention" required><span>${t("I understand that my poll leaves the website after 30 days and that private daily backups are retained for up to 90 days after each backup is created.", "我了解投票将在 30 天后从网站移除，每日私有备份自创建起最多保留 90 天。")}</span></label>
    <p id="form-error" class="form-error" role="alert" hidden></p><button class="button publish-button" type="submit" id="publish">${t("Publish my poll", "发布投票")} ${icons.arrow}</button><p class="publish-note">${t("Starts immediately · Closes in 7 days · Removed in 30 days", "立即开始 · 7 天后截止 · 30 天后移除")}</p>
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
      row.querySelector("input").setAttribute("aria-label", t(`Option ${i + 1}`, `选项 ${i + 1}`));
      row.querySelector("input").placeholder = t(`Option ${i + 1}`, `选项 ${i + 1}`);
      row.querySelector("button").disabled = inputs.children.length <= 2;
      row
        .querySelector("button")
        .setAttribute("aria-label", t(`Remove option ${i + 1}`, `删除选项 ${i + 1}`));
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
    locateButton.textContent = t("Locating…", "正在定位…");
    try {
      location = await locate();
      locatedAt = Date.now();
      document.querySelector("#location-status").textContent =
        t("Location ready. You’re all set to publish.", "位置已就绪，可以发布。");
      locateButton.textContent = t("Refresh location", "刷新位置");
      document.querySelector(".location-box").classList.add("located");
    } catch (e) {
      location = undefined;
      document.querySelector("#location-status").textContent = e.message;
      locateButton.textContent = t("Try again", "重试");
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
    publish.textContent = t("Publishing…", "正在发布…");
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
      publish.innerHTML = `${t("Publish my poll", "发布投票")} ${icons.arrow}`;
    }
  };
}

async function votePage(id) {
  let poll = await api(`/api/polls/${id}`);
  document.title = `${poll.title} — ScaleTag`;
  main.innerHTML = `<section class="poll-layout"><div class="poll-main"><a class="back-link" href="/PostList">${t("← Back to PostList", "← 返回帖子列表")}</a>
    ${new URLSearchParams(location.search).has("created") ? `<div class="success-banner" role="status">${t("Your poll is live. Share its QR code to start the conversation.", "投票已发布。分享二维码，开始交流。")}</div>` : ""}
    <div class="poll-meta"><span id="poll-status" class="status-badge"></span><span>${t("Single choice", "单选")}</span><span id="time-left"></span></div><h1 class="poll-title">${escape(poll.title)}</h1><p class="byline">${t("Started by", "发起人：")} <strong>${escape(poll.signature)}</strong> <span>· ${date(poll.createdAt)}</span><span class="unverified">${t("Unverified signature", "署名未经验证")}</span></p>
    ${poll.description ? `<p class="poll-description">${escape(poll.description)}</p>` : ""}
    ${poll.images.length ? `<div class="external-images"><button class="button secondary small" id="load-images">${t(`Show ${poll.images.length} external image${poll.images.length > 1 ? "s" : ""}`, `显示 ${poll.images.length} 张外部图片`)}</button><p class="field-hint">${t("Images load from third-party hosts, which may receive your IP address.", "图片从第三方服务器加载，该服务可能接收你的 IP 地址。")}</p><div id="poll-images"></div></div>` : ""}
    <section class="ballot-card"><div class="ballot-heading"><h2>${t("Have your say.", "表达你的看法。")}</h2><span class="tiny-label">${t("PICK ONE", "选择一项")}</span></div><form id="vote-form"><fieldset id="vote-options"><legend class="sr-only">${t("Choose one option", "选择一个选项")}</legend>${poll.options.map((o) => `<label class="vote-option"><input type="radio" name="option" value="${o.id}" required><span>${escape(o.label)}</span><span class="option-check" aria-hidden="true"></span></label>`).join("")}</fieldset><p id="vote-message" class="vote-message" role="status"></p><p id="vote-error" class="form-error" role="alert" hidden></p><button class="button" id="cast-vote" type="submit">${t("Cast my vote", "提交投票")} ${icons.arrow}</button><p class="field-hint">${t("One vote per browser, as far as an anonymous cookie allows.", "通过匿名 Cookie 尽量限制每个浏览器投票一次。")}</p></form></section>
    <section class="results-section" aria-label="${t("Current results", "当前结果")}"><div class="results-heading"><h2>${t("The conversation so far", "当前结果")}</h2><span id="total-votes"></span></div><div id="results"></div><p class="field-hint" id="results-updated">${t("Results refresh every 15 seconds while this page is visible.", "页面可见时，每 15 秒刷新结果。")}</p></section>
    <section id="social" aria-label="${t("Poll likes", "投票点赞")}"></section></div><aside class="poll-sidebar"><section class="share-card"><span class="eyebrow">${t("PASS IT ON", "分享出去")}</span><h2>${t("A small code.", "一个小小的二维码。")}<br>${t("A bigger conversation.", "一场更广泛的交流。")}</h2><div class="qr-frame"><img src="/api/polls/${id}/qr.png" width="256" height="256" alt="${t("QR code linking to this poll", "指向此投票的二维码")}"></div><p>${t("Scan to vote. Save to share.", "扫码投票，保存后分享。")}</p><a href="/api/polls/${id}/qr.png?download=1" class="button" download="ScaleTag-${id}.png">${icons.download} ${t("Save QR image", "保存二维码")}</a><button class="button secondary" id="copy-link">${t("Copy poll link", "复制投票链接")}</button></section><section class="timeline-card"><div>${icons.clock}<span>${t("Voting closes", "投票截止时间")}<strong>${date(poll.endsAt)}</strong></span></div><div>${icons.shield}<span>${t("Removed from the website", "从网站移除")}<strong>${date(poll.deleteAt)}</strong></span></div><p>${t("Dates are shown in your local time.", "日期按你的本地时间显示。")}</p></section>${notice()}</aside></section>`;
  if (poll.images.length)
    document.querySelector("#load-images").onclick = (e) => {
      const target = document.querySelector("#poll-images");
      for (const [i, url] of poll.images.entries()) {
        const image = document.createElement("img");
        image.src = url;
        image.alt = t(`Poll illustration ${i + 1}`, `投票图片 ${i + 1}`);
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.onerror = () => {
          const p = document.createElement("p");
          p.className = "field-hint";
          p.textContent = t(`Image ${i + 1} is unavailable from its host.`, `图片 ${i + 1} 无法从来源加载。`);
          image.replaceWith(p);
        };
        target.append(image);
      }
      e.currentTarget.remove();
    };
  document.querySelector("#copy-link").onclick = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/vote/${id}`);
      toast(t("Poll link copied.", "投票链接已复制。"));
    } catch {
      toast(
        t("Could not copy automatically. Copy the link from your address bar.", "无法自动复制，请从地址栏复制链接。"),
      );
    }
  };
  function render() {
    const closed = poll.status === "closed";
    const badge = document.querySelector("#poll-status");
    badge.textContent = closed ? t("Voting closed", "投票已结束") : t("Open for votes", "投票进行中");
    badge.classList.toggle("closed", closed);
    document.querySelector("#time-left").textContent = remaining(
      poll.endsAt,
      poll.serverTime,
    );
    document.querySelector("#total-votes").textContent =
      t(`${count(poll.totalVotes)} ${poll.totalVotes === 1 ? "vote" : "votes"}`, `${count(poll.totalVotes)} 票`);
    document.querySelector("#results").innerHTML = poll.options
      .map(
        (o) =>
          `<div class="result-row"><div><span>${escape(o.label)}</span><strong>${percent(o.votes, poll.totalVotes)}% <small>${t(`${count(o.votes)} ${o.votes === 1 ? "vote" : "votes"}`, `${count(o.votes)} 票`)}</small></strong></div><progress value="${o.votes}" max="${poll.totalVotes || 1}" aria-label="${escape(o.label)}: ${percent(o.votes, poll.totalVotes)} percent"></progress></div>`,
      )
      .join("");
    document.querySelector("#vote-options").disabled = closed || poll.hasVoted;
    document.querySelector("#cast-vote").disabled = closed || poll.hasVoted;
    document.querySelector("#cast-vote").innerHTML = closed
      ? t("Voting has ended", "投票已结束")
      : poll.hasVoted
        ? t("Your vote is counted ✓", "你的投票已计入 ✓")
        : `${t("Cast my vote", "提交投票")} ${icons.arrow}`;
    document.querySelector("#vote-message").textContent = closed
      ? t("This poll has ended. You can still view the results and share its QR code until deletion.", "投票已结束。在删除之前，你仍可查看结果并分享二维码。")
      : poll.hasVoted
        ? t("Thanks for adding your voice. This browser has already voted.", "感谢参与，此浏览器已投票。")
        : t("Results are visible to everyone, before and after voting.", "投票前后所有人均可查看结果。");
    if (closed)
      document.querySelector("#results-updated").textContent =
        t("Final results. This poll is no longer accepting votes.", "最终结果。此投票不再接受投票。");
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
      toast(t("Your vote is in. Thank you!", "投票已提交，谢谢参与！"));
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
          t("Could not refresh results. We’ll try again shortly.", "无法刷新结果，稍后将自动重试。");
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
  document.title = t("PostList — ScaleTag", "帖子列表 — ScaleTag");
  document.querySelector('[data-nav="list"]').classList.add("active");
  main.innerHTML = `<section class="list-page"><div class="list-heading"><div><span class="eyebrow">${t("THE PUBLIC NOTICEBOARD", "公共公告栏")}</span><h1>${t("Every post", "每个帖子")}<br>${t("starts", "都有")} <em>${t("somewhere.", "起点。")}</em></h1><p>${t("Explore polls and local tasks, or find conversations closer to home.", "浏览投票和本地任务，寻找身边的交流。")}</p></div><a href="/create" class="button">${t("Create a post", "创建帖子")} ${icons.plus}</a></div><label class="content-filter" for="content-type">${t("Show", "显示")} <select id="content-type"><option value="all">${t("Polls &amp; tasks", "投票和任务")}</option><option value="poll">${t("Polls", "投票")}</option><option value="task">${t("Tasks", "任务")}</option></select></label><div class="view-switch" role="group" aria-label="${t("PostList view", "帖子列表视图")}"><button type="button" class="selected" data-view="list" aria-pressed="true">${t("List", "列表")}</button><button type="button" data-view="map" aria-pressed="false">${t("Map", "地图")}</button></div><div class="list-toolbar"><div class="filter-tabs" role="group" aria-label="${t("Post status", "帖子状态")}"><button class="selected" data-filter="all" aria-pressed="true">${t("All posts", "全部帖子")}</button><button data-filter="open" aria-pressed="false">${t("Open", "进行中")}</button><button data-filter="closed" aria-pressed="false">${t("Ended", "已结束")}</button></div><button class="near-button" id="nearby" aria-pressed="false">${icons.pin} ${t("Within 100 km", "100 公里内")} <span class="toggle" aria-hidden="true"></span></button></div><div class="list-caption"><span id="list-caption">${t("Newest first · Available for 30 days", "最新发布优先 · 保留 30 天")}</span><span id="list-count"></span></div><p class="location-privacy" id="location-privacy" hidden>${t("Your location is used only for this search and is not saved.", "你的位置仅用于本次搜索，不会保存。")}</p><p id="list-error" class="form-error" role="alert" hidden></p><section id="map-panel" class="map-panel" aria-label="${t("Post map", "帖子地图")}" hidden><div class="map-intro"><strong>${t("Posts on the map", "地图上的帖子")}</strong><p>${t("Approximate areas only. Loading this view connects to OpenFreeMap, which receives your IP address and the map areas you view. Post content stays on ScaleTag.", "仅显示大致区域。加载地图将连接 OpenFreeMap，其会接收你的 IP 地址和查看的地图区域。帖子内容保留在 ScaleTag。")}</p></div><p id="map-message" class="map-message" role="status">${t("Loading the map…", "正在加载地图…")}</p><div id="poll-map" class="poll-map" role="region" aria-label="${t("Interactive map of approximate post locations", "帖子大致位置的互动地图")}"></div><div class="map-legend"><span><i class="legend-dot"></i> ${t("Open", "进行中")}</span><span><i class="legend-dot ended"></i> ${t("Ended", "已结束")}</span><button class="text-link" id="map-fit" type="button">${t("Fit all markers ↗", "显示所有标记 ↗")}</button></div><p id="map-count" class="map-count" aria-live="polite"></p><p class="map-footnote">${t("Only posts published with map consent appear here. Older posts remain in List. Positions use a 0.01° grid, about 1 km north–south and narrower east–west.", "仅显示发布时同意上地图的帖子。较早的帖子仍可在列表中查看。位置按 0.01° 网格显示，南北约 1 公里，东西更窄。")}</p><details class="mapped-polls"><summary>${t("Browse mapped posts without the map", "不使用地图浏览地图帖子")}</summary><ul id="mapped-poll-links"></ul></details></section><div id="poll-list" class="poll-grid" aria-live="polite"></div><button id="load-more" class="button secondary load-more" hidden>${t("Load more posts", "加载更多帖子")}</button><p class="list-retention">${t("Posts leave the website after 30 days. Private daily backups are retained for up to 90 days after backup creation.", "帖子 30 天后从网站移除。每日私有备份自创建起最多保留 90 天。")}</p></section>`;
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
    document.querySelector("#map-count").textContent = t("Finding mapped posts…", "正在查找地图帖子…");
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
        ? t(`${count(data.polls.length)} of ${count(data.total)} matching mapped posts${data.total > data.polls.length ? " · Newest 1,000 only" : ""}`, `显示 ${count(data.polls.length)} / ${count(data.total)} 条符合条件的地图帖子${data.total > data.polls.length ? " · 仅显示最新 1,000 条" : ""}`)
        : t("No mapped posts match these filters. Try List to see all posts.", "没有符合条件的地图帖子，请使用列表查看全部帖子。");
      for (const p of data.polls) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `/${p.type === "task" ? "task" : "vote"}/${p.id}`;
        a.textContent = `${p.title} · ${p.type === "task" ? `${t("Task", "任务")} · ${stateLabel(p.taskState)}` : p.status === "open" ? t("Open", "进行中") : t("Ended", "已结束")}`;
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
        t("Mapped posts are unavailable. Try Map again or use List.", "无法加载地图帖子，请重试或使用列表。");
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
          ? t("Approximate areas · Available for 30 days", "大致区域 · 保留 30 天")
          : t("Newest first · Available for 30 days", "最新发布优先 · 保留 30 天");
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
      t("You’re offline. Reconnect to see current mapped posts.", "当前离线，请重新连接后查看最新地图帖子。");
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
      return `<a class="poll-list-card task-list-card" href="/task/${p.id}"><div class="card-top"><span class="status-badge">${t("Task", "任务")}</span><span class="status-badge ${isFinalState(p.taskState) ? "closed" : p.taskState === "in_progress" ? "in-progress" : ""}">${stateLabel(p.taskState)}</span><span>${shortDate(p.createdAt)}</span></div><h2>${escape(p.title)}</h2><p class="card-signature">${t("by", "发布者：")} ${escape(p.signature)}</p><div class="task-card-reward"><span>${t("Reward offered", "提供的报酬")}</span><strong>${escape(p.reward)}</strong></div><div class="card-bottom"><span>♡ ${t(`${count(p.totalLikes ?? 0)} likes · ${count(p.replyCount ?? 0)} replies`, `${count(p.totalLikes ?? 0)} 次赞 · ${count(p.replyCount ?? 0)} 条回复`)}</span>${icons.arrow}</div></a>`;
    return `<a class="poll-list-card" href="/vote/${p.id}"><div class="card-top"><span class="status-badge ${p.status === "closed" ? "closed" : ""}">${p.status === "closed" ? t("Ended", "已结束") : t("Open", "进行中")}</span><span>${shortDate(p.createdAt)}</span></div><h2>${escape(p.title)}</h2><p class="card-signature">${t("by", "发布者：")} ${escape(p.signature)}</p><div class="mini-results">${p.options
      .slice(0, 3)
      .map(
        (o) =>
          `<div><span>${escape(o.label)}</span><strong>${percent(o.votes, p.totalVotes)}%</strong><progress value="${o.votes}" max="${p.totalVotes || 1}" aria-label="${escape(o.label)}: ${percent(o.votes, p.totalVotes)} percent"></progress></div>`,
      )
      .join(
        "",
      )}${p.options.length > 3 ? `<small>+ ${p.options.length - 3} ${t("more options", "个其他选项")}</small>` : ""}</div><div class="card-bottom"><span>${t(`${count(p.totalVotes)} votes`, `${count(p.totalVotes)} 票`)} <span class="separator">·</span> ♡ ${t(`${count(p.totalLikes ?? 0)} likes`, `${count(p.totalLikes ?? 0)} 次赞`)} <span class="separator">·</span> ${remaining(p.endsAt, p.serverTime)}</span>${icons.arrow}</div></a>`;
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
        `<div class="list-empty" role="status">${t("Finding posts…", "正在查找帖子…")}</div>`;
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
        list.innerHTML = `<div class="list-empty"><span class="empty-symbol">${icons.pin}</span><h2>${location ? t("A little quiet around here.", "附近暂时比较安静。") : t("The first post could be yours.", "来发布第一条帖子吧。")}</h2><p>${location ? t("No matching posts within 100 km. Try all locations, or start a conversation nearby.", "100 公里内没有符合条件的帖子。可查看所有位置，或在附近发起话题。") : t("No posts match this filter yet. Share a poll or task with your neighbourhood.", "暂无符合条件的帖子。向邻里分享投票或任务吧。")}</p><a class="text-link" href="/create">${t("Create a post ↗", "创建帖子 ↗")}</a></div>`;
      document.querySelector("#list-count").textContent =
        t(`${count(loaded)} ${loaded === 1 ? "post" : "posts"} shown`, `显示 ${count(loaded)} 条帖子`);
      more.hidden = !cursor;
    } catch (e) {
      if (current !== request) return;
      const error = document.querySelector("#list-error");
      error.textContent = e.message;
      error.hidden = false;
      if (reset)
        list.innerHTML =
          `<div class="list-empty">${t("Could not load posts. Select a filter to try again.", "无法加载帖子，请选择筛选条件重试。")}</div>`;
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
  document.title = t("Privacy & retention — ScaleTag", "隐私与数据保留 — ScaleTag");
  main.innerHTML = t(`<article class="privacy-page"><a class="back-link" href="/">← Back to ScaleTag</a><span class="eyebrow">A SMALL DATA FOOTPRINT</span><h1>A few things<br>you should know.</h1><h2>No account. No fingerprint.</h2><p>We don’t ask voters for a name, email address, or account. A separate random, HttpOnly, Secure, SameSite cookie is used for each poll in production. Its hashed identifier prevents repeat votes from that browser and is removed from the active data store after voting closes. Private backup copies follow the retention policy below. We don’t use a cross-poll identifier or device fingerprint.</p><p>This is not identity verification or a guarantee of one vote per person. Clearing cookies, using private browsing, or switching browsers can allow another vote. Cookies must be enabled to vote.</p><h2>A place, not a trail.</h2><p>Creating a poll requires browser location permission. We store its latitude and longitude with the poll to support nearby discovery. Exact coordinates are not included in public responses. New polls can appear on the public map only with explicit map consent at creation. Their displayed position is rounded to a 0.01° grid (about 1 km north–south, narrower east–west). This is an approximate area, not an anonymity guarantee; locations already on grid points may be unchanged. Older polls without consent remain in the list only. Nearby filtering uses your current coordinates for that request only; they are not saved or added to a URL. Location supplied by a browser is not independently verified.</p><h2>Seven days to vote. Thirty days online.</h2><p>Voting starts at publication and closes exactly 168 hours later. Results remain visible until 30 days after publication. At that point, the poll, its results, location, and related identifiers are removed from the active website. The original link and QR code stop opening the poll. Save what you need before the public link expires.</p><p>Private daily backups include poll JSON data, including location and any deduplication hashes present at backup time. Each archive is retained for up to 90 days after creation for administrator-managed disaster recovery. This means a backup copy may remain for up to about 120 days after a poll was published. Backups are not publicly accessible and there is no user-facing recovery feature. Expired polls are not republished by restoring their original records.</p><p>Expired polls become inaccessible at the deadline. Active files are removed by a background cleanup, normally within 30 seconds while the service is running, and at startup. Archive expiry is enforced by the daily backup job; downtime or storage failures can delay physical cleanup. The application does not keep request access logs. External screenshots, downloaded QR codes, and copies made by other people cannot be recalled.</p><h2>Installed app and offline resources.</h2><p>You can install ScaleTag as a web app. Your browser may keep public scripts, styles, icons and a generic offline page. Poll pages, results, QR responses, location searches and vote requests are not saved in the offline cache. Votes are never queued for later submission. Installing the app does not verify your identity or change the anonymous-cookie voting limits.</p><h2>Maps load only when you choose Map.</h2><p>PostList starts in List view. Choosing Map loads a third-party OpenFreeMap basemap. OpenFreeMap receives your IP address and the map areas requested; poll titles, votes and signatures are not sent to it. ScaleTag serves the MapLibre library itself and does not use a map account or API key. Required map attribution remains visible. Map responses, marker searches and third-party map resources are not saved in ScaleTag’s offline cache. Your browser may cache basemap resources according to their provider’s headers. No offline maps are downloaded by ScaleTag. If the map is unavailable, use List.</p><h2>Tasks, likes and replies.</h2><p>Tasks contain a title, description and reward offer, with required GPS and the same approximate-map disclosure as polls. Tasks and their replies leave the website 30 days after the task is published; a late reply does not extend that deadline. Private daily archives follow the 90-day retention rule above.</p><p>Tasks and polls support likes. A separate anonymous cookie for each post limits this browser to one like; it expires when the post leaves the website. Its SHA-256 hash and task reply-rate timestamps remain in the private record until removal and follow the archive policy. It is separate from the voting cookie and does not identify you across posts. Clearing cookies can bypass this limit.</p><p><strong>A reply’s name and message are public</strong> and unverified: anyone can read them, and reply counts are shown in PostList. Never put a phone number, email address or other contact details in them; replies whose name or message look like they contain contact details are rejected, but this check cannot catch everything.</p><p><strong>A reply’s phone number and email address are private.</strong> On tasks with a private management link, a reply needs a phone number or email address, or both. They are never shown on the public task page or returned by public task, list, map, social, like or reply responses. They are shown only on the task’s private management page, to anyone holding that management link — normally the person who published the task, but also anyone they share it with or who otherwise obtains it. ScaleTag administrators with server access and the private daily backups (90-day policy) can also contain them. Contacts are never sent to the map provider. Replies stored before this change, including their contacts, follow the same rule: name and message stay public; contacts are now visible only through the management link.</p><p>Tasks published before management links existed have no link, so nobody can retrieve private contacts for them. ScaleTag therefore prevents new replies on these legacy tasks. Contacts already stored on such older tasks are no longer shown to anyone through the website and are removed with the task.</p><p>There is no private inbox, account-based editing or user recovery. Copies made by others cannot be recalled. ScaleTag displays reward offers; it does not process payments, hold funds, accept bookings or manage transactions.</p><p>Publishing a task opens a private management link. Anyone holding it can mark the task Open, In progress, Completed or Closed, and can see reply phone numbers and email addresses. The secret part of the link stays after “#”, so browsers do not send it in page requests or Referer headers; it is sent only in the body of a same-site request. Responses containing contacts are marked not to be stored by browsers or caches, and are never saved in the offline cache. ScaleTag stores just a SHA-256 hash of the link’s secret, and private archives contain that hash under the same 90-day policy. The link cannot be recovered or reissued, and it may stay in your browser history. Completed and Closed are final and stop new replies; existing replies stay visible. Changing status never extends or shortens the 30-day removal deadline. Tasks published before status tracking show as Open and cannot be managed.</p><h2>Images stay with their hosts.</h2><p>We only store external HTTPS image URLs. Images load when you choose to show them. Their hosts may receive your IP address and may change or remove an image. ScaleTag does not proxy or store those images.</p><h2>Infrastructure still carries requests.</h2><p>The application does not store IP addresses for voting or keep request access logs. Requests pass through Cloudflare, which processes connection information according to its own policies. Server security logs may also exist; an anonymous poll does not mean every network layer is anonymous.</p><h2>Signatures are just signatures.</h2><p>Creators choose any name. A signature is not verified and should not be treated as proof of someone’s identity. Polls appear publicly in PostList. Only publish information you are comfortable sharing.</p><a class="text-link" href="https://github.com/ChrisXHLeung/ScaleTag" target="_blank" rel="noopener noreferrer">Read the source on GitHub ↗</a></article>`, `<article class="privacy-page"><a class="back-link" href="/">← 返回 ScaleTag</a><span class="eyebrow">尽量减少数据留存</span><h1>您应该了解<br>这些事情。</h1><h2>无需账户，不使用设备指纹。</h2><p>我们不要求投票者提供姓名、电子邮箱或账户。在正式环境中，每个投票使用独立的随机 Cookie，并设置 HttpOnly、Secure 和 SameSite 属性。其经哈希处理的标识符用于防止该浏览器重复投票，并在投票结束后从活动数据存储中删除。私有备份遵循以下保留政策。我们不使用跨投票标识符或设备指纹。</p><p>这不是身份验证，也不能保证每人只能投一票。清除 Cookie、使用隐私浏览模式或更换浏览器可能允许再次投票。投票时必须启用 Cookie。</p><h2>记录地点，而非行踪。</h2><p>创建投票需要浏览器的位置权限。我们将纬度和经度与投票一同保存，以支持附近内容发现。公开响应不包含精确坐标。新投票只有在创建时明确同意显示在地图上，才会出现在公开地图中。显示的位置会按 0.01° 网格取整（南北方向约 1 公里，东西方向更窄）。这只是大致区域，不能保证匿名；原本位于网格点上的位置可能不会变化。未获得同意的旧投票只出现在列表中。附近筛选仅在本次请求中使用您当前的坐标；坐标不会被保存或加入网址。浏览器提供的位置未经独立验证。</p><h2>投票持续七天，在线保留三十天。</h2><p>投票从发布时开始，恰好在 168 小时后结束。结果在发布后 30 天内可见。届时，投票、结果、位置和相关标识符将从活动网站中删除。原始链接和二维码将无法再打开该投票。请在公开链接失效前保存您需要的内容。</p><p>每日私有备份包含投票的 JSON 数据，包括位置和备份时存在的去重哈希。每份归档自创建起最多保留 90 天，供管理员在灾难恢复时使用。这意味着备份副本可能在投票发布后保留约 120 天。备份不向公众开放，也没有面向用户的恢复功能。恢复原始记录不会重新发布已过期投票。</p><p>投票在到期时即不可访问。活动文件由后台清理程序删除，服务运行时通常在 30 秒内完成，服务启动时也会执行清理。每日备份任务负责执行归档过期清理；停机或存储故障可能导致物理清理延迟。应用程序不保留请求访问日志。外部截图、下载的二维码以及他人制作的副本无法撤回。</p><h2>已安装的应用和离线资源。</h2><p>您可以将 ScaleTag 安装为网页应用。浏览器可能保留公开脚本、样式、图标和通用离线页面。投票页面、结果、二维码响应、位置搜索和投票请求不会保存在离线缓存中。投票绝不会排队等待稍后提交。安装应用不会验证您的身份，也不会改变匿名 Cookie 的投票限制。</p><h2>只有选择地图时才会加载地图。</h2><p>PostList 默认以列表视图打开。选择地图时会加载第三方 OpenFreeMap 底图。OpenFreeMap 会收到您的 IP 地址及请求的地图区域；投票标题、投票内容和署名不会发送给它。ScaleTag 自行提供 MapLibre 库，不使用地图账户或 API 密钥。所需的地图归属信息仍会显示。地图响应、标记搜索和第三方地图资源不会保存在 ScaleTag 的离线缓存中。浏览器可能按照供应商的响应头缓存底图资源。ScaleTag 不会下载离线地图。如果地图不可用，请使用列表。</p><h2>任务、点赞和回复。</h2><p>任务包含标题、描述和酬谢内容，必须提供 GPS 位置，并适用与投票相同的地图大致位置披露。任务及其回复在任务发布 30 天后离开网站；较晚的回复不会延长期限。每日私有归档遵循上述 90 天保留规则。</p><p>任务和投票均支持点赞。每篇帖子使用单独的匿名 Cookie，限制该浏览器只能点赞一次；帖子离开网站时 Cookie 过期。其 SHA-256 哈希和任务回复频率时间戳会保留在私有记录中直至删除，并遵循归档政策。它与投票 Cookie 分开，不会跨帖子识别您。清除 Cookie 可以绕过此限制。</p><p><strong>回复的姓名和消息是公开的</strong>，且未经验证：任何人都可以阅读，回复数量也会显示在 PostList 中。请勿在其中填写电话号码、电子邮箱或其他联系方式；姓名或消息看似包含联系方式的回复会被拒绝，但此检查无法发现所有情况。</p><p><strong>回复的电话号码和电子邮箱是私密的。</strong>对于有私有管理链接的任务，回复须提供电话号码或电子邮箱，或同时提供两者。它们不会显示在公开任务页面，也不会通过公开任务、列表、地图、互动、点赞或回复接口返回。它们仅显示在任务的私有管理页面上，可供持有该管理链接的人查看——通常是任务发布者，但也包括他们分享链接的对象或以其他方式获得链接的人。具有服务器访问权限的 ScaleTag 管理员也可访问这些信息，私有每日备份（90 天政策）也可能包含它们。联系方式绝不会发送给地图供应商。此变更之前存储的回复及联系方式遵循相同规则：姓名和消息仍公开，联系方式现在只能通过管理链接查看。</p><p>在管理链接功能推出之前发布的任务没有管理链接，因此没有人能通过管理链接获取其私密联系方式。ScaleTag 因此禁止对这些旧任务添加新回复。此类旧任务已存储的联系方式不再通过网站向任何人显示，并会随任务一起删除。</p><p>本网站没有私信收件箱、基于账户的编辑或用户恢复功能。他人制作的副本无法撤回。ScaleTag 显示酬谢内容；它不处理付款、保管资金、接受预约或管理交易。</p><p>发布任务后会打开私有管理链接。持有该链接的任何人都可以将任务标记为“开放”“进行中”“已完成”或“已关闭”，并能查看回复中的电话号码和电子邮箱。链接的密钥部分位于“#”之后，因此浏览器不会在页面请求或 Referer 请求头中发送它；它只会在同站请求的请求体中发送。包含联系方式的响应会被标记为不允许浏览器或缓存存储，也绝不会保存在离线缓存中。ScaleTag 仅存储链接密钥的 SHA-256 哈希，私有归档也包含该哈希并遵循相同的 90 天政策。链接无法恢复或重新签发，也可能留在浏览器历史记录中。“已完成”和“已关闭”是最终状态，会停止接收新回复；已有回复仍然可见。更改状态不会延长或缩短 30 天删除期限。状态跟踪功能推出之前发布的任务显示为“开放”，且无法管理。</p><h2>图片保留在其托管方。</h2><p>我们只保存外部 HTTPS 图片网址。只有当您选择显示图片时才会加载。图片托管方可能收到您的 IP 地址，也可能更改或删除图片。ScaleTag 不代理或存储这些图片。</p><h2>请求仍会经过基础设施。</h2><p>应用程序不会为投票存储 IP 地址，也不保留请求访问日志。请求会经过 Cloudflare，由其按照自身政策处理连接信息。服务器也可能存在安全日志；匿名投票不意味着每一网络层都匿名。</p><h2>署名只是署名。</h2><p>创建者可以选择任意姓名。署名未经验证，不应视为某人身份的证明。投票会公开出现在 PostList 中。请只发布您愿意分享的信息。</p><a class="text-link" href="https://github.com/ChrisXHLeung/ScaleTag" target="_blank" rel="noopener noreferrer">在 GitHub 阅读源代码 ↗</a></article>`);
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
  else if (/^\/task\/[a-f0-9]{24}\/manage$/.test(route))
    await taskPage(route.split("/")[2], { manage: true });
  else showError(new Error("This link does not point to an available post."));
} catch (e) {
  showError(e);
}
