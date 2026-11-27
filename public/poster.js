import {
  DATA_IMAGE_PATTERN,
  ballotsSubmitted,
  count,
  date,
  icons,
  t,
  toast,
} from "/common.js";
import { intlLocaleFor, language } from "/locale.js";

export const POSTER_WIDTH = 2480;
export const POSTER_HEIGHT = 3508;

const MARGIN_X = 140;
const CONTENT_WIDTH = POSTER_WIDTH - MARGIN_X * 2;
const FONT_STACK =
  'Inter, "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", "PingFang SC", "Hiragino Sans", "Apple SD Gothic Neo", "Microsoft YaHei", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

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
      /[\u3040-\u30ff\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]|[^\s\u3040-\u30ff\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+|\s+/g,
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

  ctx.fillStyle = "#ffffff";
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
  if (type === "wanted") {
    return {
      badge: t("Wanted", "求赠"),
      bylinePrefix: t("Posted by", "发布者："),
      scanEyebrow: t("Offer an item", "我可以赠予"),
      scanHeadline: t("Ask for an item", "向邻里求赠"),
      scanPrompt: t("Point your phone camera at the QR code to read full details or send a reply.", "用手机相机扫描二维码，即可查看详情或回复。"),
    };
  }
  if (type === "task") {
    return {
      badge: t("LOCAL TASK", "邻里任务"),
      bylinePrefix: t("Posted by", "发布者："),
      scanEyebrow: t("SCAN TO HELP", "扫码查看任务"),
      scanHeadline: t("Lend a hand nearby.", "邻里互助，扫码接单"),
      scanPrompt: t(
        "Point your phone camera at the QR code to read full details or send a reply.",
        "用手机相机扫描二维码，即可查看任务详情或联系发布者。",
      ),
    };
  }
  if (type === "sale") {
    return {
      badge: t("FREE GIVEAWAY", "闲置赠予"),
      bylinePrefix: t("Posted by", "发布者："),
      scanEyebrow: t("SCAN TO CLAIM", "扫码查看领取"),
      scanHeadline: t("Pick up locally for free.", "闲置分享，扫码免费领"),
      scanPrompt: t(
        "Point your phone camera at the QR code to check availability and pickup details.",
        "用手机相机扫描二维码，即可查看物品状态与领取地点。",
      ),
    };
  }
  return {
    badge: t("COMMUNITY POLL", "社区投票"),
    bylinePrefix: t("Started by", "发起人："),
    scanEyebrow: t("SCAN TO VOTE", "扫码参与投票"),
    scanHeadline: t("Make your voice heard.", "身边事，投出你的一票"),
    scanPrompt: t(
      "Point your phone camera at the QR code to cast your vote or view live results.",
      "用手机相机扫描二维码，即可参与投票或查看实时结果。",
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

  // Header band (white background for print economy, thin top accent bar + bottom border)
  const headerH = 250;
  ctx.fillStyle = COLORS.blue;
  ctx.fillRect(0, 0, POSTER_WIDTH, 24);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(POSTER_WIDTH, headerH);
  ctx.stroke();

  const meta = typeMeta(post.taskKind === "wanted" ? "wanted" : post.type);
  const qrPromise = loadImage(post.qrUrl);
  const validPhotos = (post.images ?? [])
    .filter((src) => DATA_IMAGE_PATTERN.test(src))
    .slice(0, 2);
  const photoResults = await Promise.allSettled(validPhotos.map(loadImage));
  const photos = photoResults
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  // Brand mark + ScaleTag + tagline
  drawBrandMark(ctx, MARGIN_X, 82, 108);
  ctx.fillStyle = COLORS.ink;
  ctx.textBaseline = "top";
  ctx.font = `800 58px ${FONT_STACK}`;
  ctx.fillText("ScaleTag", MARGIN_X + 136, 84);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 30px ${FONT_STACK}`;
  ctx.fillText(
    t("Small questions. Local voices.", "身边大小事，听听大家怎么说。"),
    MARGIN_X + 136,
    152,
  );

  // Solid category pill on right
  ctx.font = `800 34px ${FONT_STACK}`;
  const badgeW = ctx.measureText(meta.badge).width + 88;
  const badgeH = 74;
  const badgeX = POSTER_WIDTH - MARGIN_X - badgeW;
  const badgeY = 98;
  ctx.fillStyle = COLORS.blue;
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 37);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(meta.badge, badgeX + badgeW / 2, badgeY + badgeH / 2 + 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Footer reservation: scan card occupies ~1/4 of poster height (877px)
  const footerY = POSTER_HEIGHT - 140;
  const scanCardTargetH = Math.round(POSTER_HEIGHT / 4);
  const maxBodyBottom = footerY - scanCardTargetH - 56;

  // Title
  let y = headerH + 84;
  const titleSize = String(post.title ?? "").length > 42 ? 86 : 102;
  const titleLineH = titleSize + 22;
  ctx.fillStyle = COLORS.ink;
  ctx.font = `800 ${titleSize}px ${FONT_STACK}`;
  const titleLines = wrapText(ctx, post.title, CONTENT_WIDTH, 3);
  for (const line of titleLines) {
    ctx.fillText(line, MARGIN_X, y);
    y += titleLineH;
  }

  // Byline
  y += 16;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 38px ${FONT_STACK}`;
  const byline = `${meta.bylinePrefix} ${post.signature || t("Anonymous", "匿名")} · ${date(post.createdAt)}`;
  const bylineLines = wrapText(ctx, byline, CONTENT_WIDTH, 2);
  for (const line of bylineLines) {
    ctx.fillText(line, MARGIN_X, y);
    y += 52;
  }

  // Remaining body space is shared dynamically between text/options and photos:
  // - No photos: text/options occupy the full remaining body space.
  // - With photos: photos occupy 1/2 of the remaining body space;
  //   1 photo = 21:9 (cropped, never stretched), 2 photos = two 1:1 squares (cropped, never stretched).
  const bodyAvailH = Math.max(400, maxBodyBottom - y);
  const halfBodyH = Math.round(bodyAvailH / 2);
  let photoW = 0;
  let photoH = 0;
  let photoGap = 32;
  if (photos.length === 1) {
    photoH = Math.min(halfBodyH, Math.round((CONTENT_WIDTH * 9) / 21));
    photoW = Math.min(CONTENT_WIDTH, Math.round((photoH * 21) / 9));
  } else if (photos.length >= 2) {
    const side = Math.min(Math.floor((CONTENT_WIDTH - photoGap) / 2), halfBodyH);
    photoW = side;
    photoH = side;
  }
  const thumbBlock = photos.length ? photoH + 40 : 0;

  let highlightReserve = 0;
  if (post.type === "poll" && Array.isArray(post.options) && post.options.length) {
    const shownCount = Math.min(post.options.length, 6);
    highlightReserve = 140 + shownCount * 112 + (post.options.length > 6 ? 56 : 0);
  } else if ((post.type === "task" && post.taskKind !== "wanted") || post.type === "sale") {
    highlightReserve = 260;
  }

  // Description
  const description = String(post.description ?? "").trim();
  if (description) {
    y += 32;
    const availForDesc = Math.max(
      140,
      maxBodyBottom - y - thumbBlock - highlightReserve - 40,
    );
    const lineHeight = 64;
    const maxDescLines = Math.max(2, Math.floor(availForDesc / lineHeight));
    ctx.fillStyle = COLORS.ink;
    ctx.font = `400 44px ${FONT_STACK}`;
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

  // Photos (up to 2): 1 photo at 21:9, 2 photos as two 1:1 squares (cover-cropped, never stretched)
  if (photos.length) {
    y += 40;
    const totalW = photos.length * photoW + (photos.length - 1) * photoGap;
    const startX = MARGIN_X + Math.round((CONTENT_WIDTH - totalW) / 2);
    for (let i = 0; i < photos.length; i++) {
      drawCoverImage(
        ctx,
        photos[i],
        startX + i * (photoW + photoGap),
        y,
        photoW,
        photoH,
        24,
      );
    }
    y += photoH;
  }

  // Type-specific highlight card
  y += 40;
  const remainingForHighlight = maxBodyBottom - y;
  if (
    post.type === "poll" &&
    Array.isArray(post.options) &&
    post.options.length &&
    remainingForHighlight >= 220
  ) {
    const boxPad = 48;
    const rowH = 92;
    const rowGap = 20;
    const maxOptions = Math.max(
      2,
      Math.min(
        post.options.length,
        Math.floor((remainingForHighlight - 130) / (rowH + rowGap)),
      ),
    );
    const hasMore = post.options.length > maxOptions;
    const boxH =
      116 + maxOptions * (rowH + rowGap) - rowGap + (hasMore ? 56 : 0) + 44;

    ctx.fillStyle = "#ffffff";
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_WIDTH, boxH, 32);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 4;
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_WIDTH, boxH, 32);
    ctx.stroke();

    let oy = y + 44;
    ctx.fillStyle = COLORS.blue;
    ctx.font = `800 30px ${FONT_STACK}`;
    ctx.fillText(t("OPTIONS", "投票选项"), MARGIN_X + boxPad, oy);
    oy += 58;

    for (let i = 0; i < maxOptions; i++) {
      const optLabel = post.options[i]?.label ?? "";
      ctx.fillStyle = "#ffffff";
      drawRoundedRect(ctx, MARGIN_X + boxPad, oy, CONTENT_WIDTH - boxPad * 2, rowH, 20);
      ctx.fill();
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, MARGIN_X + boxPad, oy, CONTENT_WIDTH - boxPad * 2, rowH, 20);
      ctx.stroke();

      // Numbered circle badge
      const cx = MARGIN_X + boxPad + 52;
      const cy = oy + rowH / 2;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.blue;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = COLORS.blue;
      ctx.font = `800 28px ${FONT_STACK}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), cx, cy + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      ctx.fillStyle = COLORS.ink;
      ctx.font = `600 40px ${FONT_STACK}`;
      const [line] = wrapText(
        ctx,
        optLabel,
        CONTENT_WIDTH - boxPad * 2 - 128,
        1,
      );
      ctx.fillText(line ?? "", MARGIN_X + boxPad + 100, cy + 2);
      ctx.textBaseline = "top";
      oy += rowH + rowGap;
    }

    if (hasMore) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = `600 32px ${FONT_STACK}`;
      const rest = post.options.length - maxOptions;
      ctx.fillText(
        t(`+ ${rest} more option${rest > 1 ? "s" : ""}`, `+ 另有 ${rest} 个选项`),
        MARGIN_X + boxPad,
        oy + 8,
      );
    }
    y += boxH;
  } else if ((post.type === "task" && post.taskKind !== "wanted") || post.type === "sale") {
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
    ctx.font = `800 56px ${FONT_STACK}`;
    const valueLines = wrapText(ctx, valueText, CONTENT_WIDTH - 110, 2);
    const boxH = 114 + valueLines.length * 72 + 40;

    ctx.fillStyle = "#ffffff";
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_WIDTH, boxH, 32);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 4;
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_WIDTH, boxH, 32);
    ctx.stroke();

    ctx.fillStyle = COLORS.blue;
    drawRoundedRect(ctx, MARGIN_X, y, 18, boxH, 9);
    ctx.fill();

    let hy = y + 42;
    ctx.fillStyle = COLORS.blue;
    ctx.font = `800 30px ${FONT_STACK}`;
    ctx.fillText(eyebrow, MARGIN_X + 60, hy);
    hy += 54;

    ctx.fillStyle = COLORS.ink;
    ctx.font = `800 56px ${FONT_STACK}`;
    for (const line of valueLines) {
      ctx.fillText(line, MARGIN_X + 60, hy);
      hy += 72;
    }
    y += boxH;
  }

  // Scan Card: occupies 1/4 of the poster height (~877px), white fill with crisp border for print economy
  const availSpace = footerY - y - 48;
  const qrImg = await qrPromise;
  const expiryTime =
    post.type === "sale" ? (post.endsAt ?? post.deleteAt) : post.deleteAt;

  if (availSpace >= scanCardTargetH) {
    const heroH = scanCardTargetH;
    const heroY = footerY - heroH - 48;

    ctx.fillStyle = "#ffffff";
    drawRoundedRect(ctx, MARGIN_X, heroY, CONTENT_WIDTH, heroH, 40);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 4;
    drawRoundedRect(ctx, MARGIN_X, heroY, CONTENT_WIDTH, heroH, 40);
    ctx.stroke();

    const qrBoxSize = 576;
    const qrSize = qrBoxSize - 48;
    let hy = heroY + 52;

    // Top accent strip inside scan card
    ctx.fillStyle = COLORS.blue;
    drawRoundedRect(ctx, MARGIN_X + 64, hy, 140, 12, 6);
    ctx.fill();
    hy += 32;

    ctx.fillStyle = COLORS.blue;
    ctx.font = `800 34px ${FONT_STACK}`;
    ctx.fillText(meta.scanEyebrow, MARGIN_X + 64, hy);
    hy += 48;

    ctx.fillStyle = COLORS.ink;
    ctx.font = `800 66px ${FONT_STACK}`;
    ctx.fillText(meta.scanHeadline, MARGIN_X + 64, hy);
    hy += 96;

    // QR Code large & crisp
    const qrBoxX = POSTER_WIDTH - MARGIN_X - 64 - qrBoxSize;
    const qrBoxY = hy;

    ctx.fillStyle = "#ffffff";
    drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 32);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 4;
    drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 32);
    ctx.stroke();

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

    const textX = MARGIN_X + 64;
    const textMaxW = qrBoxX - textX - 56;
    let ty = qrBoxY + 18;

    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 44px ${FONT_STACK}`;
    const promptLines = wrapText(ctx, meta.scanPrompt, textMaxW, 4);
    for (const line of promptLines) {
      ctx.fillText(line, textX, ty);
      ty += 62;
    }

    ty += 36;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 34px ${FONT_STACK}`;
    if (post.type === "poll" && post.endsAt) {
      ctx.fillText(
        `${t("Voting closes: ", "投票截止：")}${date(post.endsAt)}`,
        textX,
        ty,
      );
      ty += 50;
    }
    if (expiryTime) {
      ctx.fillText(
        `${post.type === "poll" ? t("Removed: ", "移除时间：") : t("Available until: ", "有效期至：")}${date(expiryTime)}`,
        textX,
        ty,
      );
    }

    // URL pill at bottom-left of hero card
    const urlPillY = qrBoxY + qrBoxSize - 82;
    ctx.fillStyle = "#ffffff";
    drawRoundedRect(ctx, textX, urlPillY, textMaxW, 82, 20);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 3;
    drawRoundedRect(ctx, textX, urlPillY, textMaxW, 82, 20);
    ctx.stroke();

    ctx.fillStyle = COLORS.blue;
    ctx.font = `600 30px ${FONT_STACK}`;
    ctx.textBaseline = "middle";
    const [urlLine] = wrapText(ctx, post.publicUrl, textMaxW - 48, 1);
    ctx.fillText(urlLine ?? "", textX + 24, urlPillY + 42);
    ctx.textBaseline = "top";
  } else {
    // Compact scan card when post has long text / photos / many options
    const scanCardH = Math.min(scanCardTargetH, Math.max(560, availSpace));
    const scanCardY = footerY - scanCardH - 48;

    ctx.fillStyle = "#ffffff";
    drawRoundedRect(ctx, MARGIN_X, scanCardY, CONTENT_WIDTH, scanCardH, 36);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 4;
    drawRoundedRect(ctx, MARGIN_X, scanCardY, CONTENT_WIDTH, scanCardH, 36);
    ctx.stroke();

    const qrSize = 480;
    const qrBoxSize = 516;
    const qrBoxX = POSTER_WIDTH - MARGIN_X - 48 - qrBoxSize;
    const qrBoxY = scanCardY + (scanCardH - qrBoxSize) / 2;

    ctx.fillStyle = "#ffffff";
    drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 28);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 3;
    drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 28);
    ctx.stroke();

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

    const textX = MARGIN_X + 60;
    const textMaxW = qrBoxX - textX - 52;
    let sy = scanCardY + 56;

    ctx.fillStyle = COLORS.blue;
    ctx.font = `800 32px ${FONT_STACK}`;
    ctx.fillText(meta.scanEyebrow, textX, sy);
    sy += 52;

    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 46px ${FONT_STACK}`;
    const promptLines = wrapText(ctx, meta.scanPrompt, textMaxW, 3);
    for (const line of promptLines) {
      ctx.fillText(line, textX, sy);
      sy += 62;
    }

    sy += 20;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 34px ${FONT_STACK}`;
    if (post.type === "poll" && post.endsAt) {
      ctx.fillText(
        `${t("Voting closes: ", "投票截止：")}${date(post.endsAt)}`,
        textX,
        sy,
      );
      sy += 48;
    }
    if (expiryTime) {
      ctx.fillText(
        `${post.type === "poll" ? t("Removed: ", "移除时间：") : t("Available until: ", "有效期至：")}${date(expiryTime)}`,
        textX,
        sy,
      );
    }

    ctx.fillStyle = COLORS.blue;
    ctx.font = `600 30px ${FONT_STACK}`;
    const [urlLine] = wrapText(ctx, post.publicUrl, textMaxW, 1);
    ctx.fillText(urlLine ?? "", textX, scanCardY + scanCardH - 80);
  }

  // Bottom trust/info strip
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, footerY);
  ctx.lineTo(POSTER_WIDTH - MARGIN_X, footerY);
  ctx.stroke();

  const items = [
    t("No account needed", "无需注册账号"),
    t("Local community board", "本地社区公告"),
    t("Auto-expires for privacy", "到期自动清除"),
  ];
  ctx.font = `600 32px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  const fy = footerY + 58;
  for (let i = 0; i < items.length; i++) {
    const ix =
      i === 0
        ? MARGIN_X
        : i === 1
          ? POSTER_WIDTH / 2 - ctx.measureText(items[i]).width / 2 - 16
          : POSTER_WIDTH - MARGIN_X - ctx.measureText(items[i]).width - 28;
    ctx.fillStyle = i === 1 ? COLORS.red : COLORS.blue;
    ctx.beginPath();
    ctx.arc(ix + 10, fy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(items[i], ix + 30, fy + 2);
  }

  return canvas;
}

async function canvasBlobUrl(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image export failed"))),
      "image/png",
    );
  });
  return URL.createObjectURL(blob);
}

