import {
  DATA_IMAGE_PATTERN,
  date,
  icons,
  t,
  toast,
} from "/common.js";
import { language } from "/locale.js";

export const POSTER_WIDTH = 2480;
export const POSTER_HEIGHT = 3508;

const MARGIN_X = 150;
const CONTENT_WIDTH = POSTER_WIDTH - MARGIN_X * 2;
const FONT_STACK =
  'Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const COLORS = {
  paper: "#ffffff",
  ink: "#172b4d",
  muted: "#53647f",
  line: "#dce3ef",
  blue: "#1746a2",
  pale: "#eef3ff",
  red: "#c7283d",
};

const PRINTER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9V4h12v5M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="6" rx="1"/></svg>';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function tokenize(text) {
  return (
    String(text ?? "").match(
      /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]|[^\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+|\s+/g,
    ) ?? []
  );
}

function fitEllipsis(ctx, line, maxWidth) {
  let trimmed = line.trimEnd();
  while (trimmed.length > 0 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const paragraphs = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const lines = [];
  let truncated = false;

  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p].trim();
    if (!para) {
      if (lines.length && lines.length < maxLines && p < paragraphs.length - 1) {
        lines.push("");
      }
      continue;
    }

    const tokens = tokenize(para);
    let current = "";

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!current && /^\s+$/.test(token)) continue;
      const candidate = current + token;

      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current.trimEnd()) {
        lines.push(current.trimEnd());
        current = "";
        if (lines.length >= maxLines) {
          truncated = true;
          break;
        }
        if (/^\s+$/.test(token)) continue;
      }

      if (ctx.measureText(token).width <= maxWidth) {
        current = token;
      } else {
        let chunk = "";
        for (const ch of token) {
          if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
            if (lines.length >= maxLines) {
              truncated = true;
              break;
            }
          } else {
            chunk += ch;
          }
        }
        if (truncated) break;
        current = chunk;
      }
    }

    if (truncated) break;
    if (current.trimEnd()) {
      lines.push(current.trimEnd());
      if (lines.length >= maxLines && p < paragraphs.length - 1) {
        truncated = true;
        break;
      }
    }
  }

  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = fitEllipsis(ctx, lines[lines.length - 1], maxWidth);
  }
  return lines;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawBrandMark(ctx, x, y, size) {
  const s = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = COLORS.blue;
  drawRoundedRect(ctx, 0, 0, 64, 64, 18);
  ctx.fill();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(19, 45);
  ctx.lineTo(45, 19);
  ctx.moveTo(20, 19);
  ctx.lineTo(45, 19);
  ctx.lineTo(45, 44);
  ctx.stroke();

  ctx.fillStyle = COLORS.red;
  ctx.beginPath();
  ctx.arc(15, 15, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCoverImage(ctx, img, x, y, w, h, radius) {
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.clip();

  ctx.fillStyle = COLORS.pale;
  ctx.fillRect(x, y, w, h);

  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const boxRatio = w / h;
  let drawW = w;
  let drawH = h;
  let drawX = x;
  let drawY = y;

  if (imgRatio > boxRatio) {
    drawW = h * imgRatio;
    drawX = x - (drawW - w) / 2;
  } else {
    drawH = w / imgRatio;
    drawY = y - (drawH - h) / 2;
  }
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.stroke();
  ctx.restore();
}

function typeMeta(type) {
  if (type === "task") {
    return {
      badge: t("TASK", "邻里任务"),
      bylinePrefix: t("Posted by", "发布者："),
      scanEyebrow: t("SCAN TO HELP", "扫码查看任务"),
      scanPrompt: t(
        "Scan with your phone camera to view details or send a reply.",
        "用手机相机扫码查看任务详情或联系发布者。",
      ),
    };
  }
  if (type === "sale") {
    return {
      badge: t("FREE GIVEAWAY", "闲置赠予"),
      bylinePrefix: t("Posted by", "发布者："),
      scanEyebrow: t("SCAN TO CLAIM", "扫码查看领取"),
      scanPrompt: t(
        "Scan with your phone camera to check pickup details.",
        "用手机相机扫码查看物品详情及领取地点。",
      ),
    };
  }
  return {
    badge: t("POLL", "社区投票"),
    bylinePrefix: t("Started by", "发起人："),
    scanEyebrow: t("SCAN TO VOTE", "扫码参与投票"),
    scanPrompt: t(
      "Scan with your phone camera to vote or view live results.",
      "用手机相机扫码即可投票或查看实时结果。",
    ),
  };
}

export async function renderPosterCanvas(post) {
  const canvas = document.createElement("canvas");
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  // Subtle top accent bar
  ctx.fillStyle = COLORS.blue;
  ctx.fillRect(0, 0, POSTER_WIDTH, 24);

  const meta = typeMeta(post.type);
  const qrPromise = loadImage(post.qrUrl);
  const validPhotos = (post.images ?? [])
    .filter((src) => DATA_IMAGE_PATTERN.test(src))
    .slice(0, 3);
  const photoResults = await Promise.allSettled(validPhotos.map(loadImage));
  const photos = photoResults
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  // Header: Brand mark + ScaleTag + type pill
  let y = 120;
  drawBrandMark(ctx, MARGIN_X, y, 88);

  ctx.fillStyle = COLORS.ink;
  ctx.font = `800 54px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.fillText("ScaleTag", MARGIN_X + 114, y + 46);

  ctx.font = `700 32px ${FONT_STACK}`;
  const badgeW = ctx.measureText(meta.badge).width + 64;
  const badgeH = 64;
  const badgeX = POSTER_WIDTH - MARGIN_X - badgeW;
  const badgeY = y + 12;
  ctx.fillStyle = COLORS.pale;
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 32);
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 32);
  ctx.stroke();

  ctx.fillStyle = COLORS.blue;
  ctx.textAlign = "center";
  ctx.fillText(meta.badge, badgeX + badgeW / 2, badgeY + badgeH / 2 + 2);
  ctx.textAlign = "left";

  y += 128;
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, y);
  ctx.lineTo(POSTER_WIDTH - MARGIN_X, y);
  ctx.stroke();

  // Bottom Scan Card geometry (anchored at bottom)
  const scanCardH = 640;
  const scanCardY = POSTER_HEIGHT - 120 - scanCardH;
  const maxBodyBottom = scanCardY - 64;

  // Title
  y += 72;
  ctx.textBaseline = "top";
  ctx.fillStyle = COLORS.ink;
  ctx.font = `800 84px ${FONT_STACK}`;
  const titleLines = wrapText(ctx, post.title, CONTENT_WIDTH, 3);
  for (const line of titleLines) {
    ctx.fillText(line, MARGIN_X, y);
    y += 104;
  }

  // Byline
  y += 12;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 38px ${FONT_STACK}`;
  const byline = `${meta.bylinePrefix} ${post.signature || t("Anonymous", "匿名")} · ${date(post.createdAt)}`;
  const bylineLines = wrapText(ctx, byline, CONTENT_WIDTH, 2);
  for (const line of bylineLines) {
    ctx.fillText(line, MARGIN_X, y);
    y += 52;
  }

  // Reserve space for thumbnails and category card so description never crowds them
  const thumbH = photos.length ? 380 : 0;
  const thumbBlock = photos.length ? thumbH + 48 : 0;

  // Estimate highlight box height
  let highlightReserve = 0;
  if (post.type === "poll" && Array.isArray(post.options) && post.options.length) {
    const shownCount = Math.min(post.options.length, 6);
    highlightReserve = 120 + shownCount * 76 + (post.options.length > 6 ? 56 : 0);
  } else if (post.type === "task" || post.type === "sale") {
    highlightReserve = 240;
  }

  // Description
  const description = String(post.description ?? "").trim();
  if (description) {
    y += 28;
    const availForDesc = Math.max(
      140,
      maxBodyBottom - y - thumbBlock - highlightReserve - 40,
    );
    const lineHeight = 62;
    const maxDescLines = Math.max(2, Math.min(8, Math.floor(availForDesc / lineHeight)));
    ctx.fillStyle = COLORS.ink;
    ctx.font = `400 42px ${FONT_STACK}`;
    const descLines = wrapText(ctx, description, CONTENT_WIDTH, maxDescLines);
    for (const line of descLines) {
      if (!line) {
        y += 28;
        continue;
      }
      ctx.fillText(line, MARGIN_X, y);
      y += lineHeight;
    }
  }

  // Horizontal photo thumbnails (up to 3)
  if (photos.length) {
    y += 40;
    const gap = 32;
    const cols = photos.length;
    const cellW = (CONTENT_WIDTH - gap * (cols - 1)) / cols;
    const cellH = Math.min(thumbH, Math.max(240, maxBodyBottom - y - highlightReserve - 32));
    for (let i = 0; i < photos.length; i++) {
      drawCoverImage(
        ctx,
        photos[i],
        MARGIN_X + i * (cellW + gap),
        y,
        cellW,
        cellH,
        24,
      );
    }
    y += cellH + 16;
  }

  // Type-specific highlight card
  y += 36;
  const remainingH = maxBodyBottom - y;
  if (post.type === "poll" && Array.isArray(post.options) && post.options.length && remainingH >= 180) {
    const boxPadding = 48;
    const optionLineH = 68;
    const maxOptions = Math.max(
      2,
      Math.min(post.options.length, Math.floor((remainingH - 130) / optionLineH)),
    );
    const hasMore = post.options.length > maxOptions;
    const boxH =
      110 + maxOptions * optionLineH + (hasMore ? 52 : 0) + 28;

    ctx.fillStyle = COLORS.pale;
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_WIDTH, boxH, 32);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 3;
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_WIDTH, boxH, 32);
    ctx.stroke();

    let oy = y + 40;
    ctx.fillStyle = COLORS.blue;
    ctx.font = `700 28px ${FONT_STACK}`;
    ctx.fillText(t("OPTIONS", "投票选项"), MARGIN_X + boxPadding, oy);
    oy += 54;

    ctx.font = `500 40px ${FONT_STACK}`;
    for (let i = 0; i < maxOptions; i++) {
      const optLabel = post.options[i]?.label ?? "";
      ctx.strokeStyle = COLORS.blue;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(MARGIN_X + boxPadding + 18, oy + 22, 16, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = COLORS.ink;
      const [line] = wrapText(
        ctx,
        optLabel,
        CONTENT_WIDTH - boxPadding * 2 - 58,
        1,
      );
      ctx.fillText(line ?? "", MARGIN_X + boxPadding + 54, oy);
      oy += optionLineH;
    }
    if (hasMore) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = `500 32px ${FONT_STACK}`;
      const rest = post.options.length - maxOptions;
      ctx.fillText(
        t(`+ ${rest} more option${rest > 1 ? "s" : ""}`, `+ 另有 ${rest} 个选项`),
        MARGIN_X + boxPadding + 54,
        oy,
      );
    }
  } else if (post.type === "task" || post.type === "sale") {
    const eyebrow =
      post.type === "task"
        ? t("REWARD OFFERED", "提供的酬谢")
        : post.pickupLocation
          ? t("PICKUP LOCATION", "领取地点")
          : t("ASKING PRICE", "期望价格");
    const valueText =
      post.type === "task"
        ? post.reward
        : (post.pickupLocation ?? post.price ?? "");
    ctx.font = `800 54px ${FONT_STACK}`;
    const valueLines = wrapText(ctx, valueText, CONTENT_WIDTH - 96, 2);
    const boxH = 110 + valueLines.length * 70 + 36;

    ctx.fillStyle = COLORS.pale;
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_WIDTH, boxH, 32);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 3;
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_WIDTH, boxH, 32);
    ctx.stroke();

    // Left accent bar
    ctx.fillStyle = COLORS.blue;
    drawRoundedRect(ctx, MARGIN_X, y, 16, boxH, 8);
    ctx.fill();

    let hy = y + 40;
    ctx.fillStyle = COLORS.blue;
    ctx.font = `700 28px ${FONT_STACK}`;
    ctx.fillText(eyebrow, MARGIN_X + 56, hy);
    hy += 52;

    ctx.fillStyle = COLORS.ink;
    ctx.font = `800 54px ${FONT_STACK}`;
    for (const line of valueLines) {
      ctx.fillText(line, MARGIN_X + 56, hy);
      hy += 70;
    }
  }

  // Bottom Scan Card
  ctx.fillStyle = COLORS.pale;
  drawRoundedRect(ctx, MARGIN_X, scanCardY, CONTENT_WIDTH, scanCardH, 36);
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 4;
  drawRoundedRect(ctx, MARGIN_X, scanCardY, CONTENT_WIDTH, scanCardH, 36);
  ctx.stroke();

  const qrSize = 510;
  const qrBoxSize = 540;
  const qrBoxX = POSTER_WIDTH - MARGIN_X - 50 - qrBoxSize;
  const qrBoxY = scanCardY + (scanCardH - qrBoxSize) / 2;

  ctx.fillStyle = "#ffffff";
  drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 28);
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 28);
  ctx.stroke();

  const qrImg = await qrPromise;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    qrImg,
    qrBoxX + (qrBoxSize - qrSize) / 2,
    qrBoxY + (qrBoxSize - qrSize) / 2,
    qrSize,
    qrSize,
  );
  ctx.restore();

  // Left side of scan card
  const textX = MARGIN_X + 64;
  const textMaxW = qrBoxX - textX - 56;
  let sy = scanCardY + 64;

  ctx.fillStyle = COLORS.blue;
  ctx.font = `800 32px ${FONT_STACK}`;
  ctx.fillText(meta.scanEyebrow, textX, sy);
  sy += 56;

  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 48px ${FONT_STACK}`;
  const promptLines = wrapText(ctx, meta.scanPrompt, textMaxW, 3);
  for (const line of promptLines) {
    ctx.fillText(line, textX, sy);
    sy += 64;
  }

  sy += 24;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 34px ${FONT_STACK}`;
  const timeLines = [];
  if (post.type === "poll" && post.endsAt) {
    timeLines.push(`${t("Voting closes", "投票截止")}：${date(post.endsAt)}`);
  }
  const expiryTime = post.type === "sale" ? (post.endsAt ?? post.deleteAt) : post.deleteAt;
  if (expiryTime) {
    timeLines.push(
      `${post.type === "poll" ? t("Removed", "移除时间") : t("Available until", "有效期至")}：${date(expiryTime)}`,
    );
  }
  for (const line of timeLines) {
    ctx.fillText(line, textX, sy);
    sy += 48;
  }

  // Public URL at bottom of scan card
  ctx.fillStyle = COLORS.blue;
  ctx.font = `600 30px ${FONT_STACK}`;
  const [urlLine] = wrapText(ctx, post.publicUrl, textMaxW, 1);
  ctx.fillText(urlLine ?? "", textX, scanCardY + scanCardH - 86);

  return canvas;
}

