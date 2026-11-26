import { localizedPath } from "/locale.js";
import { renderHelp, helpTopic } from "/help.js";
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
  bindPostVisibility,
  postVisibilityFields,
  notice,
  DATA_IMAGE_PATTERN,
  photoFields,
  bindPhotoInput,
  uploadedPhotosHtml,
  bindManagementCopy,
  bindLinkCopy,
  linkCopyFallback,
  managementDetails,
  managementPasswordForm,
  mountNativeShare,
  mountPollOptionOrder,
  syncPollOptionOrder,
  setActiveNav,
  showFormError,
} from "/common.js";
import { mountOwnerEdit } from "/owner-edit.js";
import { mountSocial } from "/social.js";
import { mountPosterActions, mountResultExports } from "/poster.js";
import { createTask, taskPage, stateLabel, isFinalState } from "/tasks.js";
import { createSale, salePage, saleStateLabel } from "/sales.js";
import { pickupWindowText } from "/pickup.js";
import { bindTextDraft, mountSavedPost, renderSavedPosts } from "/local-posts.js";
function showError(error) {
  document.title = t("Post unavailable — ScaleTag", "帖子不可用 — ScaleTag");
  main.innerHTML = `<section class="empty-page"><span class="eyebrow">${t("NOT HERE ANYMORE", "此页面已不可用")}</span><h1>${t("This page is unavailable.", "此页面不可用。")}</h1><p>${escape(error.message)}</p><p>${t("This link no longer provides access. Private backup copies may remain for disaster recovery.", "此链接已无法访问。私有备份可能保留用于灾难恢复。")}</p><a class="button" href="/PostList">${t("Explore PostList", "浏览帖子列表")} ${icons.arrow}</a></section>`;
}

function home() {
  document.title = t("ScaleTag — Small questions. Local voices.", "ScaleTag — 身边大小事，听听大家怎么说。");
  main.innerHTML = `<div class="home-page">
  <section class="home-hero" aria-labelledby="home-title">
    <div class="home-hero-copy"><p class="home-kicker">${t("Small questions. Local voices.", "身边大小事，听听大家怎么说。")}</p><h1 id="home-title">${t("Local questions.", "关心身边事，")}<br><span>${t("Real conversations.", "一起聊一聊。")}</span></h1><p class="home-lede">${t("Create a poll, post a local task, give away an item, or send a one-time encrypted secret. Share a code and connect with people nearby. No account needed.", "发起投票、发布任务、发布闲置赠予，或通过 Secrex 发送阅后即焚加密信息。分享二维码，就能和附近的人交流。无需注册。")}</p><div class="home-actions"><a class="button home-primary" href="/create">${t("Create a poll", "创建投票")} ${icons.arrow}</a><a class="button secondary home-secondary" href="/create/task">${t("Create a task", "创建任务")} ${icons.arrow}</a><a class="button secondary home-secondary" href="/create/sale">${t("Give away", "发布闲置赠予")} ${icons.arrow}</a><a class="button secondary home-secondary" href="/secrex">${t("Secrex", "Secrex 阅后即焚")} ${icons.arrow}</a></div><a class="home-explore" href="/PostList">${t("Explore PostList", "浏览帖子列表")} ${icons.arrow}</a></div>
    <div class="home-map"><img src="/neighborhood.png" alt="" fetchpriority="high"><span class="home-map-caption">${t("A question can start right here.", "好问题，从身边开始。")}</span></div>
  </section>
  <section class="home-facts" aria-label="${t("How ScaleTag works", "ScaleTag 的使用方式")}"><div>${icons.pin}<span><strong>${t("Rooted in a place", "从身边开始")}</strong><small>${t("Posts start with a real location.", "发布时选择位置，让附近的人找到你。")}</small></span></div><div>${icons.clock}<span><strong>${t("Time to have your say", "说出你的想法")}</strong><small>${t("Choose how long your poll stays open.", "自行选择投票开放时长。")}</small></span></div><div>${icons.shield}<span><strong>${t("No account needed", "无需账号")}</strong><small>${t("Join in without signing up.", "无需注册即可参与。")}</small></span></div></section>
  <section class="home-story" aria-labelledby="home-story-title"><div class="home-story-image" aria-hidden="true"></div><div class="home-story-copy"><p class="home-kicker">${t("On the map, in real life", "从线上走到身边")}</p><h2 id="home-story-title">${t("A neighborhood idea.", "邻里的一个想法，")}<br><span>${t("A real conversation.", "可以聊出更多可能。")}</span></h2><p>${t("From small questions to local tasks, ScaleTag gives ideas a place to start.", "无论是征求意见，还是寻找帮手，都可以从这里开始。")}</p><div class="home-story-links"><a href="/create"><strong>${t("Create a poll", "创建投票")}</strong><span>${t("Ask a question and hear what people think.", "提出问题，听听大家的想法。")}</span>${icons.arrow}</a><a href="/create/task"><strong>${t("Create a task", "创建任务")}</strong><span>${t("Post a task and an offer for help.", "说说需要什么帮助，以及你能提供什么酬谢。")}</span>${icons.arrow}</a><a href="/secrex"><strong>${t("Secrex", "Secrex 阅后即焚")}</strong><span>${t("Send a browser-encrypted secret that self-destructs after one reading.", "浏览器端加密传递私密信息，单次阅读后即刻销毁。")}</span>${icons.arrow}</a><a href="/PostList"><strong>${t("Explore PostList", "浏览帖子列表")}</strong><span>${t("Find polls, tasks and free giveaways in the list or map.", "在列表或地图中查找投票、任务和闲置赠予。")}</span>${icons.arrow}</a></div></div></section>
  <section class="home-install" aria-labelledby="home-install-title"><div class="home-install-copy"><p class="home-kicker">${t("Take ScaleTag with you", "把 ScaleTag 带在身边")}</p><h2 id="home-install-title">${t("Install the app.", "添加到手机，")}<br>${t("Explore locally.", "随时看看身边的新鲜事。")}</h2><p>${t("Scan with your phone for installation steps made for your device.", "用手机扫码，查看适合你设备的安装方法。")}</p><a class="home-install-link" href="/install">${t("Open the installation guide", "打开安装指南")} ${icons.arrow}</a></div><a href="/install" class="home-install-qr"><img src="/install/qr.png" alt="${t("QR code for the ScaleTag installation guide", "ScaleTag 安装指南二维码")}" width="140" height="140"></a></section>
  </div>`;
}

function installPage() {
  document.title = t("Install ScaleTag — ScaleTag", "安装 ScaleTag — ScaleTag");
  const shareIcon =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3"/></svg>';
  main.innerHTML = `<section class="install-page"><a class="back-link" href="/">${t("← Back to home", "← 返回首页")}</a><div class="install-page-heading"><img src="/icons/icon-192.png" width="72" height="72" alt=""><span class="eyebrow">${t("KEEP A LITTLE CURIOSITY CLOSE", "随时发现身边事")}</span><h1>${t("Install ScaleTag.", "安装 ScaleTag。")}</h1><p>${t("Keep ScaleTag on your home screen for your next conversation.", "将 ScaleTag 添加到主屏幕，方便下次交流。")}</p></div>
    <div class="installed-notice success-banner" id="install-page-done" role="status" hidden>${t("ScaleTag is installed. Open it from your home screen.", "ScaleTag 已安装，可从主屏幕打开。")}</div>
    <button type="button" class="button install-page-native" id="install-page-native" hidden>${t("Install ScaleTag", "安装 ScaleTag")}</button>
    <div class="device-picker" role="group" aria-label="${t("Your device", "选择设备")}"><button type="button" data-install-platform="ios" aria-pressed="false">${t("iPhone / iPad", "iPhone / iPad")}</button><button type="button" data-install-platform="android" aria-pressed="false">${t("Android / desktop", "安卓 / 电脑")}</button></div>
    <section class="install-steps" data-platform-panel="ios" aria-labelledby="ios-install-title"><h2 id="ios-install-title">${t("Add it from Safari.", "在 Safari 中添加")}</h2><ol><li><span class="step-number">1</span><div><h3>${t("Tap Share", "点击分享")} ${shareIcon}</h3><p>${t("Find the square with an upward arrow in Safari’s toolbar or menu.", "在 Safari 工具栏或菜单中找到带向上箭头的方框。")}</p></div></li><li><span class="step-number">2</span><div><h3>${t("Add to Home Screen", "添加到主屏幕")}</h3><p>${t("Choose this option from the share menu. Scroll down if needed.", "在分享菜单中选择此项；如有需要请向下滚动。")}</p></div></li><li><span class="step-number">3</span><div><h3>${t("Confirm Add", "确认添加")}</h3><p>${t("Keep Open as Web App enabled if shown, then tap Add. The ScaleTag icon is ready on your home screen.", "如果出现“作为网页应用打开”，请保持启用，然后点击“添加”。ScaleTag 图标将出现在主屏幕。")}</p></div></li></ol><p class="install-browser-hint">${t("Scanned inside another app? Open this page in Safari to use Add to Home Screen.", "在其他应用中扫码？请在 Safari 中打开此页面以添加到主屏幕。")}</p></section>
    <section class="install-steps" data-platform-panel="android" aria-labelledby="android-install-title" hidden><h2 id="android-install-title">${t("Install from your browser.", "通过浏览器安装")}</h2><ol><li><span class="step-number">1</span><div><h3>${t("Tap Install ScaleTag", "点击安装 ScaleTag")}</h3><p>${t("When your browser offers installation, use the Install ScaleTag button above.", "浏览器提供安装选项时，请使用上方的安装按钮。")}</p></div></li><li><span class="step-number">2</span><div><h3>${t("Confirm installation", "确认安装")}</h3><p>${t("Approve the browser’s installation prompt. ScaleTag is added as an app with its own icon.", "确认浏览器的安装提示，ScaleTag 将作为应用添加并显示图标。")}</p></div></li><li><span class="step-number">3</span><div><h3>${t("Open from your app icon", "通过应用图标打开")}</h3><p>${t("Use ScaleTag from your home screen or app launcher.", "从主屏幕或应用启动器打开 ScaleTag。")}</p></div></li></ol><p class="install-browser-hint" id="android-install-fallback">${t("No install button? In Chrome or Edge, open the browser menu and choose Install app or Add to Home Screen. Some in-app browsers do not support installation.", "没有安装按钮？在 Chrome 或 Edge 中打开浏览器菜单，选择安装应用或添加到主屏幕。部分应用内浏览器不支持安装。")}</p></section>
    <p class="install-page-note" data-install-message>${t("Publishing, voting and current results still need an internet connection. No account is required.", "发布、投票和查看最新结果仍需联网。无需账号。")}</p><a class="button secondary" href="/">${t("Continue to ScaleTag", "进入 ScaleTag")} ${icons.arrow}</a></section>`;
}

