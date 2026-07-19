const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class SourceSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceSecretError";
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  try {
    const decoded = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    // Reject alternate encodings whose unused trailing bits decode to the same
    // bytes. This makes envelope text canonical and tamper tests deterministic.
    if (base64UrlEncode(decoded) !== value) {
      throw new SourceSecretError("The source secret envelope is invalid.");
    }
    return decoded;
  } catch {
    throw new SourceSecretError("The source secret envelope is invalid.");
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) {
    throw new SourceSecretError("Source encryption keys must contain at least 32 characters.");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealSourceSecret(
  plaintext: string,
  secret: string,
  randomBytes: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))
): Promise<string> {
  if (!plaintext) throw new SourceSecretError("A source secret cannot be empty.");
  const iv = randomBytes(12);
  if (iv.length !== 12) throw new SourceSecretError("Source secret IVs must be 12 bytes.");
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    await encryptionKey(secret),
    encoder.encode(plaintext)
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function openSourceSecret(envelope: string, secret: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = envelope.split(".");
  if (version !== "v1") throw new SourceSecretError("Unsupported source secret envelope version.");
  if (!encodedIv || !encodedCiphertext || extra) {
    throw new SourceSecretError("The source secret envelope is invalid.");
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(base64UrlDecode(encodedIv)) },
      await encryptionKey(secret),
      toArrayBuffer(base64UrlDecode(encodedCiphertext))
    );
    return decoder.decode(plaintext);
  } catch (error) {
    if (error instanceof SourceSecretError) throw error;
    throw new SourceSecretError("Unable to decrypt the source secret.");
  }
}