export async function generatePosterBlobUrl(post) {
  return canvasBlobUrl(await renderPosterCanvas(post));
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

function hasPublicResults(poll) {
  return (
    !poll.resultsHidden &&
    Number.isSafeInteger(poll.totalVotes) && poll.totalVotes >= 0 &&
    Number.isFinite(poll.endsAt) && Number.isFinite(poll.serverTime) &&
    Array.isArray(poll.options) && poll.options.length > 0 &&
    poll.options.every(({ votes }) => Number.isSafeInteger(votes) && votes >= 0)
  );
}

function renderResultCard(poll) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");
  canvas.width = 1080;
  const left = 56;
  const right = canvas.width - left;
  const width = right - left;
  const locale = intlLocaleFor(language);
  const percentage = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const timestamp = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "shortOffset",
  });
  const titleFont = `800 50px ${FONT_STACK}`;
  const optionFont = `650 32px ${FONT_STACK}`;
  ctx.font = titleFont;
  const titleLines = wrapText(ctx, poll.title, width, Infinity);
  ctx.font = optionFont;
  const rows = poll.options.map((option) => {
    const lines = wrapText(ctx, option.label, width - 204, Infinity);
    return { lines, votes: option.votes, height: Math.max(lines.length * 40 + 46, 104) };
  });
  const totalY = 124 + titleLines.length * 62 + 34;
  const multiple = poll.selectionMode === "multiple";
  const firstRowY = totalY + (multiple ? 96 : 64);
  const footerY = firstRowY + rows.reduce((height, row) => height + row.height, 0);
  canvas.height = footerY + 137;

  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top";
  drawBrandMark(ctx, left, 46, 44);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `800 30px ${FONT_STACK}`;
  ctx.fillText("ScaleTag", left + 58, 53);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.blue;
  ctx.font = `700 27px ${FONT_STACK}`;
  const closed = poll.status === "closed";
  ctx.fillText(closed ? t("Final results", "最终结果") : t("Live results", "实时结果"), right, 55);

  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.ink;
  ctx.font = titleFont;
  titleLines.forEach((line, index) => ctx.fillText(line, left, 124 + index * 62));
  ctx.font = `700 32px ${FONT_STACK}`;
  ctx.fillText(multiple ? t("Ballots submitted", "已提交选票") : t("Total votes", "总票数"), left, totalY);
  ctx.textAlign = "right";
  ctx.fillText(count(poll.totalVotes), right, totalY);
  if (multiple) {
    ctx.font = `500 24px ${FONT_STACK}`;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(t("Share of ballots", "占选票比例"), right, totalY + 41);
  }

  let y = firstRowY;
  for (const { lines, votes, height } of rows) {
    const share = poll.totalVotes ? votes / poll.totalVotes : 0;
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.ink;
    ctx.font = optionFont;
    lines.forEach((line, index) => ctx.fillText(line, left, y + index * 40));
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.blue;
    ctx.font = `800 29px ${FONT_STACK}`;
    ctx.fillText(percentage.format(share), right, y);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 23px ${FONT_STACK}`;
    ctx.fillText(t(`${count(votes)} ${votes === 1 ? "vote" : "votes"}`, `${count(votes)} 票`), right, y + 35);

    ctx.fillStyle = COLORS.pale;
    drawRoundedRect(ctx, left, y + height - 29, width, 12, 6);
    ctx.fill();
    if (share > 0) {
      ctx.fillStyle = COLORS.blue;
      drawRoundedRect(ctx, left, y + height - 29, width * share, 12, 6);
      ctx.fill();
    }
    y += height;
  }

  ctx.fillStyle = COLORS.line;
  ctx.fillRect(left, footerY + 4, width, 2);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 24px ${FONT_STACK}`;
  ctx.textAlign = "left";
  ctx.fillText(closed ? t("Voting closed", "投票已结束") : t("Voting closes", "投票截止时间"), left, footerY + 28);
  ctx.fillText(t("Snapshot time", "结果生成时间"), left, footerY + 65);
  ctx.textAlign = "right";
  ctx.fillText(timestamp.format(poll.endsAt), right, footerY + 28);
  ctx.fillText(timestamp.format(poll.serverTime), right, footerY + 65);
  return canvas;
}

