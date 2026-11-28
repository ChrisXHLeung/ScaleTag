import { escape, t } from "/common.js";

const actor = {
  pollCreator: ["Poll creator", "投票发起者"],
  voter: ["Voter", "投票者"],
  pollReader: ["Poll reader", "查看结果的人"],
  taskPublisher: ["Task publisher", "任务发布者"],
  respondent: ["Respondent", "回复者"],
  giver: ["Giver", "赠予者"],
  requester: ["Requester", "求赠者"],
  finder: ["Finder", "拾获者"],
  claimant: ["Claimant", "认领者"],
  pickupVisitor: ["Pickup visitor", "领取者"],
  sender: ["Sender", "发送者"],
  recipient: ["Recipient", "收件人"],
  service: ["ScaleTag", "ScaleTag"],
  visitor: ["Visitor", "访客"],
  publisher: ["Post publisher", "帖子发布者"],
  user: ["You", "你"],
};

const features = [
  ["polls", "/create", ["Polls", "投票"],
    ["Ask one question with 2–12 options and choose a voting window of 1 hour, 6 hours, 1 day, 3 days or 7 days. Show results immediately or when voting closes. Before the first vote, the publisher can edit the question and options while voting is open. Results normally remain until day 30. You can share a QR code or poster and export results once they are visible.",
      "填写一个问题和 2 至 12 个选项，将投票期限设为 1 小时、6 小时、1 天、3 天或 7 天之一。结果可以即时公布，也可以在投票结束后公布。收到第一票前，只要投票仍开放，发布者就能修改问题和选项。结果通常保留至第 30 天。你可以分享二维码或海报，并在结果公布后导出结果。"],
    [
      [actor.pollCreator, "Set the question and deadline", "设置问题和截止时间"],
      [actor.pollCreator, "Publish and share the link or QR code", "发布并分享链接或二维码"],
      [actor.voter, "Vote and update your ballot if allowed", "投票，获准时可改选或撤回"],
      [actor.pollReader, "View results when available", "结果公布后查看"],
      [actor.pollCreator, "Confirm a decision if needed", "需要时确认最终决定"],
      [actor.pollReader, "See the decision and download its calendar event if set", "查看最终决定，若有活动时间可加入日历"],
    ]],
  ["tasks", "/create/task", ["Tasks and replies", "任务与回复"],
    ["Publish a task with a reward description. A reply’s name and message are visible to task readers. The separate phone or email field is encrypted in the respondent’s browser. The publisher can unlock contacts and privately choose one respondent, which pauses new replies. Reopening clears the selection. Completed and Closed are final. After replying, you can open, copy or save the specific public reply link.",
      "发布任务并填写酬谢说明。任务读者可以看到回复的署名和留言。单独填写的电话或邮箱在回复者的浏览器中加密。发布者可解锁联系方式并私下选择一名回复者，选择后会暂停接收新回复。重新开放会清除原选择。「已完成」和「已关闭」是最终状态。回复发布后，可以打开、复制或收藏该条公开回复的链接。"],
    [
      [actor.taskPublisher, "Publish a task", "发布任务"],
      [actor.respondent, "Send a public reply with private contact details", "提交公开回复与私人联系方式"],
      [actor.taskPublisher, "Select a respondent if needed", "需要时选择一名回复者"],
      [actor.taskPublisher, "Finish or close the task", "完成或关闭任务"],
    ]],
  ["wanted", "/create/wanted", ["Wanted", "求赠"],
    ["Ask neighbors for a free item. Donors can reply with a public offer and separately encrypted phone or email. The requester can pick a donor or mark the item received to stop new offers.",
      "向邻里求赠闲置物品。赠予者可以公开回复，并单独填写加密的电话或邮箱。求赠者可以选定赠予者，或标记已收到以停止接收新回复。"],
    [
      [actor.requester, "Publish an item request", "发布求赠"],
      [actor.giver, "Offer an item and leave private contact details", "提出赠予并私下留下联系方式"],
      [actor.requester, "Arrange pickup and mark the item received", "安排领取并标记已收到"],
    ]],
  ["giveaways", "/create/sale", ["Free giveaways", "闲置赠予"],
    ["Enter a public pickup location and an optional pickup window. Published times follow the reader’s device time zone and show the offset from UTC. Browse for pickups available now or starting within 24 hours. For an available item with a pickup window you can download a calendar entry. A publisher can place or release a temporary hold and mark the item claimed. Once claimed, it leaves discovery and the original link hides pickup details. Giveaways can be available for up to 72 hours.",
      "填写公开领取地点，也可设置领取时段。已发布的时间按查看者设备的时区显示，并标注相对 UTC 的偏移。可筛选现在能领取或未来 24 小时开始领取的物品。物品可领取且设有时段时，可以下载日历事件。发布者可保留或解除保留，也可标记为已领取。标记后，物品退出公开发现，原链接隐藏领取详情。赠予帖最长可供访问 72 小时。"],
    [
      [actor.giver, "Publish an item and pickup details", "发布物品与领取安排"],
      [actor.pickupVisitor, "Check the directions and pick up the item", "查看领取地点并现场领取"],
      [actor.giver, "Update the remaining quantity or mark the item claimed", "更新剩余件数或标记为已领取"],
    ]],
  ["lost", "/create/lost", ["Lost items", "寻物"],
    ["Publish what you lost and the approximate place and time. Tips are encrypted for you. Neighbours can send a tip without contact details.", "发布遗失物品及大致地点和时间。线索会加密，只有你可以解密。邻居可以在不留联系方式的情况下发送线索。"],
    [
      [["Item owner", "失主"], "Publish a lost notice", "发布寻物"],
      [["Neighbour", "邻居"], "Send a private tip", "发送私密线索"],
      [["Item owner", "失主"], "Check tips and mark the item recovered", "核实线索并标记已找回"],
    ]],
  ["found", "/create/found", ["Found items", "失物招领"],
    ["Publish a general description of a found item. Keep distinctive details private so the owner can describe them. The finder can unlock private claims and arrange the return directly.", "公开发布拾获物品的大致描述，把可辨认的特征留给失主说明。拾获者可解密认领信息，并直接安排归还。"],
    [
      [actor.finder, "Publish a found notice", "发布招领"],
      [actor.claimant, "Send encrypted ownership details", "发送加密的认领信息"],
      [actor.finder, "Check the details and arrange the return", "核对特征并安排归还"],
      [actor.finder, "Mark the item returned", "标记物品已归还"],
    ]],
  ["secrex", "/secrex", ["Secrex one-time secrets", "Secrex 阅后即焚"],
    ["Choose an unread link lifetime and share the encrypted message link and password separately. A valid password starts one reading session that ends within five minutes or at the original deadline, whichever comes first. The sender can revoke an unopened secret. The reader can use End and destroy to end the session early.",
      "选择未读链接有效期，并分开发送加密消息的链接和密码。正确密码可开启一次阅读，最迟在五分钟后或原截止时间结束，以先到者为准。发送者可撤回尚未打开的消息，收件人可点击「结束并销毁」提前结束。"],
    [
      [actor.sender, "Enter the message to encrypt", "输入要加密的消息"],
      [actor.sender, "Send the link or QR code separately from the password", "将链接或二维码与密码分开发送"],
      [actor.recipient, "Open one reading session", "开启一轮阅读"],
      [actor.recipient, "Use End and destroy to finish early", "可点击「结束并销毁」提前结束"],
      [actor.service, "Delete encrypted content after reading ends or expires", "会话结束或到期后删除密文"],
    ]],
  ["discovery", "/PostList", ["Discovery, maps and shared filters", "发现、地图与筛选分享"],
    ["Search public titles and descriptions, then combine type, status and pickup filters. Search nearby using GPS or a chosen map area, with a radius of 2, 10, 50 or 100 km. Shareable filter links contain type, status and pickup timing. Opening a post and returning can restore the public filters and the last opened card when it is still available. The app’s return link uses the prior list in browsers that support the Navigation API.",
      "可搜索公开帖的标题和描述，并组合类型、状态及领取筛选。附近搜索可用 GPS 或地图选区，范围为 2、10、50 或 100 公里。可分享的筛选链接包含类型、状态和领取时段。从详情返回时可恢复公开筛选，并在原卡片仍可用时恢复定位。浏览器支持 Navigation API 时，详情页的返回链接可返回之前的列表。"],
    [
      [actor.visitor, "Open PostList or Map", "打开帖子列表或地图"],
      [actor.visitor, "Search and filter", "搜索并筛选"],
      [actor.visitor, "Open a post or copy public filters", "打开帖子或复制公开筛选"],
      [actor.visitor, "Return to browsing", "返回继续浏览"],
    ]],
  ["publishing", "/create", ["Publication, location and photos", "发布、位置与照片"],
    ["The public publishing form requires GPS and consent to show the approximate area on the map. Map pins show approximate areas rounded to a 0.01° grid. Link-only posts skip GPS and can be opened by anyone with their link. Uploaded photos are re-encoded to remove metadata. Visible details in an image can still identify a person or place.",
      "公开发布表单需要 GPS，并要求同意在地图上显示大致区域。地图图钉按 0.01° 网格显示大致区域。仅链接发布无需 GPS，持有链接的人可以打开。上传照片会重新编码以去除元数据，但照片中可见的内容仍可能暴露人物或地点。"],
    [
      [actor.publisher, "Choose public or link-only", "选择公开或仅链接"],
      [actor.publisher, "Add GPS for public discovery", "公开发布时提供定位"],
      [actor.publisher, "Publish and share", "发布并分享"],
    ]],
  ["manage", "/privacy", ["Manage posts and reuse text", "管理帖子与复用文字"],
    ["Keep the management address and password from publication. Unlock the post to edit supported fields or change its state. Copy supported public text to a new draft when you want to start another post. Drafts live in the same browser. The draft copy leaves out photos, location, pickup schedules and credentials.",
      "发布时请保存管理网址和密码。解锁后可修改支持的字段或更改帖子状态。需要再发一条时，可以复制支持的公开文字到新草稿。草稿保存在原浏览器，复制时排除照片、位置、领取安排和凭据。"],
    [
      [actor.publisher, "Keep the address and password", "保存管理网址和密码"],
      [actor.publisher, "Unlock the post", "解锁帖子"],
      [actor.publisher, "Edit, change state or copy public text", "编辑、改状态或复制公开文字"],
    ]],
  ["saved", "/saved", ["Saved links", "已保存链接"],
    ["Save a post, a management address or an individual public task reply. Search by title and filter by type and link status. A failed status check shows as unverified. You can copy a saved link or undo the latest removal while the page is open. Bookmarks stay in this browser on this site. A management address still needs its password. After opening a saved link in this tab, use Back to restore the previous filters and return to that link if it is still visible.",
      "可收藏帖子、管理网址或一条公开任务回复。支持按标题搜索、按类型和链接状态筛选。查询失败会显示为尚未核验。可以复制链接，或在页面打开期间撤销最近一次移除。收藏只保存在当前浏览器的当前站点，打开管理网址仍需要密码。在当前标签页打开收藏后，使用浏览器返回可恢复先前的筛选，并在链接仍可见时回到该链接。"],
    [
      [actor.user, "Save a post or reply", "收藏帖子或回复"],
      [actor.user, "Find it in Saved links", "在已保存链接中查找"],
      [actor.user, "Open, copy or remove it", "打开、复制或移除"],
    ]],
  ["offline", "/install", ["Install and use offline", "安装与离线使用"],
    ["Install ScaleTag from your browser where supported. After the browser caches the interface, the offline page can show saved addresses. Reconnect to open a post or check its status. Publishing, voting, replying, liking and reporting require a connection at the time of the action.",
      "可通过支持安装的浏览器安装 ScaleTag。浏览器缓存界面后，离线页可显示收藏地址。重新联网后可查看帖子和更新状态。发布、投票、回复、点赞与举报需要在执行时联网。"],
    [
      [actor.user, "Visit ScaleTag online", "联网访问 ScaleTag"],
      [actor.user, "Install or keep using the browser", "安装或继续使用浏览器"],
      [actor.user, "View saved addresses offline", "离线查看收藏地址"],
      [actor.user, "Reconnect to interact", "重连后互动"],
    ]],
  ["reports", "/privacy", ["Likes, reports and freezing", "点赞、举报与冻结"],
    ["Likes and reports use an anonymous cookie per post. Six distinct reporting cookies freeze the post and remove it from discovery. Manual review and collection of report reasons are disabled by default. Public text is checked against bundled wordlists when submitted.",
      "点赞和举报使用按帖子生成的匿名 Cookie。来自六个不同 Cookie 的举报会冻结帖子并将其移出公开发现。人工复核和举报理由收集默认关闭。公开文字在提交时会按内置词表检查。"],
    [
      [actor.visitor, "Open a post", "打开帖子"],
      [actor.visitor, "Like or report it", "点赞或举报"],
      [actor.service, "Freeze the post after six distinct reports", "收到六个不同 Cookie 的举报后冻结帖子"],
    ]],
  ["visits", "/privacy", ["Visit counters", "访问统计"],
    ["The homepage and public post footers show distinct browsers over the past 7 and 30 days. Canada and Japan count independently. Public counters exclude management pages, link-only posts and Secrex share links.",
      "首页和公开帖子页底部显示近 7 天及 30 天的独立浏览器数。加拿大与日本站分别计数。管理页、仅链接帖子及 Secrex 分享链接不计入公开统计。"],
    [
      [actor.visitor, "Open a public page", "访问公开页面"],
      [actor.service, "Count the browser once per window", "每个统计窗口内按浏览器去重"],
      [actor.visitor, "Read the totals in the footer", "在页脚查看累计数"],
    ]],
];

