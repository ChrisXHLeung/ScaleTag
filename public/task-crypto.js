const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getSubtle() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto API is not available');
  }
  return globalThis.crypto.subtle;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || !/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error('Task credential must contain exactly 64 hexadecimal characters');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid base64 payload');
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importPasswordHkdfKey(password) {
  const subtle = getSubtle();
  return subtle.importKey('raw', hexToBytes(password), 'HKDF', false, ['deriveBits', 'deriveKey']);
}

export async function deriveTaskAuthKey(password) {
  const subtle = getSubtle();
  const baseKey = await importPasswordHkdfKey(password);
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('scaletag:task:hkdf-salt:v1'),
      info: encoder.encode('scaletag:task:auth-key:v1'),
    },
    baseKey,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

async function derivePrivateKeyWrappingKey(password, saltBytes) {
  const subtle = getSubtle();
  const baseKey = await importPasswordHkdfKey(password);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: encoder.encode('scaletag:task:private-key-wrap:v1'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createTaskCredentials() {
  const subtle = getSubtle();
  const password = bytesToHex(randomBytes(32));
  const authKey = await deriveTaskAuthKey(password);
  const keyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const spkiBuffer = await subtle.exportKey('spki', keyPair.publicKey);
  const pkcs8Buffer = await subtle.exportKey('pkcs8', keyPair.privateKey);
  const contactPublicKey = bytesToBase64(new Uint8Array(spkiBuffer));

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrappingKey = await derivePrivateKeyWrappingKey(password, salt);
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(`scaletag:task:private-key-aad:v1:${contactPublicKey}`),
    },
    wrappingKey,
    pkcs8Buffer,
  );

  return {
    password,
    authKey,
    contactPublicKey,
    encryptedPrivateKey: {
      version: 1,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    },
  };
}

export async function unwrapTaskPrivateKey(password, contactPublicKey, encryptedPrivateKey) {
  const subtle = getSubtle();
  if (typeof contactPublicKey !== 'string' || !contactPublicKey) {
    throw new Error('Missing task contact public key');
  }
  const envelope = typeof encryptedPrivateKey === 'string'
    ? JSON.parse(encryptedPrivateKey)
    : encryptedPrivateKey;
  if (!envelope || envelope.version !== 1) {
    throw new Error('Unsupported encrypted private key version');
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) {
    throw new Error('Invalid encrypted private key envelope');
  }

  const wrappingKey = await derivePrivateKeyWrappingKey(password, salt);
  const pkcs8Buffer = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(`scaletag:task:private-key-aad:v1:${contactPublicKey}`),
    },
    wrappingKey,
    ciphertext,
  );

  return subtle.importKey(
    'pkcs8',
    pkcs8Buffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

async function deriveReplyCipherKey(sharedBits, iv, contactPublicKey, ephemeralPublicKey, context) {
  const subtle = getSubtle();
  const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: iv,
      info: encoder.encode(`scaletag:task:reply-contact-key:v1:${contactPublicKey}:${ephemeralPublicKey}:${context}`),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptReplyContact(contactPublicKey, contact, context = '') {
  const subtle = getSubtle();
  if (typeof contactPublicKey !== 'string' || !contactPublicKey) {
    throw new Error('Missing task contact public key');
  }
  const payload = {};
  if (typeof contact?.phone === 'string' && contact.phone.trim()) {
    payload.phone = contact.phone.trim();
  }
  if (typeof contact?.email === 'string' && contact.email.trim()) {
    payload.email = contact.email.trim();
  }
  if (!payload.phone && !payload.email) {
    throw new Error('Reply contact must include a phone number or email address');
  }

  const recipientPublicKey = await subtle.importKey(
    'spki',
    base64ToBytes(contactPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ephemeralKeyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const ephemeralSpki = await subtle.exportKey('spki', ephemeralKeyPair.publicKey);
  const ephemeralPublicKey = bytesToBase64(new Uint8Array(ephemeralSpki));
  const sharedBits = await subtle.deriveBits(
    { name: 'ECDH', public: recipientPublicKey },
    ephemeralKeyPair.privateKey,
    256,
  );

  const iv = randomBytes(12);
  const cipherKey = await deriveReplyCipherKey(sharedBits, iv, contactPublicKey, ephemeralPublicKey, context);
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(`scaletag:task:reply-contact-aad:v1:${contactPublicKey}:${ephemeralPublicKey}:${context}`),
    },
    cipherKey,
    encoder.encode(JSON.stringify(payload)),
  );

  return {
    version: 1,
    ephemeralPublicKey,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptReplyContacts(password, task, context = '') {
  const subtle = getSubtle();
  if (!task || typeof task !== 'object') {
    throw new Error('Missing task payload');
  }
  const { contactPublicKey, encryptedPrivateKey, replies } = task;
  if (!Array.isArray(replies)) {
    throw new Error('Task replies must be an array');
  }
  const privateKey = await unwrapTaskPrivateKey(password, contactPublicKey, encryptedPrivateKey);

  const decryptedReplies = [];
  for (const reply of replies) {
    if (!reply?.encryptedContact) {
      decryptedReplies.push({ ...reply });
      continue;
    }
    const envelope = typeof reply.encryptedContact === 'string'
      ? JSON.parse(reply.encryptedContact)
      : reply.encryptedContact;
    if (!envelope || envelope.version !== 1) {
      throw new Error('Unsupported encrypted contact version');
    }
    const iv = base64ToBytes(envelope.iv);
    const ciphertext = base64ToBytes(envelope.ciphertext);
    if (iv.length !== 12 || ciphertext.length < 17) {
      throw new Error('Invalid encrypted contact envelope');
    }
    const senderEphemeralKey = await subtle.importKey(
      'spki',
      base64ToBytes(envelope.ephemeralPublicKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const sharedBits = await subtle.deriveBits(
      { name: 'ECDH', public: senderEphemeralKey },
      privateKey,
      256,
    );
    const cipherKey = await deriveReplyCipherKey(
      sharedBits,
      iv,
      contactPublicKey,
      envelope.ephemeralPublicKey,
      context,
    );
    const plaintext = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: encoder.encode(`scaletag:task:reply-contact-aad:v1:${contactPublicKey}:${envelope.ephemeralPublicKey}:${context}`),
      },
      cipherKey,
      ciphertext,
    );
    const contact = JSON.parse(decoder.decode(plaintext));
    decryptedReplies.push({
      ...reply,
      phone: contact.phone,
      email: contact.email,
      encryptedContact: undefined,
    });
  }
  return decryptedReplies;
}
