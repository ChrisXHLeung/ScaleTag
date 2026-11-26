import { escape, t } from "/common.js";

const features = [
  ["polls", "/create", ["Polls", "投票"],
    ["Ask one question with 2–12 options and choose a voting window of 1 hour, 6 hours, 1 day, 3 days or 7 days. Show results immediately or when voting closes. Before the first vote, the publisher can edit the question and options while voting is open. Results normally remain until day 30. You can share a QR code or poster and export results once they are visible.",
      "填写一个问题和 2 至 12 个选项，将投票期限设为 1 小时、6 小时、1 天、3 天或 7 天之一。结果可以即时公布，也可以在投票结束后公布。收到第一票前，只要投票仍开放，发布者就能修改问题和选项。结果通常保留至第 30 天。你可以分享二维码或海报，并在结果公布后导出结果。"],
    [["Set the question and deadline", "设置问题和截止时间"], ["Share the link or QR code", "分享链接或二维码"], ["Vote", "投票"], ["View or export results", "查看或导出结果"]]],
  ["tasks", "/create/task", ["Tasks and replies", "任务与回复"],
    ["Publish a task with a reward description. A reply’s name and message are visible to task readers. The separate phone or email field is encrypted in the respondent’s browser. The publisher can unlock contacts and privately choose one respondent, which pauses new replies. Reopening clears the selection. Completed and Closed are final. After replying, you can open, copy or save the specific public reply link.",
      "发布任务并填写酬谢说明。任务读者可以看到回复的署名和留言。单独填写的电话或邮箱在回复者的浏览器中加密。发布者可解锁联系方式并私下选择一名回复者，选择后会暂停接收新回复。重新开放会清除原选择。「已完成」和「已关闭」是最终状态。回复发布后，可以打开、复制或收藏该条公开回复的链接。"],
    [["Publish a task", "发布任务"], ["Send a public reply with private contact details", "提交公开回复与私人联系方式"], ["Publisher selects a respondent", "发布者选择回复者"], ["Finish or close the task", "完成或关闭任务"]]],
  ["giveaways", "/create/sale", ["Free giveaways", "闲置赠予"],
    ["Enter a public pickup location and an optional pickup window. Browse for pickups available now or starting within 24 hours. For an available item with a pickup window you can download a calendar entry. A publisher can place or release a temporary hold and mark the item claimed. Once claimed, it leaves discovery and the original link hides pickup details. Giveaways can be available for up to 72 hours.",
      "填写公开领取地点，也可设置领取时段。可筛选现在能领取或未来 24 小时开始领取的物品。物品可领取且设有时段时，可以下载日历事件。发布者可保留或解除保留，也可标记为已领取。标记后，物品退出公开发现，原链接隐藏领取详情。赠予帖最长可供访问 72 小时。"],
    [["Publish an item and pickup details", "发布物品与领取安排"], ["Find an available pickup", "查看可用领取安排"], ["Hold or mark claimed", "保留或标记已领取"]]],
  ["secrex", "/secrex", ["Secrex one-time secrets", "Secrex 阅后即焚"],
    ["The sender’s browser encrypts the text. Share the generated link and password separately. A valid password starts one reading session of up to five minutes within the seven-day expiry. The sender can revoke an unopened secret. Use End and destroy to end the session explicitly. For details about leaving the tab and server deletion, see the privacy page.",
      "发送者的浏览器会加密文本。请分开发送生成的链接和密码。正确密码可在七天有效期内开启一轮最长五分钟的阅读。发送者可以撤销尚未打开的秘密。「结束并销毁」可主动结束阅读。关闭标签页和服务器清理的细节见隐私页面。"],
    [["Encrypt a message", "加密消息"], ["Share link and password separately", "分开发送链接和密码"], ["Open one reading session", "开启一轮阅读"], ["End or let the session expire", "主动结束或等待到期"]]],
  ["discovery", "/PostList", ["Discovery, maps and shared filters", "发现、地图与筛选分享"],
    ["Search public titles and descriptions, then combine type, status and pickup filters. Search nearby using GPS or a chosen map area, with a radius of 2, 10, 50 or 100 km. Shareable filter links contain type, status and pickup timing. Opening a post and returning can restore the public filters and the last opened card when it is still available. The app’s return link uses the prior list in browsers that support the Navigation API.",
      "可搜索公开帖的标题和描述，并组合类型、状态及领取筛选。附近搜索可用 GPS 或地图选区，范围为 2、10、50 或 100 公里。可分享的筛选链接包含类型、状态和领取时段。从详情返回时可恢复公开筛选，并在原卡片仍可用时恢复定位。浏览器支持 Navigation API 时，详情页的返回链接可返回之前的列表。"],
    [["Open PostList or Map", "打开帖子列表或地图"], ["Search and filter", "搜索并筛选"], ["Open a post or copy public filters", "打开帖子或复制公开筛选"], ["Return to browsing", "返回继续浏览"]]],
  ["publishing", "/create", ["Publication, location and photos", "发布、位置与照片"],
    ["The public publishing form requires GPS and consent to show the approximate area on the map. Map pins show approximate areas rounded to a 0.01° grid. Link-only posts skip GPS and can be opened by anyone with their link. Uploaded photos are re-encoded to remove metadata. Visible details in an image can still identify a person or place.",
      "公开发布表单需要 GPS，并要求同意在地图上显示大致区域。地图图钉按 0.01° 网格显示大致区域。仅链接发布无需 GPS，持有链接的人可以打开。上传照片会重新编码以去除元数据，但照片中可见的内容仍可能暴露人物或地点。"],
    [["Choose public or link-only", "选择公开或仅链接"], ["Add GPS for public discovery", "公开发布时提供定位"], ["Publish and share", "发布并分享"]]],
  ["manage", "/privacy", ["Manage posts and reuse text", "管理帖子与复用文字"],
    ["Keep the management address and password from publication. Unlock the post to edit supported fields or change its state. Copy supported public text to a new draft when you want to start another post. Drafts live in the same browser. The draft copy leaves out photos, location, pickup schedules and credentials.",
      "发布时请保存管理网址和密码。解锁后可修改支持的字段或更改帖子状态。需要再发一条时，可以复制支持的公开文字到新草稿。草稿保存在原浏览器，复制时排除照片、位置、领取安排和凭据。"],
    [["Keep the address and password", "保存管理网址和密码"], ["Unlock the post", "解锁帖子"], ["Edit, change state or copy public text", "编辑、改状态或复制公开文字"]]],
  ["saved", "/saved", ["Saved links", "已保存链接"],
    ["Save a post, a management address or an individual public task reply. Search by title and filter by type and link status. A failed status check shows as unverified. You can copy a saved link or undo the latest removal while the page is open. Bookmarks stay in this browser on this site. A management address still needs its password.",
      "可收藏帖子、管理网址或一条公开任务回复。支持按标题搜索、按类型和链接状态筛选。查询失败会显示为尚未核验。可以复制链接，或在页面打开期间撤销最近一次移除。收藏只保存在当前浏览器的当前站点，打开管理网址仍需要密码。"],
    [["Save a post or reply", "收藏帖子或回复"], ["Find it in Saved links", "在已保存链接中查找"], ["Open, copy or remove it", "打开、复制或移除"]]],
  ["offline", "/install", ["Install and use offline", "安装与离线使用"],
    ["Install ScaleTag from your browser where supported. After the browser caches the interface, the offline page can show saved addresses. Reconnect to open a post or check its status. Publishing, voting, replying, liking and reporting require a connection at the time of the action.",
      "可通过支持安装的浏览器安装 ScaleTag。浏览器缓存界面后，离线页可显示收藏地址。重新联网后可查看帖子和更新状态。发布、投票、回复、点赞与举报需要在执行时联网。"],
    [["Visit ScaleTag online", "联网访问 ScaleTag"], ["Install or keep using the browser", "安装或继续使用浏览器"], ["View saved addresses offline", "离线查看收藏地址"], ["Reconnect to interact", "重连后互动"]]],
  ["reports", "/privacy", ["Likes, reports and freezing", "点赞、举报与冻结"],
    ["Likes and reports use an anonymous cookie per post. Six distinct reporting cookies freeze the post and remove it from discovery. Manual review and collection of report reasons are disabled by default. Public text is checked against bundled wordlists when submitted.",
      "点赞和举报使用按帖子生成的匿名 Cookie。来自六个不同 Cookie 的举报会冻结帖子并将其移出公开发现。人工复核和举报理由收集默认关闭。公开文字在提交时会按内置词表检查。"],
    [["Open a post", "打开帖子"], ["Like or report it", "点赞或举报"], ["Six distinct reports freeze it", "六个不同 Cookie 举报后冻结"]]],
  ["visits", "/privacy", ["Visit counters", "访问统计"],
    ["The homepage and public post footers show distinct browsers over the past 7 and 30 days. Canada and Japan count independently. Public counters exclude management pages, link-only posts and Secrex share links.",
      "首页和公开帖子页底部显示近 7 天及 30 天的独立浏览器数。加拿大与日本站分别计数。管理页、仅链接帖子及 Secrex 分享链接不计入公开统计。"],
    [["Open a public page", "访问公开页面"], ["Count the browser once per window", "每个统计窗口内按浏览器去重"], ["Read the totals in the footer", "在页脚查看累计数"]]],
];

export function renderHelp(main) {
  const label = pair => escape(t(...pair));
  document.title = t("Feature guide — ScaleTag", "功能指南 — ScaleTag");
  const topics = features.map(([id, , title]) => `<li><a href="#${id}">${label(title)}</a></li>`).join("");
  const sections = features.map(([id, path, title, description, steps]) => `
    <section id="${id}" class="help-topic" aria-labelledby="help-${id}">
      <h2 id="help-${id}">${label(title)}</h2>
      <p>${label(description)}</p>
      <ol class="help-flow" role="list">${steps.map(step => `<li>${label(step)}</li>`).join("")}</ol>
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
}