function createPoll() {
  document.title = t("Create a poll — ScaleTag", "创建投票 — ScaleTag");
  setActiveNav("create");
  main.innerHTML = `<section class="create-section"><aside class="section-intro"><a class="back-link" href="/">${t("← Back to home", "← 返回首页")}</a><span class="eyebrow">${t("START SOMETHING", "发起投票")}</span><h1>${t("What’s on", "有什么事")}<br>${t("your mind?", "想听听大家的意见？")}</h1><p>${t("A neighborhood idea. A small decision.", "邻里的想法、待定的小事，")}<br>${t("Something you’ve always wondered.", "或是一直想问的问题，都可以拿来聊聊。")}</p><div class="intro-note"><span class="tiny-label">${t("KEEP IT SIMPLE", "简单就好")}</span><p>${t("One question, a few options,", "提出一个问题，给出几个选项，")}<br>${t("and room for a different perspective.", "听听不同的声音。")}</p></div><div class="rules"><p>${icons.pin} ${t("Public posts require location.", "公开帖需要位置信息。")}</p><p>${icons.clock} ${t("Voting stays open for up to 7 days.", "投票最多开放 7 天。")}</p><p>${icons.shield} ${t("Your signature is not verified.", "署名未经验证。")}</p></div></aside>
  <form id="create-form" class="form-card"><div class="post-kind-switch" aria-label="${t("Post type", "帖子类型")}"><a href="/create" aria-current="page">${t("Poll", "投票")}</a><a href="/create/task">${t("Task", "任务")}</a><a href="/create/sale">${t("Free Giveaways", "闲置赠予")}</a><a href="/secrex">${t("Secrex", "Secrex 阅后即焚")}</a></div>
    <div class="form-heading"><h2>${t("Your new poll", "创建投票")}</h2><span class="pill">${t("SINGLE CHOICE", "单选")}</span></div>
    <label for="title">${t("The question", "问题")} <span class="required">*</span></label><input id="title" name="title" maxlength="140" placeholder="${t("What should we make happen next?", "接下来做什么好？")}" required><div class="field-hint"><span>${t("Keep it clear and open to everyone.", "把问题说清楚，让大家都能参与。")}</span><span id="title-count">0 / 140</span></div>
    <label for="description">${t("A little context", "补充说明")} <span class="optional">${t("optional", "可选")}</span></label><textarea id="description" name="description" maxlength="4000" rows="4" placeholder="${t("Tell people a bit more about your question\u2026", "补充一些背景，让大家更了解这个问题…")}"></textarea>
    ${photoFields("poll", t("Photos (optional)", "投票照片（选填）"))}
    <fieldset class="options-fieldset"><legend>${t("The options", "选项")} <span class="required">*</span></legend><p class="field-hint">${t("Add 2–12 choices. Each person selects one.", "添加 2 至 12 个选项，每人可选择一项。")}</p><div id="option-inputs"></div><button class="add-option" type="button" id="add-option">${icons.plus} ${t("Add an option", "添加选项")}</button></fieldset>
    <label for="voting-hours">${t("Voting duration", "投票时长")}</label><select id="voting-hours" name="votingHours"><option value="1">${t("1 hour", "1 小时")}</option><option value="6">${t("6 hours", "6 小时")}</option><option value="24">${t("1 day", "1 天")}</option><option value="72">${t("3 days", "3 天")}</option><option value="168" selected>${t("7 days", "7 天")}</option></select>
    <label for="results-visibility">${t("Show results", "公布结果")}</label><select id="results-visibility" name="resultsVisibility"><option value="live">${t("As votes come in", "实时公布")}</option><option value="after_close">${t("After voting closes", "截止后公布")}</option></select>
    <label for="signature">${t("Your signature", "署名")} <span class="required">*</span></label><input id="signature" name="signature" maxlength="60" placeholder="${t("A name, a nickname, or a little mystery", "姓名、昵称或其他署名")}" required><p class="field-hint">${t("Pick any name. No account or identity verification.", "可以使用姓名或昵称，无需注册或验证身份。")}</p>
    ${postVisibilityFields()}<fieldset class="post-location-fields"><legend class="sr-only">${t("Post location", "帖子位置")}</legend><div class="location-box"><div><strong>${icons.pin} ${t("Give your poll a place", "添加投票位置")}</strong><p id="location-status" aria-live="polite">${t("Your location helps people discover nearby polls.", "添加位置后，附近的人更容易找到这个投票。")}</p></div><button class="button secondary small" type="button" id="locate">${t("Enable location", "启用定位")}</button></div><p class="field-hint">${t("We store the poll’s coordinates, not your movement. Exact coordinates are not shown publicly. The map shows a rounded area on a 0.01° grid (about 1 km north–south, narrower east–west).", "我们存储投票的坐标，不记录你的移动轨迹，也不公开精确坐标。地图按 0.01° 网格显示大致区域（南北约 1 公里，东西更窄）。")}</p>
    <label class="checkbox-row"><input type="checkbox" id="map-consent" required><span>${t("I agree to show my poll’s approximate area publicly on the map. This does not guarantee anonymity.", "我同意在地图上公开显示投票的大致区域。这不能保证匿名。")}</span></label></fieldset>${notice()}<label class="checkbox-row"><input type="checkbox" id="retention" required><span>${t("I understand that my poll leaves the website after 30 days and that private daily backups are retained for up to 90 days after each backup is created.", "我了解投票会在发布 30 天后从网站移除，私有每日备份从创建之日起最多保留 90 天。")}</span></label>
    <p id="form-error" class="form-error" role="alert" hidden></p><p class="field-hint" role="note">${t("Disclaimer: Posts are supplied by users and are not verified by ScaleTag. Publishers are responsible for their content; users should exercise their own judgment. ScaleTag does not participate in transactions.", "免责声明：信息由用户发布，ScaleTag 不对内容进行核实。发布者对其内容负责，使用者应自行判断；ScaleTag 不参与交易。")}</p><button class="button publish-button" type="submit" id="publish">${t("Publish my poll", "发布投票")} ${icons.arrow}</button><p class="publish-note">${t("Starts immediately · Removed in 30 days", "立即开始 · 30 天后移除")}</p>
  </form></section>`;
  let location;
  let locatedAt = 0;
  const form = document.querySelector("#create-form");
  const photos = bindPhotoInput(main, "poll");
  const inputs = document.querySelector("#option-inputs");
  function renumber() {
    inputs.querySelectorAll(".option-input").forEach((row, i) => {
      row.querySelector(".option-number").textContent = String(i + 1).padStart(
        2,
        "0",
      );
      row.querySelector("input").setAttribute("aria-label", t(`Option ${i + 1}`, `选项 ${i + 1}`));
      row.querySelector("input").placeholder = t(`Option ${i + 1}`, `选项 ${i + 1}`);
      syncPollOptionOrder(row, i, inputs.children.length);
      row.querySelector(".remove-option").disabled = inputs.children.length <= 2;
      row
        .querySelector(".remove-option")
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
      `<span class="option-number"></span><input type="text" maxlength="120" required><button type="button" class="remove-option" title="${t("Remove option", "删除选项")}">×</button>`;
    row.querySelector("button").onclick = () => {
      row.remove();
      renumber();
      draft.save();
    };
    mountPollOptionOrder(row, () => {
      renumber();
      draft.save();
    });
    inputs.append(row);
    renumber();
    if (focus) row.querySelector("input").focus();
  }
  addOption();
  addOption();
  const choices = () => [...inputs.querySelectorAll("input")].map((el) => el.value);
  const draft = bindTextDraft(form, "poll", ["#title", "#description", "#signature", "#voting-hours", "#results-visibility", "#post-visibility"], {
    read: choices,
    contains: (target) => inputs.contains(target),
    restore(values) {
      const labels = Array.isArray(values) && values.length >= 2 ? values.slice(0, 12) : ["", ""];
      inputs.replaceChildren();
      for (const label of labels) {
        addOption();
        if (typeof label === "string") inputs.lastElementChild.querySelector("input").value = label.slice(0, 120);
      }
    },
  });
  const visibility = bindPostVisibility(form);
  document.querySelector("#add-option").onclick = () => {
    addOption(true);
    draft.save();
  };
  const titleField = document.querySelector("#title");
  function countTitle() {
    document.querySelector("#title-count").textContent =
      `${titleField.value.length} / 140`;
  }
  titleField.addEventListener("input", countTitle);
  titleField.addEventListener("draftreset", countTitle);
  countTitle();
  const locateButton = document.querySelector("#locate");
  locateButton.onclick = async () => {
    locateButton.disabled = true;
    locateButton.textContent = t("Locating…", "正在定位…");
    try {
      location = await locate();
      locatedAt = Date.now();
      document.querySelector("#location-status").textContent =
        t("Location ready. You’re all set to publish.", "位置已获取，可以发布了。");
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
      const images = await photos.readImages();
      if (!visibility.unlisted && (!location || Date.now() - locatedAt > 5 * 60000)) {
        location = await locate();
        locatedAt = Date.now();
      }
      const payload = {
        title: form.elements.namedItem("title").value,
        description: form.elements.namedItem("description").value,
        signature: form.elements.namedItem("signature").value,
        options: choices(),
        votingHours: Number(form.elements.votingHours.value),
        resultsVisibility: form.elements.resultsVisibility.value,
        images,
        ...visibility.payload(location),
        retentionAccepted: document.querySelector("#retention").checked,
      };
      const submittedDraft = await draft.snapshot();
      const poll = await api("/api/polls", payload);
      await draft.published(submittedDraft);
      const address = localizedPath(`/vote/${poll.id}?created=1`);
      if (!poll.manageKey) {
        window.location.assign(address);
        return;
      }
      const { manageKey, ...published } = poll;
      history.replaceState(null, "", address);
      await votePage(poll.id, { ownerKey: manageKey, published });
    } catch (e) {
      showFormError(error, e);
      publish.disabled = false;
      publish.innerHTML = `${t("Publish my poll", "发布投票")} ${icons.arrow}`;
    }
  };
}

function mountPollManagementDetails(host, poll, key) {
  const path = `/vote/${poll.id}/manage`;
  const url = localizedPath(path);
  host.insertAdjacentHTML("afterbegin", managementDetails(url));
  bindManagementCopy(url, key);
  mountSavedPost(host, { path, title: poll.title });
}

function bindPollLinkCopy(control, id) {
  bindLinkCopy(control, () => `${location.origin}/vote/${id}`, t("Poll link copied.", "投票链接已复制。"));
}

async function pollManagePage(id, key) {
  if (!key) return managementPasswordForm((password) => pollManagePage(id, password));
  const poll = await api(`/api/polls/${id}/manage`, { key });
  renderPollManager(poll, key);
}

function renderPollManager(poll, key, message = "", openEditor = false) {
  const id = poll.id;
  const endpoint = `/api/polls/${id}`;
  document.title = `${t("Manage: ", "管理：")}${poll.title} — ScaleTag`;
  main.innerHTML = `<section class="empty-page"><section class="manage-card" id="poll-owner-controls">
    <h1>${t("Manage this poll", "管理此投票")}</h1><h2>${escape(poll.title)}</h2>
    <p>${poll.status === "closed" ? t("Voting closed", "投票已结束") : t("Open for votes", "投票进行中")}</p>
    <div><a class="button secondary small" href="/vote/${id}">${t("View poll", "查看投票")}</a>
    <button type="button" class="button secondary small" id="copy-owner-public-link">${t("Copy public link", "复制公开链接")}</button>${linkCopyFallback("owner-public-link")}</div>
    ${poll.status === "open" ? `<button type="button" class="button secondary small" data-poll-state="closed">${t("End voting now", "立即结束投票")}</button>` : ""}
    <button type="button" class="button secondary small" data-poll-state="withdrawn">${t("Take down", "下架帖子")}</button>
    <p class="form-error" role="alert" hidden></p>
    <p class="field-hint" role="status">${escape(message)}</p>
    </section></section>`;
  const host = main.querySelector("#poll-owner-controls");
  const management = document.createElement("div");
  host.querySelector("h2").after(management);
  mountPollManagementDetails(management, poll, key);
  bindPollLinkCopy(host.querySelector("#copy-owner-public-link"), id);
  const editor = mountOwnerEdit(host, poll, `${endpoint}/edit`, key, (updated) => {
    renderPollManager(updated, key, t("Changes saved.", "已保存修改。"), true);
  });
  editor.open = openEditor;
  const stateButtons = [...host.querySelectorAll("[data-poll-state]")];
  for (const button of stateButtons) {
    button.onclick = async () => {
      const state = button.dataset.pollState;
      if (!window.confirm(state === "closed"
        ? t("End voting now and publish the results?", "立即结束投票并公布结果？")
        : t("Take this poll down? The shared link and QR code will stop working.", "下架这项投票？共享链接和二维码将失效。"))) return;
      stateButtons.forEach(control => { control.disabled = true; });
      const error = host.querySelector(".form-error");
      error.hidden = true;
      try {
        const updated = await api(`${endpoint}/state`, { key, state });
        if (updated.withdrawn) {
          main.innerHTML = `<section class="empty-page"><h1>${t("This poll has been taken down.", "此投票已下架。")}</h1>
            <a class="button" href="/PostList">${t("Back to PostList", "返回帖子列表")}</a></section>`;
        } else renderPollManager(updated, key);
      } catch (e) {
        showFormError(error, e);
      } finally {
        stateButtons.forEach(control => { control.disabled = false; });
      }
    };
  }
}

function pollBallotOptions(options) {
  return `<legend class="sr-only">${t("Choose one option", "选择一个选项")}</legend>` +
    options.map(option => `<label class="vote-option">
      <input type="radio" name="option" value="${option.id}" required>
      <span>${escape(option.label)}</span><span class="option-check" aria-hidden="true"></span>
    </label>`).join("");
}

async function votePage(id, { ownerKey, published } = {}) {
  setActiveNav(null);
  let poll = published ?? await api(`/api/polls/${id}`);
  let sessionReady = !published;
  let ballotMarkup = pollBallotOptions(poll.options);
  document.title = `${poll.title} — ScaleTag`;
  const uploadedImages = (poll.images ?? []).filter((src) =>
    DATA_IMAGE_PATTERN.test(src),
  );
  const externalImages = (poll.images ?? []).filter((src) =>
    /^https:\/\//i.test(src),
  );
  main.innerHTML = `<section class="poll-layout"><div class="poll-main"><a class="back-link" href="/PostList">${t("← Back to PostList", "← 返回帖子列表")}</a>
    ${new URLSearchParams(location.search).has("created") ? `<div class="success-banner" role="status">${t("Your poll is live. Share its QR code to start the conversation.", "投票已发布，分享二维码邀请大家参与吧。")}</div>` : ""}
    <div class="poll-meta"><span id="poll-status" class="status-badge"></span><span>${t("Single choice", "单选")}</span><span id="time-left"></span></div><h1 class="poll-title">${escape(poll.title)}</h1><p class="byline">${t("Started by", "发起人：")} <strong>${escape(poll.signature)}</strong> <span>· ${date(poll.createdAt)}</span></p>
    ${poll.description ? `<p class="poll-description">${escape(poll.description)}</p>` : ""}
    ${uploadedPhotosHtml(uploadedImages, "Poll photo", "投票照片")}
    ${externalImages.length ? `<div class="external-images"><button class="button secondary small" id="load-images">${t(`Show ${externalImages.length} external image${externalImages.length > 1 ? "s" : ""}`, `显示 ${externalImages.length} 张外部图片`)}</button><p class="field-hint">${t("Images load from third-party hosts, which may receive your IP address.", "图片从第三方服务器加载，该服务可能接收你的 IP 地址。")}</p><div id="poll-images"></div></div>` : ""}
    <section class="ballot-card"><div class="ballot-heading"><h2>${t("Have your say.", "投下你的一票")}</h2><span class="tiny-label">${t("PICK ONE", "选择一项")}</span></div><form id="vote-form"><fieldset id="vote-options">${ballotMarkup}</fieldset><p id="vote-message" class="vote-message" role="status"></p><p id="vote-error" class="form-error" role="alert" hidden></p><button class="button" id="cast-vote" type="submit">${t("Cast my vote", "提交投票")} ${icons.arrow}</button><p class="field-hint">${t("One vote per browser, as far as an anonymous cookie allows.", "我们使用匿名 Cookie 尽量限制每个浏览器只能投一票。")}</p></form></section>
    <section class="results-section" aria-label="${t("Current results", "当前结果")}"><div class="results-heading"><h2>${t("The conversation so far", "当前结果")}</h2><span id="total-votes" aria-live="polite"></span></div><div id="results"></div><p class="field-hint" id="results-updated">${t("Results refresh every 15 seconds while this page is visible.", "页面可见时，每 15 秒刷新结果。")}</p></section>
    <section id="social" aria-label="${t("Poll likes", "投票点赞")}"></section></div><aside class="poll-sidebar"><section class="share-card"><span class="eyebrow">${t("PASS IT ON", "分享出去")}</span><h2>${t("A small code.<br>A bigger conversation.", "分享二维码，<br>让更多人参与。") }</h2><div class="qr-frame"><img src="/api/polls/${id}/qr.png" width="256" height="256" alt="${t("QR code linking to this poll", "投票二维码")}"></div><p>${t("Scan to vote. Save to share.", "扫码投票，保存后分享。")}</p><a href="/api/polls/${id}/qr.png?download=1" class="button" download="ScaleTag-${id}.png">${icons.download} ${t("Save QR image", "保存二维码")}</a><button class="button secondary" id="copy-link" type="button">${t("Copy poll link", "复制投票链接")}</button>${linkCopyFallback("public-poll-link")}</section><section class="timeline-card"><div>${icons.clock}<span>${t("Voting closes", "投票截止时间")}<strong>${date(poll.endsAt)}</strong></span></div><div>${icons.shield}<span>${t("Removed from the website", "从网站移除")}<strong>${date(poll.deleteAt)}</strong></span></div><p>${t("Dates are shown in your local time.", "日期按你的本地时间显示。")}</p></section>${notice()}</aside></section>`;
  if (ownerKey) {
    const owner = document.createElement("section");
    owner.className = "manage-card";
    owner.innerHTML = `<h2>${t("Manage this poll", "管理此投票")}</h2>
      <div></div>
      <a class="button secondary small" href="/vote/${id}/manage">${t("Open poll management", "打开投票管理")}</a>`;
    main.querySelector(".results-section").after(owner);
    mountPollManagementDetails(owner.querySelector("div"), poll, ownerKey);
  }
  if (externalImages.length)
    document.querySelector("#load-images").onclick = (e) => {
      const target = document.querySelector("#poll-images");
      for (const [i, url] of externalImages.entries()) {
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
  bindPollLinkCopy(document.querySelector("#copy-link"), id);
  mountNativeShare(document.querySelector("#copy-link"), {
    title: poll.title,
    url: `${location.origin}/vote/${id}`,
  });
  mountPosterActions(main.querySelector(".share-card"), {
    type: "poll",
    id,
    title: poll.title,
    description: poll.description,
    signature: poll.signature,
    createdAt: poll.createdAt,
    endsAt: poll.endsAt,
    deleteAt: poll.deleteAt,
    options: poll.options,
    images: uploadedImages,
    qrUrl: `/api/polls/${id}/qr.png`,
    publicUrl: `${location.origin}/vote/${id}`,
  });
  mountSavedPost(main.querySelector(".share-card"), { path: `/vote/${id}`, title: () => poll.title });
  const updateResultExports = mountResultExports(
    main.querySelector(".results-section"), id, () => api(`/api/polls/${id}`),
  );
  let lastResultsHtml;
  function render() {
    updateResultExports(poll);
    const title = main.querySelector(".poll-title");
    if (title.textContent !== poll.title) {
      title.textContent = poll.title;
      document.title = `${poll.title} — ScaleTag`;
    }
    const closed = poll.status === "closed";
    const badge = document.querySelector("#poll-status");
    badge.textContent = closed ? t("Voting closed", "投票已结束") : t("Open for votes", "投票进行中");
    badge.classList.toggle("closed", closed);
    document.querySelector("#time-left").textContent = remaining(
      poll.endsAt,
      poll.serverTime,
    );
    // Only write when changed so unchanged 15s polls don't re-announce the
    // aria-live total or wipe the user's text selection in the results.
    const totalVotes = document.querySelector("#total-votes");
    const totalText =
      poll.resultsHidden ? "" : t(`${count(poll.totalVotes)} ${poll.totalVotes === 1 ? "vote" : "votes"}`, `${count(poll.totalVotes)} 票`);
    if (totalVotes.textContent !== totalText) totalVotes.textContent = totalText;
    const results = document.querySelector("#results");
    const resultsHtml = poll.resultsHidden ? "" : poll.options
      .map(
        (o) => {
          const pct = percent(o.votes, poll.totalVotes);
          const votesText = t(`${count(o.votes)} ${o.votes === 1 ? "vote" : "votes"}`, `${count(o.votes)} 票`);
          return `<div class="result-row"><div><span>${escape(o.label)}</span><strong>${pct}% <small>${votesText}</small></strong></div><meter min="0" value="${o.votes}" max="${poll.totalVotes || 1}" aria-label="${escape(o.label)}" aria-valuetext="${escape(`${pct}% (${votesText})`)}"></meter></div>`;
        },
      )
      .join("");
    // Compare against the last markup we wrote (not the browser-serialized
    // innerHTML, which may normalise entities/attributes differently).
    if (resultsHtml !== lastResultsHtml) results.innerHTML = lastResultsHtml = resultsHtml;
    const options = document.querySelector("#vote-options");
    const updatedBallot = pollBallotOptions(poll.options);
    if (ballotMarkup !== updatedBallot) options.innerHTML = ballotMarkup = updatedBallot;
    options.disabled = !sessionReady || closed || poll.hasVoted;
    document.querySelector("#cast-vote").disabled = !sessionReady || closed || poll.hasVoted;
    document.querySelector("#cast-vote").innerHTML = closed
      ? t("Voting has ended", "投票已结束")
      : poll.hasVoted
        ? t("Your vote is counted ✓", "你的投票已计入 ✓")
        : `${t("Cast my vote", "提交投票")} ${icons.arrow}`;
    const voteMessage = document.querySelector("#vote-message");
    const voteMessageText = closed
      ? t("This poll has ended. You can still view the results and share its QR code until deletion.", "投票已结束。在投票被移除前，你仍可查看结果和分享二维码。")
      : poll.hasVoted
        ? t("Thanks for adding your voice. This browser has already voted.", "这个浏览器已经投过票，感谢参与。")
        : poll.resultsHidden
          ? t("Results will appear when voting closes.", "投票截止后公布结果。")
          : t("Results are visible to everyone, before and after voting.", "投票前后所有人均可查看结果。");
    if (voteMessage.textContent !== voteMessageText) voteMessage.textContent = voteMessageText;
    // Always reset so a transient "Could not refresh" error clears on the next
    // successful refresh.
    document.querySelector("#results-updated").textContent = closed
      ? t("Final results. This poll is no longer accepting votes.", "投票已结束，以下是最终结果。")
      : poll.resultsHidden
        ? t("Results will appear when voting closes.", "投票截止后公布结果。")
        : t("Results refresh every 15 seconds while this page is visible.", "页面可见时，每 15 秒刷新结果。");
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
      showFormError(error, e);
      try {
        poll = await api(`/api/polls/${id}`);
      } catch {}
    } finally {
      submitting = false;
      render();
    }
  };
  const social = mountSocial(id, false);
  let fetching = false;
  let timer;
  let stopped = false;
  function stopPolling() {
    clearInterval(timer);
    timer = undefined;
  }
  function startPolling() {
    if (stopped || timer) return;
    timer = setInterval(refresh, 15000);
  }
  function onPageHide() {
    stopPolling();
  }
  function onPageShow(event) {
    if (event.persisted && !stopped) {
      startPolling();
      void refresh();
    }
  }
  async function refresh() {
    if (stopped || document.hidden || submitting || fetching) return;
    fetching = true;
    try {
      poll = await api(`/api/polls/${id}`);
      sessionReady = true;
      render();
    } catch (e) {
      if (e.status === 404) {
        stopped = true;
        stopPolling();
        document.removeEventListener("visibilitychange", refresh);
        window.removeEventListener("online", refresh);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
        social?.stop?.();
        showError(e);
      } else
        document.querySelector("#results-updated").textContent =
          t("Could not refresh results. We’ll try again shortly.", "无法刷新结果，稍后将自动重试。");
    } finally {
      fetching = false;
    }
  }
  startPolling();
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("online", refresh);
  if (published) void refresh();
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
}

function postList() {
  document.title = t("PostList — ScaleTag", "帖子列表 — ScaleTag");
  setActiveNav("list");
  const nav = window.navigation;
  const incoming = new URLSearchParams(window.location.search);
  const filterKeys = ["type", "status", "pickup"];
  markDiscoveryEntry();
  const searchForm = `<form class="post-search" id="post-search" role="search">
    <label for="post-query">${t("Search posts", "搜索帖子")}
      <input id="post-query" type="search" autocomplete="off" maxlength="240" placeholder="${t("Title or description", "标题或描述")}">
    </label>
    <button class="button secondary small" type="submit">${t("Search", "搜索")}</button>
    <button class="text-link" id="clear-post-search" type="button" hidden>${t("Clear search", "清除搜索")}</button>
  </form>`;
  const nearbyPicker = `<div class="nearby-controls">
    <label class="content-filter" for="nearby-radius">${t("Search radius", "搜索范围")} <select id="nearby-radius">
      ${[2, 10, 50, 100].map(radius => `<option value="${radius}"${radius === 100 ? " selected" : ""}>${t(`${radius} km`, `${radius} 公里`)}</option>`).join("")}
    </select></label>
    <label class="content-filter" for="nearby-sort">${t("Sort posts", "帖子排序")} <select id="nearby-sort">
      <option value="newest">${t("Newest first", "最新发布优先")}</option>
      <option value="nearest" disabled>${t("Nearest first", "距离最近优先")}</option>
    </select></label>
    <button id="choose-map-area" class="button secondary small" type="button">${t("Choose area on map", "在地图上选区")}</button>
  </div>`;
  const clearFiltersLabel = t("Clear all filters", "清除所有筛选");
  main.innerHTML = `<section class="list-page"><div class="list-heading"><div><span class="eyebrow">${t("THE PUBLIC NOTICEBOARD", "发现身边事")}</span><h1>${t("Every post<br>starts <em>somewhere.</em>", "看看附近<br><em>大家都在聊什么</em>")}</h1><p>${t("Explore polls, local tasks and free giveaways nearby.", "浏览附近的投票、任务和闲置赠予，看看有什么新鲜事。")}</p></div><a href="/create" class="button">${t("Create a post", "创建帖子")} ${icons.plus}</a></div>${searchForm}<label class="content-filter" for="content-type">${t("Show", "显示")} <select id="content-type"><option value="all">${t("All post types", "全部类型")}</option><option value="poll">${t("Polls", "投票")}</option><option value="task">${t("Tasks", "任务")}</option><option value="sale">${t("Free Giveaways", "闲置赠予")}</option></select></label><div class="content-filter" id="pickup-time-filter" hidden><label for="pickup-time">${t("Pickup time", "领取时段")}</label><select id="pickup-time"><option value="">${t("Any pickup time", "不限时段")}</option><option value="now">${t("Pickup now", "现在可领取")}</option><option value="upcoming">${t("Starts in the next 24 hours", "未来 24 小时开始")}</option></select></div><div class="view-switch" role="group" aria-label="${t("PostList view", "帖子列表视图")}"><button type="button" class="selected" data-view="list" aria-pressed="true">${t("List", "列表")}</button><button type="button" data-view="map" aria-pressed="false">${t("Map", "地图")}</button></div><div class="list-toolbar"><div class="filter-tabs" role="group" aria-label="${t("Post status", "帖子状态")}"><button class="selected" data-filter="all" aria-pressed="true">${t("All posts", "全部帖子")}</button><button data-filter="open" aria-pressed="false">${t("Open", "进行中")}</button><button data-filter="closed" aria-pressed="false">${t("Ended", "已结束")}</button></div><button class="near-button" id="nearby" aria-pressed="false">${icons.pin} <span id="nearby-label">${t("Within 100 km", "100 公里内")}</span> <span class="toggle" aria-hidden="true"></span></button></div>${nearbyPicker}<div class="list-caption"><span id="list-caption">${t("Newest first · Availability varies by post type", "最新发布优先 · 有效期因帖子类型而异")}</span><span id="list-count"></span></div><p class="location-privacy" id="location-privacy" hidden>${t("Your location is used only for this search and is not saved.", "你的位置仅用于本次搜索，不会保存。")}</p><p id="list-error" class="form-error" role="alert" hidden></p><section id="map-panel" class="map-panel" aria-label="${t("Post map", "帖子地图")}" hidden><div class="map-intro"><strong>${t("Posts on the map", "地图上的帖子")}</strong><p>${t("Approximate areas only. Loading this view connects to OpenFreeMap, which receives your IP address and the map areas you view. Post content stays on ScaleTag.", "地图只显示大致区域。打开地图时会连接 OpenFreeMap，该服务会收到你的 IP 地址和查看的地图区域；帖子内容仍保留在 ScaleTag。")}</p></div><div class="nearby-controls"><button id="search-map-center" class="button secondary small" type="button">${t("Search this area", "搜索此区域")}</button><span>${t("Search near the center of this map.", "以地图中心为起点搜索。")}</span></div><p id="map-message" class="map-message" role="status">${t("Loading the map…", "正在加载地图…")}</p><div id="poll-map" class="poll-map" role="region" aria-label="${t("Interactive map of approximate post locations", "帖子大致位置的互动地图")}"></div><div class="map-legend"><span><i class="legend-dot"></i> ${t("Open", "进行中")}</span><span><i class="legend-dot ended"></i> ${t("Ended", "已结束")}</span><button class="text-link" id="map-fit" type="button">${t("Fit all markers ↗", "显示所有标记 ↗")}</button></div><p id="map-count" class="map-count" aria-live="polite" tabindex="-1"></p><button id="clear-map-filters" class="button secondary small" type="button" hidden>${clearFiltersLabel}</button><p class="map-footnote">${t("Only posts published with map consent appear here. Older posts remain in List. Positions use a 0.01° grid, about 1 km north–south and narrower east–west.", "仅显示发布时同意上地图的帖子。较早的帖子仍可在列表中查看。位置按 0.01° 网格显示，南北约 1 公里，东西更窄。")}</p><details class="mapped-polls"><summary>${t("Browse mapped posts without the map", "不用地图，直接浏览已标记的帖子")}</summary><ul id="mapped-poll-links"></ul></details></section><div id="poll-list" class="poll-grid" aria-live="polite"></div><button id="load-more" class="button secondary load-more" hidden>${t("Load more posts", "加载更多帖子")}</button><p class="list-retention">${t("Polls and tasks leave the website after 30 days; giveaways after 72 hours. Private daily backups are retained for up to 90 days after backup creation.", "投票和任务在 30 天后从网站移除；闲置赠予在 72 小时后移除。每日私有备份自创建起最多保留 90 天。")}</p></section>`;
  let status = "all",
    location,
    query = "",
    radiusKm = 100,
    sort = "newest",
    cursor,
    loaded = 0,
    request = 0,
    listReturnRequest,
    locating = false,
    locationRequest = 0,
    mode = "list",
    contentType = "all",
    mapView,
    mapLoading,
    mapGeneration = 0,
    mapRequest = 0,
    mapNeedsFit = false,
    mapTimer,
    listHoldTimer,
    listPickupTimer,
    listPickupDeadline = Infinity,
    suspended = false;
  const nearbyButton = document.querySelector("#nearby");
  const nearbyLabel = document.querySelector("#nearby-label");
  const nearbyToggle = nearbyButton.querySelector(".toggle");
  const radiusSelect = document.querySelector("#nearby-radius");
  const sortSelect = document.querySelector("#nearby-sort");
  const chooseArea = document.querySelector("#choose-map-area");
  const searchMap = document.querySelector("#search-map-center");
  const mapClear = document.querySelector("#clear-map-filters");
  const mapCount = document.querySelector("#map-count");
  const typeSelect = document.querySelector("#content-type");
  const list = document.querySelector("#poll-list");
  const pickupTime = document.querySelector("#pickup-time");
  const pickupFilter = document.querySelector("#pickup-time-filter");
  const statusButtons = [...document.querySelectorAll("[data-filter]")];
  const share = document.createElement("div");
  share.hidden = true;
  share.innerHTML = `<div class="local-post-controls">
    <button type="button" class="button secondary small" aria-describedby="share-filters-hint">${t("Copy public filter link", "复制公开筛选链接")}</button>
    ${linkCopyFallback("public-filter-link")}
  </div><p class="field-hint" id="share-filters-hint">${t("The link includes only post type, status and pickup time.", "链接仅包含帖子类型、状态和领取时段。")}</p>`;
  document.querySelector("#list-error").before(share);
  const copyFilters = share.querySelector("button");
  const filterLinkInput = share.querySelector("input");
  bindLinkCopy(copyFilters, shareableFilterLink, t("Link copied.", "链接已复制。"));
  const nearbyOptions = () => location ? { location, radiusKm, sort } : {};
  const pickupOption = () => pickupTime.value ? { pickup: pickupTime.value } : {};
  const hasFilters = () => Boolean(query || contentType !== "all" || status !== "all" || location);

  function pickupDeadline(post, pickup) {
    if (pickup === "upcoming") return post.pickupWindow?.startsAt;
    if (pickup === "now") return post.pickupWindow?.endsAt;
    return post.type === "sale" ? post.endsAt : post.deleteAt;
  }

  function syncPickupFilter() {
    pickupFilter.hidden = contentType !== "sale" || status === "closed";
    if (pickupFilter.hidden) pickupTime.value = "";
  }

  function markDiscoveryEntry() {
    if (!nav?.currentEntry || typeof nav.updateCurrentEntry !== "function") return;
    try {
      // The site's referrer policy can hide URLs from other history entries.
      const state = nav.currentEntry.getState();
      if (state?.scaleTagPostList !== true) nav.updateCurrentEntry({ state: { ...state, scaleTagPostList: true } });
    } catch {
      // Detail pages still have a regular link to PostList.
    }
  }

  function replaceDiscoveryHistory(state, url) {
    try {
      history.replaceState(state, "", url);
      markDiscoveryEntry();
    } catch {
      // Browsers can limit history writes. Browsing still works without restoration.
    }
  }

  function publicFilterParameters() {
    const parameters = new URLSearchParams();
    if (contentType !== "all") parameters.set("type", contentType);
    if (status !== "all") parameters.set("status", status);
    if (pickupTime.value) parameters.set("pickup", pickupTime.value);
    return parameters;
  }

  function shareableFilterLink() {
    const url = new URL("/PostList", window.location.origin);
    url.search = publicFilterParameters().toString();
    return url.href;
  }

  function rememberDiscovery() {
    const existing = history.state;
    const previous = existing?.scaleTagPostList;
    const pickup = pickupOption();
    const parameters = publicFilterParameters();
    share.hidden = !parameters.toString();
    if (filterLinkInput.value !== shareableFilterLink()) filterLinkInput.parentElement.hidden = true;
    const url = new URL(window.location.href);
    const previousSearch = url.search;
    if (filterKeys.some(key => url.searchParams.has(key))) {
      for (const key of filterKeys) {
        if (parameters.has(key)) url.searchParams.set(key, parameters.get(key));
        else url.searchParams.delete(key);
      }
    }
    const changedLink = url.search !== previousSearch;
    if (!changedLink && previous?.mode === mode && previous.type === contentType && previous.status === status && previous.pickup === pickup.pickup) return;
    replaceDiscoveryHistory({ ...existing, scaleTagPostList: { mode, type: contentType, status, ...pickup } }, changedLink ? url : undefined);
  }

  function takeListPosition() {
    const { scaleTagReturnToPost: position, ...state } = history.state ?? {};
    if (position) replaceDiscoveryHistory(state);
    return position;
  }

  list.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a.poll-list-card");
    if (!link || link.target || link.origin !== window.location.origin) return;
    if (query || location) {
      takeListPosition();
      return;
    }
    const index = Array.prototype.indexOf.call(list.children, link);
    replaceDiscoveryHistory({ ...history.state, scaleTagReturnToPost: { path: link.pathname, index } });
  });

  function updateListCaption() {
    document.querySelector("#list-caption").textContent = mode === "map"
      ? t("Approximate areas · Availability varies by post type", "大致区域 · 有效期因帖子类型而异")
      : sort === "nearest"
        ? t("Nearest first · Approximate distance", "距离最近优先 · 距离为估算值")
        : t("Newest first · Availability varies by post type", "最新发布优先 · 有效期因帖子类型而异");
  }

  function updateNearbyControl() {
    nearbyLabel.textContent = locating ? t("Cancel nearby search", "取消附近搜索")
      : t(`Within ${radiusKm} km`, `${radiusKm} 公里内`);
    nearbyToggle.hidden = locating;
    if (locating) nearbyButton.removeAttribute("aria-pressed");
    else nearbyButton.setAttribute("aria-pressed", String(Boolean(location)));
  }

  function setNearbyLocation(next) {
    ++locationRequest;
    locating = false;
    location = next;
    sort = location ? "nearest" : "newest";
    sortSelect.options[1].disabled = !location;
    sortSelect.value = sort;
    nearbyButton.classList.toggle("enabled", Boolean(location));
    updateNearbyControl();
    document.querySelector("#location-privacy").hidden = !location;
    updateListCaption();
  }
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
        searchMap.disabled = false;
        return view;
      })
      .catch((error) => {
        if (generation === mapGeneration) mapLoading = undefined;
        throw error;
      });
    return mapLoading;
  }
  function disposeMap() {
    ++mapGeneration;
    mapView?.destroy();
    mapView = undefined;
    mapLoading = undefined;
    searchMap.disabled = true;
    document.querySelector("#poll-map").replaceChildren();
  }
  function showMapClear(show) {
    if (!show && document.activeElement === mapClear) mapCount.focus({ preventScroll: true });
    mapClear.hidden = !show;
  }

  async function loadMap(fit = true, { background = false } = {}) {
    clearTimeout(mapTimer);
    if (suspended) return;
    mapNeedsFit = fit;
    const current = ++mapRequest;
    const error = document.querySelector("#list-error");
    error.hidden = true;
    if (!background || mapClear.hidden) {
      showMapClear(false);
      mapCount.textContent = t("Finding mapped posts…", "正在查找地图帖子…");
    }
    if (!background) {
      mapView?.setData([]);
      document.querySelector("#mapped-poll-links").replaceChildren();
    }
    const started = Date.now();
    try {
      const data = await api("/api/map/search", {
        status,
        type: contentType,
        query,
        ...nearbyOptions(),
        ...pickupOption(),
      });
      if (current !== mapRequest || mode !== "map") return;
      const view = await getMap();
      if (!view || current !== mapRequest || mode !== "map") return;
      data.polls = data.polls.filter(
        (p) => pickupDeadline(p, pickupTime.value) > data.serverTime + Date.now() - started,
      );
      view.setData(data.polls, fit);
      mapNeedsFit = false;
      view.resize();
      mapCount.textContent = data.total
        ? t(`${count(data.polls.length)} of ${count(data.total)} matching mapped posts`, `显示 ${count(data.polls.length)} / ${count(data.total)} 条符合条件的地图帖子`) + (data.total > 1000 ? ` · ${t("First 1,000 results", "前 1,000 条结果")}` : "")
        : t("No mapped posts match these filters. Try List to see all posts.", "没有符合条件的地图帖子，请使用列表查看全部帖子。");
      showMapClear(!data.total && hasFilters());
      const mappedLinks = document.querySelector("#mapped-poll-links");
      const focusedLink = background && mappedLinks.contains(document.activeElement) ? document.activeElement.href : null;
      mappedLinks.replaceChildren();
      for (const p of data.polls) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `/${p.type === "sale" ? "sale" : p.type === "task" ? "task" : "vote"}/${p.id}`;
        a.textContent = `${p.title} · ${p.type === "sale" ? `${t("Free Giveaways", "闲置赠予")} · ${saleStateLabel(p.saleState)}` : p.type === "task" ? `${t("Task", "任务")} · ${stateLabel(p.taskState)}` : p.status === "open" ? t("Open", "进行中") : t("Ended", "已结束")}`;
        if (p.type === "sale" && p.pickupWindow) a.append(` · ${pickupWindowText(p.pickupWindow)}`);
        li.append(a);
        mappedLinks.append(li);
      }
      if (focusedLink) {
        const link = [...mappedLinks.querySelectorAll("a")].find(item => item.href === focusedLink);
        (link ?? (pickupTime.value ? pickupTime : mapCount)).focus({ preventScroll: true });
      }
      const boundary = data.polls.reduce(
        (time, p) =>
          Math.min(
            time,
            p.deleteAt,
            ...(p.endsAt > data.serverTime ? [p.endsAt] : []),
            ...(p.reservedUntil > data.serverTime ? [p.reservedUntil] : []),
          ),
        data.serverTime + Math.min(30000, data.refreshAfterMs ?? Infinity),
      );
      mapTimer = setTimeout(
        () => loadMap(false, { background: true }),
        Math.max(100, boundary - data.serverTime - (Date.now() - started)),
      );
    } catch (e) {
      if (current !== mapRequest || mode !== "map") return;
      mapView?.setData([]);
      mapCount.textContent =
        t("Mapped posts are unavailable. Try Map again or use List.", "无法加载地图帖子，请重试或使用列表。");
      showMapClear(false);
      error.textContent = e.message;
      error.hidden = false;
    }
  }
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => {
      const previousMode = mode;
      mode = button.dataset.view;
      rememberDiscovery();
      request++;
      mapRequest++;
      clearTimeout(mapTimer);
      clearTimeout(listPickupTimer);
      document.querySelectorAll("[data-view]").forEach((b) => {
        b.classList.toggle("selected", b === button);
        b.setAttribute("aria-pressed", String(b === button));
      });
      document.querySelector("#map-panel").hidden = mode !== "map";
      document.querySelector("#poll-list").hidden = mode === "map";
      document.querySelector("#load-more").hidden = true;
      document.querySelector("#list-count").hidden = mode === "map";
      chooseArea.hidden = mode === "map";
      updateListCaption();
      if (mode === "list" || previousMode === "map") disposeMap();
      load();
    };
  });
  searchMap.disabled = true;
  chooseArea.onclick = () => {
    document.querySelector('[data-view="map"]').click();
  };
  searchMap.onclick = () => {
    setNearbyLocation(mapView.searchCenter());
    loadMap(false);
  };
  document.querySelector("#map-fit").onclick = () => loadMap();
  window.addEventListener("pagehide", (event) => {
    suspended = true;
    ++mapRequest;
    clearTimeout(mapTimer);
    clearTimeout(listHoldTimer);
    clearTimeout(listPickupTimer);
    // A cached page keeps the same canvas, camera and selected filters.
    if (!event.persisted) disposeMap();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    suspended = false;
    takeListPosition();
    if (mode === "map") {
      if (!document.hidden) loadMap(!mapView || mapNeedsFit, { background: true });
    } else if (pickupTime.value) load(true, true);
    else refreshHoldBadges(document.querySelector("#poll-list"));
  });
  window.addEventListener("offline", () => {
    if (mode !== "map") return;
    ++mapRequest;
    clearTimeout(mapTimer);
    mapView?.setData([]);
    document.querySelector("#mapped-poll-links").replaceChildren();
    mapCount.textContent =
      t("You’re offline. Reconnect to see current mapped posts.", "当前离线，请重新连接后查看最新地图帖子。");
    showMapClear(false);
  });
  window.addEventListener("online", () => {
    if (mode === "map") loadMap(false, { background: true });
    else if (pickupTime.value) load(true, true);
  });
  document.addEventListener("visibilitychange", () => {
    if (mode !== "map") {
      clearTimeout(listPickupTimer);
      if (!document.hidden && pickupTime.value) load(true, true);
      return;
    }
    if (document.hidden) {
      ++mapRequest;
      clearTimeout(mapTimer);
      mapView?.setData([]);
      document.querySelector("#mapped-poll-links").replaceChildren();
    } else loadMap(!mapView || mapNeedsFit, { background: true });
  });
  typeSelect.onchange = (event) => {
    contentType = event.target.value;
    syncPickupFilter();
    rememberDiscovery();
    load();
  };
  pickupTime.onchange = () => {
    rememberDiscovery();
    load();
  };
  const search = document.querySelector("#post-search");
  const searchInput = document.querySelector("#post-query");
  const clearSearch = document.querySelector("#clear-post-search");
  function clearFilters() {
    query = searchInput.value = "";
    clearSearch.hidden = true;
    contentType = typeSelect.value = "all";
    setStatus("all");
    radiusSelect.value = "100";
    radiusKm = 100;
    setNearbyLocation(undefined);
    rememberDiscovery();
    if (mode === "map") mapCount.focus({ preventScroll: true });
    else searchInput.focus();
    load();
  }
  mapClear.onclick = clearFilters;
  search.onsubmit = (event) => {
    event.preventDefault();
    query = searchInput.value.trim();
    clearSearch.hidden = !query;
    load();
  };
  clearSearch.onclick = () => {
    searchInput.value = "";
    searchInput.focus();
    search.requestSubmit();
  };
  function card(p) {
    if (p.type === "sale") {
      const hold = p.saleState === "reserved"
        ? `data-hold-deadline="${Date.now() + p.reservedUntil - p.serverTime}"` : "";
      return `<a class="poll-list-card sale-list-card" href="/sale/${p.id}"><div class="card-top"><span class="status-badge">${t("Free Giveaways", "闲置赠予")}</span><span class="status-badge ${hold ? "in-progress" : ""}" ${hold}>${saleStateLabel(p.saleState)}</span><span>${shortDate(p.createdAt)}</span></div><h2>${escape(p.title)}</h2><p class="card-signature">${t("by", "发布者：")} ${escape(p.signature)}</p><div class="card-bottom"><span>${p.pickupWindow ? pickupWindowText(p.pickupWindow) : t("Free · Available for 72 hours", "免费领取 · 发布后保留 72 小时")}</span>${icons.arrow}</div></a>`;
    }
    if (p.type === "task")
      return `<a class="poll-list-card task-list-card" href="/task/${p.id}"><div class="card-top"><span class="status-badge">${t("Task", "任务")}</span><span class="status-badge ${isFinalState(p.taskState) ? "closed" : p.taskState === "in_progress" ? "in-progress" : ""}">${stateLabel(p.taskState)}</span><span>${shortDate(p.createdAt)}</span></div><h2>${escape(p.title)}</h2><p class="card-signature">${t("by", "发布者：")} ${escape(p.signature)}</p><div class="task-card-reward"><span>${t("Reward offered", "提供的酬谢")}</span><strong>${escape(p.reward)}</strong></div><div class="card-bottom"><span>♡ ${t(`${count(p.totalLikes ?? 0)} likes · ${count(p.replyCount ?? 0)} replies`, `${count(p.totalLikes ?? 0)} 次赞 · ${count(p.replyCount ?? 0)} 条回复`)}</span>${icons.arrow}</div></a>`;
    return `<a class="poll-list-card" href="/vote/${p.id}"><div class="card-top"><span class="status-badge ${p.status === "closed" ? "closed" : ""}">${p.status === "closed" ? t("Ended", "已结束") : t("Open", "进行中")}</span><span>${shortDate(p.createdAt)}</span></div><h2>${escape(p.title)}</h2><p class="card-signature">${t("by", "发布者：")} ${escape(p.signature)}</p><div class="mini-results">${p.resultsHidden ? t("Results will appear when voting closes.", "投票截止后公布结果。") : p.options
      .slice(0, 2)
      .map(
        (o) =>
          `<div><span>${escape(o.label)}</span><strong>${percent(o.votes, p.totalVotes)}%</strong><meter min="0" value="${o.votes}" max="${p.totalVotes || 1}" aria-label="${escape(o.label)}" aria-valuetext="${percent(o.votes, p.totalVotes)}%"></meter></div>`,
      )
      .join(
        "",
      )}${!p.resultsHidden && p.options.length > 3 ? `<small>+ ${p.options.length - 3} ${t("more options", "个其他选项")}</small>` : ""}</div><div class="card-bottom"><span>${p.resultsHidden ? "" : `${t(`${count(p.totalVotes)} votes`, `${count(p.totalVotes)} 票`)} <span class="separator">·</span> `}♡ ${t(`${count(p.totalLikes ?? 0)} likes`, `${count(p.totalLikes ?? 0)} 次赞`)} <span class="separator">·</span> ${remaining(p.endsAt, p.serverTime)}</span>${icons.arrow}</div></a>`;
  }
  function refreshHoldBadges(list) {
    clearTimeout(listHoldTimer);
    const now = Date.now();
    let earliest = Infinity;
    for (const badge of list.querySelectorAll("[data-hold-deadline]")) {
      const end = Number(badge.dataset.holdDeadline);
      if (end > now) earliest = Math.min(end, earliest);
      else {
        delete badge.dataset.holdDeadline;
        badge.classList.remove("in-progress");
        badge.textContent = saleStateLabel("open");
      }
    }
    if (Number.isFinite(earliest)) listHoldTimer = setTimeout(() => refreshHoldBadges(list), earliest - now);
  }
  async function load(reset = true, background = false, visibleCount = loaded, returnTo) {
    if (mode === "map") return loadMap();
    if (background && listReturnRequest === request) return;
    clearTimeout(listPickupTimer);
    const current = ++request;
    if (returnTo) listReturnRequest = current;
    const more = document.querySelector("#load-more");
    const desiredCount = background ? Math.max(20, visibleCount) : 20;
    const returnId = returnTo?.path.split("/").pop();
    // Allow one extra page in case new posts pushed the result past its previous page.
    let returnPages = returnTo ? Math.floor(returnTo.index / 20) + 2 : 0;
    let deadline = reset ? Infinity : listPickupDeadline;
    let next = reset ? undefined : cursor;
    document.querySelector("#list-error").hidden = true;
    more.disabled = true;
    if (reset && !background) {
      list.innerHTML =
        `<div class="list-empty" role="status">${t("Finding posts…", "正在查找帖子…")}</div>`;
      more.hidden = true;
    }
    try {
      const posts = [];
      const filters = { status, type: contentType, query, ...nearbyOptions(), ...pickupOption() };
      do {
        const started = Date.now();
        let data;
        try {
          data = await api("/api/posts/search", { ...filters, ...(next ? { cursor: next } : {}) });
        } catch (error) {
          if (!returnTo || !next) throw error;
          // Keep the results already fetched and let the reader retry Load more.
          break;
        }
        if (current !== request) return;
        if (Number.isSafeInteger(data.refreshAfterMs)) deadline = Math.min(deadline, started + data.refreshAfterMs);
        if (!reset && deadline <= Date.now()) return load(true, true, loaded + 20);
        posts.push(...(filters.pickup ? data.polls.filter(post =>
          pickupDeadline(post, filters.pickup) > post.serverTime + Date.now() - started) : data.polls));
        next = data.nextCursor;
      } while (next && ((background && posts.length < desiredCount)
        || (returnTo && --returnPages > 0 && !posts.some(post => post.id === returnId))));
      if (current !== request) return;
      const focused = background && list.contains(document.activeElement) ? document.activeElement : null;
      if (reset) {
        loaded = 0;
        list.innerHTML = "";
      }
      list.insertAdjacentHTML("beforeend", posts.map(card).join(""));
      refreshHoldBadges(list);
      loaded += posts.length;
      cursor = next;
      if (!loaded && pickupTime.value === "upcoming")
        list.innerHTML = `<div class="list-empty"><h2>${t("No pickup windows start in the next 24 hours.", "未来 24 小时没有即将开始的领取时段。")}</h2></div>`;
      else if (!loaded && pickupTime.value === "now")
        list.innerHTML = `<div class="list-empty"><h2>${t("No giveaways match the current pickup time.", "没有符合当前领取时段的赠予。")}</h2><p>${t("Only giveaways with an active pickup window are shown.", "仅显示当前处于领取时段的赠予。")}</p></div>`;
      else if (!loaded && query)
        list.innerHTML = `<div class="list-empty"><h2>${t("No posts match your search.", "没有符合搜索条件的帖子。")}</h2><p>${t("Try another keyword or change the filters.", "换个关键词，或调整筛选条件。")}</p></div>`;
      else if (!loaded)
        list.innerHTML = `<div class="list-empty"><span class="empty-symbol">${icons.pin}</span><h2>${location ? t("A little quiet around here.", "附近暂时还没有相关帖子。") : t("The first post could be yours.", "来发布第一条帖子吧！")}</h2><p>${location ? t("No matching posts in this area. Try a wider search or view all locations.", "该区域没有符合条件的帖子。可扩大搜索范围或查看全部地点。") : t("No posts match this filter yet. Share a poll or task with your neighbourhood.", "暂无符合条件的帖子。来发起投票或发布任务吧。")}</p><a class="text-link" href="/create">${t("Create a post ↗", "创建帖子 ↗")}</a></div>`;
      if (!loaded && hasFilters()) {
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "button secondary small";
        clear.textContent = clearFiltersLabel;
        clear.onclick = clearFilters;
        list.querySelector(".list-empty").append(clear);
      }
      document.querySelector("#list-count").textContent =
        t(`${count(loaded)} ${loaded === 1 ? "post" : "posts"} shown`, `显示 ${count(loaded)} 条帖子`);
      more.hidden = !cursor;
      if (focused) ([...list.querySelectorAll("a")].find(link => link.getAttribute("href") === focused.getAttribute("href")) ?? pickupTime).focus({ preventScroll: true });
      if (returnTo && document.activeElement === document.body) {
        const link = [...list.querySelectorAll("a.poll-list-card")].find(item => item.pathname === returnTo.path);
        link?.focus({ preventScroll: true });
        link?.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
      listPickupDeadline = deadline;
      if (pickupTime.value && !document.hidden && !suspended && Number.isFinite(deadline)) {
        listPickupTimer = setTimeout(() => load(true, true), Math.max(100, deadline - Date.now()));
      }
    } catch (e) {
      if (current !== request) return;
      const error = document.querySelector("#list-error");
      error.textContent = e.message;
      error.hidden = false;
      if (reset && !background)
        list.innerHTML =
          `<div class="list-empty">${t("Could not load posts. Select a filter to try again.", "无法加载帖子，请选择筛选条件重试。")}</div>`;
    } finally {
      if (listReturnRequest === current) listReturnRequest = undefined;
      if (current === request) more.disabled = false;
    }
  }
  function setStatus(value) {
    status = value;
    syncPickupFilter();
    for (const button of statusButtons) {
      const active = button.dataset.filter === value;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
  for (const button of statusButtons) {
    button.onclick = () => {
      setStatus(button.dataset.filter);
      rememberDiscovery();
      load();
    };
  }
  radiusSelect.onchange = () => {
    radiusKm = Number(radiusSelect.value);
    updateNearbyControl();
    if (location) load();
  };
  sortSelect.onchange = () => {
    sort = sortSelect.value;
    updateListCaption();
    load();
  };
  nearbyButton.onclick = async () => {
    if (locating) {
      document.querySelector("#list-error").hidden = true;
      setNearbyLocation(undefined);
      return;
    }
    if (location) {
      setNearbyLocation(undefined);
      load();
      return;
    }
    locating = true;
    const current = ++locationRequest;
    updateNearbyControl();
    document.querySelector("#list-error").hidden = true;
    try {
      const coordinates = await locate();
      if (current !== locationRequest) return;
      setNearbyLocation(coordinates);
      await load();
    } catch (e) {
      if (current !== locationRequest) return;
      const error = document.querySelector("#list-error");
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      if (current === locationRequest) {
        locating = false;
        updateNearbyControl();
      }
    }
  };
  document.querySelector("#load-more").onclick = () => load(false);
  const returned = performance.getEntriesByType("navigation")[0]?.type === "back_forward";
  const previousFilters = returned ? history.state?.scaleTagPostList : undefined;
  const prior = previousFilters ?? (filterKeys.some(key => incoming.has(key)) && {
    type: incoming.get("type"), status: incoming.get("status"), pickup: incoming.get("pickup"),
  });
  const position = takeListPosition();
  if (prior) {
    if ([...typeSelect.options].some(option => option.value === prior.type)) {
      contentType = typeSelect.value = prior.type;
    }
    if (statusButtons.some(button => button.dataset.filter === prior.status)) setStatus(prior.status);
    syncPickupFilter();
    if (!pickupFilter.hidden && ["now", "upcoming"].includes(prior.pickup)) pickupTime.value = prior.pickup;
    if (prior.mode === "map") {
      document.querySelector('[data-view="map"]').click();
      return;
    }
  }
  rememberDiscovery();
  const returnTo = returned && typeof position?.path === "string"
    && /^\/(vote|task|sale)\/[a-f0-9]{24}$/.test(position.path)
    && Number.isSafeInteger(position.index) && position.index >= 0 ? position : undefined;
  load(true, false, 0, returnTo);
}

function privacy() {
  document.title = t("Privacy & retention — ScaleTag", "隐私与数据保留 — ScaleTag");
  main.innerHTML = `<article class="privacy-page">
    <a class="back-link" href="/">${t("← Back to ScaleTag", "← 返回 ScaleTag")}</a>
    <span class="eyebrow">${t("A SMALL DATA FOOTPRINT", "关于你的数据")}</span>
    <h1>${t("Privacy and data retention", "隐私与数据保留")}</h1>
    <p>${t(
      "ScaleTag lets you vote, post a task, give something away or share a one-time encrypted message with Secrex without creating an account. Here is what other people can see, what we store and when it goes away.",
      "你无需注册账户，就可以在 ScaleTag 投票、发布任务、赠送闲置物品，或使用 Secrex 分享只能开启一次的加密消息。这里说明其他人能看到什么、我们保存什么，以及这些数据何时删除。",
    )}</p>

    <h2>${t("What other people can see", "其他人能看到什么")}</h2>
    <ul>
      <li>${t("Polls: Questions and options are public. The publisher sets the deadline and can hide results until voting closes. Results remain until day 30.", "投票：问题和选项公开。发布者设置截止时间，可以选择截止后公布结果。结果保留至发布后第 30 天。")}</li>
      <li>${t("Tasks: The task, reward, reply names and reply messages are public. Completed and Closed tasks stop accepting replies.", "任务：任务内容、酬谢、回复者的名字和留言会公开。标为已完成或已关闭的任务停止接收回复。")}</li>
      <li>${t("Giveaways: The pickup location is public while the item is available. After the publisher marks it claimed, it leaves discovery and the original link shows the claimed status until expiry.", "闲置赠予：物品可领取时，领取地点会公开。发布者标记已领取后，帖子不再出现在列表和地图，原链接仍显示已领取状态，直到到期。")}</li>
    </ul>
    <p>${t("Names are self-reported. Keep private contact details out of public text, pickup directions and photos.", "名字由用户自行填写，未经身份验证。请勿在公开文字、领取说明或照片中留下私人联系方式。")}</p>

    <h2>${t("Public text filtering", "公开文本过滤")}</h2>
    <p>${t(
      "Before a post or reply is published, ScaleTag checks public text fields (such as titles, descriptions, poll options, pickup locations, names and reply messages) against bundled English, Chinese, French and Quebec French wordlists from LDNOOBW, with some entries omitted to reduce false positives. Any submission that matches an included term is rejected without being saved.",
      "在帖子或回复发布前，ScaleTag 会对照内置的 LDNOOBW 英语、中文、法语及魁北克法语词表（其中省略了部分词条以减少误判），检查公开文本字段（例如标题、描述、投票选项、领取地点、署名和公开回复内容）。命中保留词条的提交会被拒绝，且不会被保存。",
    )}</p>
    <p>${t(
      "This check uses static word matching only, so it can miss altered spellings or other languages and can occasionally misidentify ordinary words. Private encrypted contact details in task replies and uploaded or linked images are not screened.",
      "此检查仅基于静态词表进行匹配，因此可能会漏掉改写后的词语或其他语言的表述，也可能偶尔误判正常用词。任务回复中经过加密的私人联系方式，以及上传或链接的图片均不会被检查。",
    )}</p>

    <h2>${t("Private contact details in task replies", "任务回复中的私人联系方式")}</h2>
    <p>${t(
      "When you enter a phone number or email address in the private fields of a task reply, your browser encrypts it with the task’s public key before sending it to ScaleTag. The task publisher’s browser uses the management password to decrypt it. ScaleTag stores encrypted contact details, and private backups may retain encrypted copies.",
      "在任务回复的私人栏位填写电话或邮箱时，你的浏览器会先用该任务的公钥加密，再发送给 ScaleTag。任务发布者的浏览器使用管理密码解密。ScaleTag 保存的是加密后的联系方式，私有备份中也可能保留加密副本。",
    )}</p>
    <p>${t(
      "The task publisher can save or share the contact details after viewing them.",
      "任务发布者查看联系方式后，可以另行保存或转发。",
    )}</p>

    <h2>${t("Managing polls, tasks and giveaways", "管理投票、任务和闲置赠予")}</h2>
    <p>${t(
      "Save the management address and randomly generated password when you publish. For a task, your browser uses the password locally. ScaleTag receives a separate credential derived from it to verify management requests. If you lose the task password, ScaleTag cannot reset it or recover encrypted contacts, even from a backup.",
      "发布时请保存管理网址和随机生成的密码。你的浏览器在本地使用任务管理密码。ScaleTag 接收的是由该密码派生的独立凭据，用于验证管理请求。任务管理密码丢失后，ScaleTag 无法重置密码，也无法从备份中恢复加密的联系方式。",
    )}</p>
    <p>${t(
      "For a poll or giveaway, your browser sends the management password to ScaleTag for verification. ScaleTag stores a salted Argon2id verifier for new management credentials. Older private management links can still provide access while the post is available. Keep your management details private. They let you change a post’s status and, for tasks, view private reply contacts.",
      "管理投票或闲置赠予时，浏览器会把管理密码发送给 ScaleTag 验证。新的管理凭据以带盐值的 Argon2id 验证值保存。只要帖子仍可访问，旧版私人管理链接仍可用于管理。请妥善保管管理信息。持有这些信息的人可以修改帖子状态，也可以查看任务回复中的私人联系方式。",
    )}</p>

    <h2>${t("Secrex one-time messages", "Secrex 阅后即焚消息")}</h2>
    <p>${t(
      "Secrex encrypts your message in your browser before sending it to ScaleTag. Share the link or QR code and the separate password through different channels. Secrex messages stay out of PostList, the map and the ScaleTag post archive. The sender can use a separate revocation code before anyone opens the message.",
      "Secrex 会在浏览器中加密你的消息，再发送到 ScaleTag。请通过不同渠道发送链接或二维码与分享密码。Secrex 消息不会进入 PostList、地图或 ScaleTag 帖子备份。消息被打开前，发送者可以使用单独的撤回码撤回消息。",
    )}</p>
    <p>${t(
      "An unopened message expires after seven days. The first successful unlock starts one reading session of up to five minutes, within that same seven-day limit. Closing or reloading the page clears the session in that browser. Use End and destroy to remove the encrypted message immediately once the server confirms. Otherwise the server removes it at expiry. ScaleTag retains the message ID, creation time, status and completion time as lifecycle records. Recipients can keep any copies they make.",
      "未打开的消息在七天后过期。首次成功解锁只开启一次阅读会话，最长五分钟，并且不能超过这七天的期限。关闭或重新加载页面会清除该浏览器中的阅读会话。选择“结束并销毁”后，服务器确认时会立即删除加密消息。否则，服务器会在到期时删除。ScaleTag 保留消息编号、创建时间、状态和结束时间作为状态记录。收件人可以保留自己保存的副本。",
    )}</p>

    <h2>${t("No account or device fingerprinting", "无需账户，不使用设备指纹。")}</h2>
    <p>${t(
      "Poll votes use a random cookie for each poll. Likes, replies and reports share a separate random cookie for each post. We save hashes to limit repeat votes, likes and reports from the same browser. Vote hashes are removed after voting closes. A cookie cannot verify who you are. Clearing cookies or changing browsers can allow another vote, like or report. ScaleTag does not keep web request access logs. Cloudflare processes network requests, and host security logs may contain connection information.",
      "每个投票使用随机 Cookie 记录投票。点赞、回复和举报共用另一个按帖子生成的随机 Cookie。系统保存哈希值，以限制同一浏览器重复投票、点赞或举报。投票关闭后会删除投票去重哈希。Cookie 无法验证身份。清除 Cookie 或换浏览器后，可以再次投票、点赞或举报。ScaleTag 不保留网站请求访问日志。Cloudflare 会处理网络请求，主机安全日志也可能包含连接信息。",
    )}</p>

    <h2>${t("Location, maps and photos", "位置、地图与照片")}</h2>
    <p>${t(
      "Public posts require a GPS location, which is saved with the post. Link-only posts skip GPS and stay out of PostList and the map. Anyone with the link can open them.",
      "公开帖需要获取 GPS 位置，位置信息会随帖子保存。仅链接可见的帖子无需定位，也不会出现在 PostList 或地图上。任何持有链接的人都可以打开。",
    )}</p>
    <p>${t(
      "Only posts whose publishers consent to map display appear on the map. Pins are rounded to a 0.01° grid. This gives an approximate location and cannot guarantee anonymity. We use your location for nearby searches only for the current request. The optional map loads tiles from OpenFreeMap, which receives your IP address and map tile requests.",
      "只有发布者同意显示在地图上的帖子才会上图，图钉按 0.01° 网格取整。这样只显示大致位置，无法保证匿名。附近搜索只在当次请求使用你的当前位置。打开地图时，OpenFreeMap 会收到你的 IP 地址和地图图块请求。",
    )}</p>
    <p>${t(
      "A copied PostList filter link includes only the selected post type, status and pickup time filter.",
      "复制的 PostList 筛选链接只包含选中的帖子类型、状态和领取时段筛选条件。",
    )}</p>
    <p>${t(
      "Uploaded photos are re-encoded to remove metadata. Visible details such as faces or addresses can still identify people or places. If you choose to load an external image, its host receives the request.",
      "上传的照片会重新编码以移除元数据，但照片里可见的面孔或地址仍可能暴露身份或地点。如果你选择加载外部图片，图片托管方会收到请求。",
    )}</p>

    <h2>${t("Deletion, backups and offline use", "删除、备份与离线使用")}</h2>
    <p>${t(
      "Active records are removed 30 days after publication. A giveaway can stop being public sooner. Six reports from different browser cookies automatically freeze a post and make it unavailable. Production stores records in encrypted SQLite and keeps encrypted daily backups for up to 90 days from the date each backup was made. A post’s last backup copy may therefore remain for about 120 days from publication. Cleanup can be delayed by outages. We cannot remove screenshots or copies other people have saved.",
      "帖子发布 30 天后会从当前存储中删除。闲置赠予可更早停止公开。同一帖子收到来自六个不同浏览器 Cookie 的举报后，会自动冻结，无法访问。线上数据保存在加密的 SQLite 数据库中，每日加密备份从生成之日起最多保留 90 天，因此帖子的最后一份备份可能保留到发布后约 120 天。服务中断可能延迟清理。我们无法收回他人保存的截图或副本。",
    )}</p>
    <p>${t(
      "If you install ScaleTag, the app may cache interface files and a generic offline page. It does not cache private management data or queue votes, likes, replies, reports or posts while offline. Your browser can remember your language choice.",
      "安装 ScaleTag 后，浏览器可能缓存界面文件和通用离线页。私人管理数据不会进入离线缓存，离线时提交的投票、点赞、回复、举报或帖子也不会排队发送。浏览器可以记住你的语言选择。",
    )}</p>
    <p>${t("Text drafts and saved links stay in this browser. Photos, management passwords and private reply contacts are excluded.", "文字草稿和已保存的链接仅保存在当前浏览器，不包含照片、管理密码或私人回复联系方式。")}</p>
    <p>${t(
      "Drafts save public form text. Saved links can include a link to a specific public task reply or a management address that still requires its password. Drafts and saved links are local to this browser and site address and do not sync across devices.",
      "草稿保存表单中的公开文字。已保存的链接可以指向某条公开任务回复，也可以是仍需密码才能使用的管理网址。草稿和链接仅保存在当前浏览器及当前网站地址下，不会跨设备同步。",
    )}</p>
    <p>${t("Visit counts use a random browser cookie. Active storage keeps separate hashes for the site and each post for up to 30 days after the last visit. Visit statistics do not record IP addresses or Secrex share links.", "访问统计使用随机浏览器 Cookie。站点和各帖子分别保存其哈希，活跃数据自上次访问起最多保留 30 天。访问统计不记录 IP 地址或 Secrex 分享链接。")}</p>
    <p><a class="text-link" href="/help">${t("Feature guide", "功能指南")}</a></p>
    <a class="text-link" href="https://github.com/ChrisXHLeung/ScaleTag" target="_blank" rel="noopener noreferrer">${t("Read the architecture and source on GitHub ↗", "在 GitHub 查看架构与源代码 ↗")}</a>
  </article>`;
}

async function showVisitCounts(path, title) {
  try {
    const { days7, days30 } = await api(path);
    if (![days7, days30].every(value => Number.isSafeInteger(value) && value >= 0)) return;
    const footer = document.querySelector("#footer-visits");
    if (!footer) return;
    const week = count(days7);
    const month = count(days30);
    const summary = document.createElement("span");
    summary.setAttribute("aria-hidden", "true");
    summary.textContent = `${week}/${month}`;
    const description = document.createElement("span");
    description.className = "sr-only";
    description.textContent = `${t("Last 7 days", "近 7 日")} ${week} · ${t("Last 30 days", "近 30 日")} ${month}`;
    summary.title = description.textContent;
    footer.replaceChildren(`${title} · `, summary, description);
    footer.hidden = false;
  } catch {
    // A statistics outage or offline session does not affect the page.
  }
}

function followPostListHistory(event) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest("a[href]");
  if (!link || link.target || link.hasAttribute("download") || link.origin !== location.origin || link.pathname !== "/PostList") return;
  const nav = window.navigation;
  const current = nav.currentEntry;
  if (!current) return;
  const entries = nav.entries();
  let index = current.index - 1;
  while (entries[index]?.sameDocument) index--;
  const previous = entries[index];
  if (previous?.getState()?.scaleTagPostList !== true) return;

  event.preventDefault();
  const { committed, finished } = nav.traverseTo(previous.key);
  // A cancelled or failed traversal also rejects finished; handle it so it is not reported as unhandled.
  finished?.catch(() => {});
  void committed.catch(error => {
    if (error.name !== "AbortError" && nav.currentEntry?.key === current.key) location.assign(link.href);
  });
}

const route = window.location.pathname;
const guideLink = document.querySelector("[data-feature-guide]");
if (guideLink) {
  const topic = helpTopic(route);
  guideLink.textContent = t("Feature guide", "功能指南");
  if (topic) guideLink.href = `/help#${topic}`;
}
if (typeof window.navigation?.traverseTo === "function" && /^\/(vote|task|sale)\/[a-f0-9]{24}$/.test(route)) {
  main.addEventListener("click", followPostListHistory);
}
const savedNav = document.querySelector('[data-nav="saved"]');
if (savedNav) savedNav.textContent = t("Saved links", "已保存链接");
try {
  if (route === "/" && location.hash === "#create")
    window.location.replace(localizedPath("/create"));
  else if (route === "/") {
    home();
    void showVisitCounts("/api/visits", t("Site visits", "本站访问量"));
  } else if (route === "/create") createPoll();
  else if (route === "/create/task") createTask();
  else if (route === "/create/sale") createSale();
  else if (route === "/install") installPage();
  else if (route === "/PostList") postList();
  else if (route === "/saved") {
    document.title = t("Saved links — ScaleTag", "已保存链接 — ScaleTag");
    setActiveNav("saved");
    renderSavedPosts(main);
  }
  else if (route === "/help" || route === "/help/") renderHelp(main);
  else if (route === "/privacy") privacy();
  else if (/^\/vote\/[a-f0-9]{24}\/manage$/.test(route)) await pollManagePage(route.split("/")[2]);
  else if (/^\/vote\/[a-f0-9]{24}$/.test(route)) {
    const id = route.split("/")[2];
    await votePage(id);
    void showVisitCounts(`/api/visits/poll/${id}`, t("Post visits", "本帖访问量"));
  } else if (/^\/sale\/[a-f0-9]{24}$/.test(route)) {
    const id = route.split("/")[2];
    await salePage(id);
    void showVisitCounts(`/api/visits/giveaway/${id}`, t("Post visits", "本帖访问量"));
  } else if (/^\/sale\/[a-f0-9]{24}\/manage$/.test(route))
    await salePage(route.split("/")[2], { manage: true });
  else if (/^\/task\/[a-f0-9]{24}$/.test(route)) {
    const id = route.split("/")[2];
    await taskPage(id);
    void showVisitCounts(`/api/visits/task/${id}`, t("Post visits", "本帖访问量"));
  } else if (/^\/task\/[a-f0-9]{24}\/manage$/.test(route))
    await taskPage(route.split("/")[2], { manage: true });
  else showError(new Error(t("This link does not point to an available post.", "此链接未指向可用帖子。")));
} catch (e) {
  showError(e);
}