function formatResultText(poll, url) {
  const percentage = new Intl.NumberFormat(intlLocaleFor(language), { style: "percent", maximumFractionDigits: 1 });
  return [
    poll.title,
    poll.status === "closed" ? t("Final results", "最终结果") : t("Live results", "实时结果"),
    ...(poll.selectionMode === "multiple" ? [
      ballotsSubmitted(poll.totalVotes),
      t("Percentages show the share of ballots that selected each option.", "百分比表示选择该选项的选票占比。"),
    ] : [`${t("Total votes", "总票数")}: ${count(poll.totalVotes)}`]),
    ...poll.options.map(({ label, votes }) => {
      const total = t(`${count(votes)} ${votes === 1 ? "vote" : "votes"}`, `${count(votes)} 票`);
      const share = percentage.format(poll.totalVotes ? votes / poll.totalVotes : 0);
      return `${label}: ${total} (${share})`;
    }),
    `${t("Snapshot time", "结果生成时间")}: ${date(poll.serverTime)}`,
    url,
  ].join("\n");
}

export function mountResultExports(host, id, loadResults) {
  const actions = document.createElement("div");
  actions.className = "result-export-actions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button secondary small";
  button.id = "download-result-card";
  button.textContent = t("Download result card", "下载投票结果卡");
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = button.className;
  copy.textContent = t("Copy results as text", "复制文字结果");
  const fallback = document.createElement("label");
  fallback.textContent = t("Results text", "结果文本");
  const field = document.createElement("textarea");
  field.rows = 6;
  field.readOnly = true;
  fallback.append(field);
  actions.append(button, copy, fallback);
  host.append(actions);
  let unavailable = false;

  function resetFallback() {
    fallback.hidden = true;
    field.value = "";
  }
  resetFallback();

  function update(poll) {
    button.hidden = copy.hidden = unavailable || !hasPublicResults(poll);
    if (copy.hidden) resetFallback();
  }

  async function currentResults() {
    // A poll can expire or be withdrawn while its page is open.
    let poll;
    try {
      poll = await loadResults();
    } catch (error) {
      if (error.status === 404) {
        unavailable = true;
        update({ resultsHidden: true });
      }
      throw error;
    }
    if (!actions.isConnected) throw new Error("Poll results are no longer displayed");
    update(poll);
    if (button.hidden) throw new Error("Poll results are unavailable");
    return poll;
  }

  copy.onclick = async () => {
    if (copy.hidden || copy.disabled) return;
    copy.disabled = true;
    resetFallback();
    const text = currentResults().then(poll => formatResultText(poll, `${location.origin}/vote/${id}`));
    try {
      if (globalThis.ClipboardItem && navigator.clipboard?.write) {
        // Start writing inside the click while the public result is fetched.
        const payload = text.then(value => new Blob([value], { type: "text/plain" }));
        payload.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": payload })]);
      } else {
        const value = await text;
        await navigator.clipboard.writeText(value);
      }
      if (copy.isConnected && !copy.hidden) toast(t("Results copied.", "已复制投票结果。"));
    } catch {
      try {
        const value = await text;
        if (!copy.isConnected || copy.hidden) return;
        fallback.hidden = false;
        field.value = value;
        field.focus();
        field.select();
      } catch {
        if (copy.isConnected) toast(t("Could not copy results. Please try again.", "无法复制结果，请重试。"));
      }
    } finally {
      copy.disabled = false;
    }
  };

  button.onclick = async () => {
    button.disabled = true;
    try {
      const poll = await currentResults();
      const url = await canvasBlobUrl(renderResultCard(poll));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ScaleTag-results-${id}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast(t("Could not download the result card. Please try again.", "无法下载投票结果卡，请重试。"));
    } finally {
      button.disabled = false;
    }
  };
  return update;
}