export async function generatePosterBlobUrl(post) {
  const canvas = await renderPosterCanvas(post);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Poster export failed"))),
      "image/png",
    );
  });
  return URL.createObjectURL(blob);
}

function getPrintRoot() {
  let root = document.querySelector("#poster-print-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "poster-print-root";
    root.setAttribute("aria-hidden", "true");
    document.body.append(root);
  }
  return root;
}

export function mountPosterActions(shareCard, post) {
  if (!shareCard) return;

  const box = document.createElement("div");
  box.className = "poster-actions";
  box.innerHTML = `
    <p class="poster-actions-note">${t("Need a printable flyer for a community board? Generate an A4 poster with post details and this QR code.", "需要张贴在社区公告栏？可生成包含帖子内容和二维码的 A4 打印海报。")}</p>
    <button type="button" class="button" id="print-poster-btn">${PRINTER_ICON} ${t("Print A4 poster", "打印 A4 海报")}</button>
    <button type="button" class="button secondary" id="save-poster-btn">${icons.download} ${t("Save A4 poster", "保存 A4 海报")}</button>
  `;
  shareCard.append(box);

  const printBtn = box.querySelector("#print-poster-btn");
  const saveBtn = box.querySelector("#save-poster-btn");

  let cachedUrl = null;
  let cachedLang = null;

  async function ensurePosterUrl() {
    if (cachedUrl && cachedLang === language) return cachedUrl;
    if (cachedUrl) URL.revokeObjectURL(cachedUrl);
    cachedUrl = await generatePosterBlobUrl(post);
    cachedLang = language;
    return cachedUrl;
  }

  window.addEventListener(
    "pagehide",
    () => {
      if (cachedUrl) URL.revokeObjectURL(cachedUrl);
    },
    { once: true },
  );

  printBtn.onclick = async () => {
    printBtn.disabled = true;
    const originalHtml = printBtn.innerHTML;
    printBtn.textContent = t("Preparing A4 poster…", "正在生成 A4 海报…");
    try {
      const url = await ensurePosterUrl();
      const root = getPrintRoot();
      root.innerHTML = "";
      const img = document.createElement("img");
      img.src = url;
      img.alt = `${post.title} — ScaleTag A4 Poster`;
      root.append(img);
      await img.decode().catch(() => {});
      window.print();
    } catch {
      toast(t("Could not prepare the A4 poster. Please try again.", "无法生成 A4 海报，请重试。"));
    } finally {
      printBtn.disabled = false;
      printBtn.innerHTML = originalHtml;
    }
  };

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    const originalHtml = saveBtn.innerHTML;
    saveBtn.textContent = t("Preparing A4 poster…", "正在生成 A4 海报…");
    try {
      const url = await ensurePosterUrl();
      const link = document.createElement("a");
      link.href = url;
      link.download = `ScaleTag-poster-${post.id}.png`;
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      toast(t("Could not save the A4 poster. Please try again.", "无法保存 A4 海报，请重试。"));
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalHtml;
    }
  };
}
