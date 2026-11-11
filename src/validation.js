export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Task progress. "completed" and "closed" are final and stop new replies.
export const TASK_STATES = ["open", "in_progress", "completed", "closed"];
export const FINAL_TASK_STATES = ["completed", "closed"];
// 256-bit random management key, hex-encoded.
export const MANAGE_KEY_PATTERN = /^[a-f0-9]{64}$/;

// The key travels only in a POST body; never in the URL or logs.
export function manageKeyInput(body) {
  const key = body && typeof body === "object" ? body.key : undefined;
  if (typeof key !== "string" || !MANAGE_KEY_PATTERN.test(key))
    throw new AppError(403, "This management link is invalid for this task.");
  return key;
}

export function taskStateInput(body) {
  const key = manageKeyInput(body);
  if (!TASK_STATES.includes(body.state))
    throw new AppError(400, "Choose a valid task status.");
  return { key, state: body.state };
}

function text(value, name, max, required = true) {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  ) {
    throw new AppError(
      400,
      `${name} ${required ? "is required and " : ""}must be at most ${max} characters.`,
    );
  }
  return value.trim();
}

export function coordinates(value) {
  if (
    !value ||
    typeof value.latitude !== "number" ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude) ||
    Math.abs(value.latitude) > 90 ||
    Math.abs(value.longitude) > 180
  ) {
    throw new AppError(
      400,
      "A valid GPS location is required. Allow location access and try again.",
    );
  }
  return { latitude: value.latitude, longitude: value.longitude };
}

function baseInput(body) {
  if (!body || typeof body !== "object")
    throw new AppError(400, "Please complete the poll form.");
  const title = text(body.title, "Title", 140);
  const description = text(body.description ?? "", "Description", 4000, false);
  const signature = text(body.signature, "Signature", 60);
  if (!Array.isArray(body.images ?? []) || (body.images?.length ?? 0) > 3) {
    throw new AppError(400, "Upload at most 3 images.");
  }
  const images = (body.images ?? []).map((v) => {
    // Only creation routes accept bounded upload data. Full decoding and
    // metadata removal happen asynchronously before any document is stored.
    if (typeof v === "string" && v.startsWith("data:")) {
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v) ||
          v.length > Math.ceil(1048576 / 3) * 4 + 32)
        throw new AppError(400, "Each image must be a JPEG, PNG or WebP no larger than 1 MiB.");
      return v;
    }
    const raw = text(v, "Image URL", 2048);
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new AppError(400, "Enter a valid HTTPS image URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new AppError(
        400,
        "Images require HTTPS URLs without login credentials.",
      );
    }
    return url.href;
  });
  if (body.retentionAccepted !== true)
    throw new AppError(400, "Please acknowledge the data retention policy.");
  return {
    title,
    description,
    signature,
    images,
    // Existing polls and clients stay off the map unless they explicitly opt in.
    mapVisible: body.mapVisible === true,
    location: coordinates(body.location),
  };
}

export function pollInput(body) {
  const common = baseInput(body);
  if (
    !Array.isArray(body.options) ||
    body.options.length < 2 ||
    body.options.length > 12
  ) {
    throw new AppError(400, "Provide between 2 and 12 options.");
  }
  const options = body.options.map((v) => text(v, "Option", 120));
  if (
    new Set(options.map((v) => v.toLocaleLowerCase())).size !== options.length
  ) {
    throw new AppError(400, "Options must be unique.");
  }
  return { ...common, options };
}

export function taskInput(body) {
  if (!body || typeof body !== "object")
    throw new AppError(400, "Please complete the task form.");
  // Share publication validation; task content has no voting options.
  const common = baseInput({
    ...body,
    signature: body.signature || "Anonymous",
  });
  return {
    ...common,
    type: "task",
    options: [],
    description: text(body.description, "Description", 4000),
    reward: text(body.reward, "Reward", 160),
  };
}

