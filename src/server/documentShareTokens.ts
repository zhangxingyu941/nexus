import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ATTACHMENT_SIGNATURE_TTL_MS = 5 * 60_000;
const SHARE_TOKEN_NAMESPACE = "document-share\0";
const ATTACHMENT_SIGNATURE_NAMESPACE = "document-share-attachment\0";

interface AttachmentSignatureInput {
  expiresAt: number;
  objectKey: string;
  shareId: string;
  signature: string;
}

export class DocumentShareTokenService {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!secret.trim() || Buffer.byteLength(secret, "utf8") < 32) {
      throw new TypeError("Document share secret must be at least 32 UTF-8 bytes");
    }
  }

  createRawToken() {
    return randomBytes(32).toString("base64url");
  }

  hashRawToken(token: string) {
    return createHmac("sha256", this.secret)
      .update(SHARE_TOKEN_NAMESPACE)
      .update(token)
      .digest("hex");
  }

  signAttachment(shareId: string, objectKey: string, shareExpiresAt: number) {
    const expiresAt = Math.min(
      shareExpiresAt,
      this.now() + ATTACHMENT_SIGNATURE_TTL_MS,
    );

    return {
      expiresAt,
      signature: this.createAttachmentSignature(shareId, objectKey, expiresAt),
    };
  }

  verifyAttachment({
    expiresAt,
    objectKey,
    shareId,
    signature,
  }: AttachmentSignatureInput) {
    if (
      !Number.isSafeInteger(expiresAt)
      || expiresAt <= this.now()
      || !/^[a-f0-9]{64}$/.test(signature)
    ) {
      return false;
    }

    const expected = Buffer.from(
      this.createAttachmentSignature(shareId, objectKey, expiresAt),
      "hex",
    );
    const received = Buffer.from(signature, "hex");

    return expected.byteLength === received.byteLength
      && timingSafeEqual(expected, received);
  }

  private createAttachmentSignature(
    shareId: string,
    objectKey: string,
    expiresAt: number,
  ) {
    return createHmac("sha256", this.secret)
      .update(ATTACHMENT_SIGNATURE_NAMESPACE)
      .update(shareId)
      .update("\0")
      .update(objectKey)
      .update("\0")
      .update(String(expiresAt))
      .digest("hex");
  }
}
