export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
    throw new AppError(400, "You can add up to 3 external images.");
  }
  const images = (body.images ?? []).map((v) => {
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

export function replyInput(body) {
  if (!body || typeof body !== "object")
    throw new AppError(400, "Please complete your reply.");
  const message = text(body.message, "Reply", 2000);
  const name = text(body.name || "Anonymous", "Name", 60);
  const phone = text(body.phone ?? "", "Phone", 40, false);
  const email = text(body.email ?? "", "Email", 254, false);
  if (!phone && !email)
    throw new AppError(
      400,
      "Provide a phone number or email address, or both.",
    );
  if (
    phone &&
    (!/^[+0-9(). #x-]+$/i.test(phone) ||
      phone.replace(/\D/g, "").length < 5 ||
      phone.replace(/\D/g, "").length > 20)
  )
    throw new AppError(400, "Enter a valid phone number.");
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    throw new AppError(400, "Enter a valid email address.");
  if (body.contactAccepted !== true)
    throw new AppError(
      400,
      "Please confirm that your reply and contact details will be public.",
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