// Reply names and messages are public. These patterns catch the common ways
// people paste an email address or phone number into a public field. They are
// a safety net, not a guarantee: dates, prices and times are deliberately not
// matched (e.g. "2026-11-09 10:00" or "CAD 30").
const PUBLIC_EMAIL_PATTERN = /[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i;
const PUBLIC_PHONE_PATTERN =
  /(?:^|[^\d])(?:\+\d[\d\s()/.#x-]{7,}\d|\(?\d{3}\)?[\s/.-]?\d{3}[\s/.-]?\d{4}|\d{3}[\s/.-]\d{4})(?!\d)/i;
export function looksLikeContact(value) {
  const normalized = value.normalize("NFKC");
  return PUBLIC_EMAIL_PATTERN.test(normalized) || PUBLIC_PHONE_PATTERN.test(normalized);
}
export const CONTACT_IN_PUBLIC_TEXT =
  "Your name and message are public. Remove the phone number or email address from them. If this task offers private contact fields, use those instead.";
export const LEGACY_TASK_NO_REPLIES =
  "This older task has no private management link, so its poster cannot retrieve contact details. It no longer accepts replies.";
export const LEGACY_TASK_CONTACTS = LEGACY_TASK_NO_REPLIES;
export const REPLY_CONTACT_REQUIRED =
  "Provide a phone number or email address, or both. Only the task creator can see them.";

// Validates reply fields. New replies require a task with a private management link;
// legacy tasks without one cannot accept replies because contacts cannot be retrieved.
export function replyInput(body) {
  if (!body || typeof body !== "object")
    throw new AppError(400, "Please complete your reply.");
  const message = text(body.message, "Reply", 2000);
  const name = text(body.name || "Anonymous", "Name", 60);
  const phone = text(body.phone ?? "", "Phone", 40, false);
  const email = text(body.email ?? "", "Email", 254, false);
  if (looksLikeContact(message) || looksLikeContact(name))
    throw new AppError(400, CONTACT_IN_PUBLIC_TEXT);
  if (
    phone &&
    (!/^[+0-9(). #x-]+$/i.test(phone) ||
      phone.replace(/\D/g, "").length < 5 ||
      phone.replace(/\D/g, "").length > 20)
  )
    throw new AppError(400, "Enter a valid phone number.");
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    throw new AppError(400, "Enter a valid email address.");
  // A new acknowledgement field: older clients that showed the previous
  // "contact details are public" notice must reload to see the current terms.
  if (body.privacyAccepted !== true)
    throw new AppError(
      400,
      "Please confirm that your name and message will be public and that contact details stay private to the task creator. Reload the page if you do not see this notice.",
    );
  return { message, name, phone, email };
}

export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}


export function saleInput(body) {
  const common = baseInput({ ...body, images: [], signature: body?.signature || "Anonymous" });
  return { ...common, type: "sale", options: [],
    description: text(body.description, "Description", 4000),
    pickupLocation: text(body.pickupLocation, "Pickup location", 300), giveawayVersion: 1 };
}
export function offerInput(body) {
  const reply = replyInput(body);
  if (body.nonBindingAccepted !== true)
    throw new AppError(400, "Confirm that your offer is non-binding communication only. ScaleTag does not handle payments, transactions, reservations or completed sales.");
  const amount = text(body.amount, "Offer", 160);
  if (looksLikeContact(amount)) throw new AppError(400, CONTACT_IN_PUBLIC_TEXT);
  // An offer is a price, never a free-text public contact channel. Permit
  // a plain nonnegative decimal with one optional currency prefix/suffix.
  const number = "(?:0|[1-9]\\d{0,8}|[1-9]\\d{0,2}(?:,\\d{3}){1,2})(?:\\.\\d{1,2})?";
  const currency = "(?:[A-Z]{3}|[A-Z]{0,2}\\$|[€£¥])";
  if (!new RegExp(`^(?:${number}|${currency}\\s*${number}|${number}\\s+${currency})$`).test(amount))
    throw new AppError(400, "Enter a nonnegative offer amount with up to two decimal places and an optional currency, for example CAD 40 or $40.50. Keep contact details in the private fields.");
  return { ...reply, amount };
}