const label = pair => escape(t(...pair));

function renderFlow(steps) {
  return `<ol class="help-flow" role="list">${steps.map(([actorLabel, ...action]) => `
    <li><strong class="help-step-actor">${label(actorLabel)}</strong><span class="sr-only">: </span><span class="help-step-action">${label(action)}</span></li>`).join("")}
  </ol>`;
}

export function renderIntroFlow(topic) {
  const [, , , , steps] = features.find(([id]) => id === topic);
  return `<section class="intro-flow" aria-labelledby="intro-flow-title">
    <h2 id="intro-flow-title" class="tiny-label">${t("How it works", "使用流程")}</h2>
    ${renderFlow(steps)}
  </section>`;
}

export function renderHelp(main) {
  document.title = t("Feature guide — ScaleTag", "功能指南 — ScaleTag");
  const topics = features.map(([id, , title]) => `<li><a href="#${id}">${label(title)}</a></li>`).join("");
  const sections = features.map(([id, path, title, description, steps]) => `
    <section id="${id}" class="help-topic" aria-labelledby="help-${id}">
      <h2 id="help-${id}">${label(title)}</h2>
      <p>${label(description)}</p>
      ${id === "polls" ? `<p>${t("Use multiple choices to find when people can meet or which options they would accept. Each browser submits one ballot, and each option shows the share of ballots that picked it.", "可用多选投票寻找大家方便的时间，或了解哪些选择都能接受。每个浏览器提交一张选票，每项结果显示选择该项的选票占比。")}</p>` : ""}
      ${id === "giveaways" ? `<p>${t("For pickup by request, propose a time and use the same browser to check whether the publisher confirmed it. Exact directions are available only to the confirmed browser during its hold.", "如需先申请领取，请提交预计领取时间，再用同一浏览器查看发布者是否确认。只有获选的浏览器能在保留期间看到详细地点。")}</p>` : ""}
      ${id === "giveaways" ? `<p>${t("For direct pickup, you can publish multiple items in one giveaway and update how many are left after each pickup.", "选择直接领取时，可以在一条赠予帖里发布多件物品，每次领取后更新剩余件数。")}</p>` : ""}
      ${id === "tasks" ? `<p>${t("Set a help deadline if timing matters. New replies stop at the deadline, while the task and earlier replies stay readable.", "需要在特定时间前找到帮手时，可以设置截止时间。到时停止接收新回复，任务和已有回复仍可查看。")}</p>` : ""}
      ${renderFlow(steps)}
      <a class="text-link" href="${path}">${path === "/privacy" ? t("Privacy & retention", "隐私与保留") : t("Open this feature", "打开此功能")}</a>
    </section>`).join("");
  main.innerHTML = `<article class="privacy-page feature-guide">
    <a class="back-link" href="/">${t("← Back to ScaleTag", "← 返回 ScaleTag")}</a>
    <h1>${t("Feature guide", "功能指南")}</h1>
    <nav aria-label="${t("Guide topics", "指南主题")}"><ul class="help-topics">${topics}</ul></nav>
    ${sections}
  </article>`;
  const id = location.hash.slice(1);
  if (features.some(([topic]) => topic === id)) document.getElementById(id)?.scrollIntoView();
}

export function helpTopic(path) {
  if (path === "/PostList") return "discovery";
  if (path === "/saved") return "saved";
  if (path === "/install") return "offline";
  if (path.endsWith("/manage")) return "manage";
  if (path === "/create" || path.startsWith("/vote/")) return "polls";
  if (path === "/create/task" || path.startsWith("/task/")) return "tasks";
  if (path === "/create/sale" || path.startsWith("/sale/")) return "giveaways";
  if (path === "/create/wanted") return "wanted";
  if (path === "/create/found") return "found";
  if (path === "/create/lost") return "lost";
}
