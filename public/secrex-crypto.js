const PROTOCOL_VERSION = "secrex-v1";
const ID_BYTES = 16;
const PASSWORD_BYTES = 32;
const DEK_BYTES = 32;
const SESSION_BYTES = 32;
const CLAIM_BYTES = 32;
const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const INFO_CLAIM = encoder.encode("secrex-v1-claim");
const INFO_WRAP = encoder.encode("secrex-v1-wrap");
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function requireSubtle() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "WebCrypto is unavailable in this browser context. Open Secrex over HTTPS or localhost.",
    );
  }
  return subtle;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function wipe(bytes) {
  if (bytes instanceof Uint8Array) bytes.fill(0);
}

export function encodeBase64Url(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Expected Uint8Array.");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(value, expectedLength) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) {
    throw new Error("Invalid base64url value.");
  }
  if (value.length % 4 === 1) {
    throw new Error("Invalid base64url length.");
  }
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (encodeBase64Url(bytes) !== value) {
    wipe(bytes);
    throw new Error("Non-canonical base64url value.");
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    wipe(bytes);
    throw new Error("Unexpected base64url byte length.");
  }
  return bytes;
}

export function isValidId(id) {
  try {
    decodeBase64Url(id, ID_BYTES);
    return true;
  } catch {
    return false;
  }
}

export function isValidPassword(password) {
  try {
    const bytes = decodeBase64Url(password, PASSWORD_BYTES);
    wipe(bytes);
    return true;
  } catch {
    return false;
  }
}

export function generateSessionToken() {
  const bytes = randomBytes(SESSION_BYTES);
  try {
    return encodeBase64Url(bytes);
  } finally {
    wipe(bytes);
  }
}

// Length-prefixed AAD uniquely binds protocol version, secret ID, and AES-GCM purpose.
function buildAad(id, purpose) {
  const parts = [
    encoder.encode(PROTOCOL_VERSION),
    encoder.encode(id),
    encoder.encode(purpose),
  ];
  let total = 0;
  for (const part of parts) total += 4 + part.length;
  const aad = new Uint8Array(total);
  const view = new DataView(aad.buffer);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.length, false);
    offset += 4;
    aad.set(part, offset);
    offset += part.length;
  }
  return aad;
}

async function importHkdfKey(subtle, passwordBytes) {
  return subtle.importKey("raw", passwordBytes, "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ]);
}

async function deriveClaimFromKey(subtle, baseKey, idBytes) {
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: idBytes, info: INFO_CLAIM },
    baseKey,
    CLAIM_BYTES * 8,
  );
  const claimBytes = new Uint8Array(bits);
  try {
    return encodeBase64Url(claimBytes);
  } finally {
    wipe(claimBytes);
  }
}

async function deriveWrapKey(subtle, baseKey, idBytes, usage) {
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: idBytes, info: INFO_WRAP },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export async function deriveClaim(id, password) {
  const subtle = requireSubtle();
  let passwordBytes;
  try {
    const idBytes = decodeBase64Url(id, ID_BYTES);
    passwordBytes = decodeBase64Url(password, PASSWORD_BYTES);
    const baseKey = await importHkdfKey(subtle, passwordBytes);
    return await deriveClaimFromKey(subtle, baseKey, idBytes);
  } finally {
    wipe(passwordBytes);
  }
}

export async function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Enter the secret text to encrypt.");
  }
  const subtle = requireSubtle();
  const idBytes = randomBytes(ID_BYTES);
  const id = encodeBase64Url(idBytes);
  const passwordBytes = randomBytes(PASSWORD_BYTES);
  const dekBytes = randomBytes(DEK_BYTES);
  const bodyNonceBytes = randomBytes(NONCE_BYTES);
  const wrapNonceBytes = randomBytes(NONCE_BYTES);
  const plaintextBytes = encoder.encode(plaintext);

  try {
    const password = encodeBase64Url(passwordBytes);
    const baseKey = await importHkdfKey(subtle, passwordBytes);
    const [claim, wrapKey, dekKey] = await Promise.all([
      deriveClaimFromKey(subtle, baseKey, idBytes),
      deriveWrapKey(subtle, baseKey, idBytes, "encrypt"),
      subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, false, [
        "encrypt",
      ]),
    ]);

    const [bodyBuffer, wrappedBuffer] = await Promise.all([
      subtle.encrypt(
        {
          name: "AES-GCM",
          iv: bodyNonceBytes,
          additionalData: buildAad(id, "body"),
        },
        dekKey,
        plaintextBytes,
      ),
      subtle.encrypt(
        {
          name: "AES-GCM",
          iv: wrapNonceBytes,
          additionalData: buildAad(id, "wrap"),
        },
        wrapKey,
        dekBytes,
      ),
    ]);

    return {
      id,
      password,
      payload: {
        id,
        claim,
        body: encodeBase64Url(new Uint8Array(bodyBuffer)),
        bodyNonce: encodeBase64Url(bodyNonceBytes),
        wrapped: encodeBase64Url(new Uint8Array(wrappedBuffer)),
        wrapNonce: encodeBase64Url(wrapNonceBytes),
      },
    };
  } finally {
    wipe(passwordBytes);
    wipe(dekBytes);
    wipe(plaintextBytes);
  }
}

export async function decryptSecret({
  id,
  password,
  body,
  bodyNonce,
  wrapped,
  wrapNonce,
}) {
  const subtle = requireSubtle();
  let passwordBytes;
  let dekBytes;
  let plaintextBytes;
  try {
    const idBytes = decodeBase64Url(id, ID_BYTES);
    passwordBytes = decodeBase64Url(password, PASSWORD_BYTES);
    const bodyNonceBytes = decodeBase64Url(bodyNonce, NONCE_BYTES);
    const wrapNonceBytes = decodeBase64Url(wrapNonce, NONCE_BYTES);
    const wrappedBytes = decodeBase64Url(wrapped, DEK_BYTES + GCM_TAG_BYTES);
    const bodyBytes = decodeBase64Url(body);
    if (bodyBytes.length <= GCM_TAG_BYTES) {
      throw new Error("Invalid encrypted secret payload.");
    }

    const baseKey = await importHkdfKey(subtle, passwordBytes);
    const wrapKey = await deriveWrapKey(subtle, baseKey, idBytes, "decrypt");
    const dekBuffer = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: wrapNonceBytes,
        additionalData: buildAad(id, "wrap"),
      },
      wrapKey,
      wrappedBytes,
    );
    dekBytes = new Uint8Array(dekBuffer);
    if (dekBytes.length !== DEK_BYTES) {
      throw new Error("Invalid unwrapped key length.");
    }
    const dekKey = await subtle.importKey(
      "raw",
      dekBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const plaintextBuffer = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bodyNonceBytes,
        additionalData: buildAad(id, "body"),
      },
      dekKey,
      bodyBytes,
    );
    plaintextBytes = new Uint8Array(plaintextBuffer);
    return decoder.decode(plaintextBytes);
  } finally {
    wipe(passwordBytes);
    wipe(dekBytes);
    wipe(plaintextBytes);
  }
}
