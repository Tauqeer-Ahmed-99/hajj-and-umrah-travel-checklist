import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GUIDE_FILE_LIMIT, type UploadDetails } from "@nmt/contracts";
import { HttpError } from "./response";

// Configuration is resolved only after file-route authorization. No other feature requires R2.
export function guideStorage() {
  const {
    R2_ENDPOINT: endpoint,
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = process.env;
  let valid = false;
  try {
    const url = new URL(endpoint ?? "");
    valid =
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      ((url.protocol === "https:" &&
        /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname)) ||
        (process.env.NODE_ENV !== "production" &&
          url.protocol === "http:" &&
          url.hostname === "127.0.0.1"));
  } catch {}
  if (
    !valid ||
    !bucket ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
    !accessKeyId ||
    !secretAccessKey
  )
    throw new HttpError(
      503,
      "file_unavailable",
      "File storage is not configured. Your incomplete upload can be retried later.",
    );
  const client = new S3Client({
    endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 2,
  });
  const expiresIn = 120;
  const authorize = async (
    key: string,
    details?: Omit<UploadDetails, "requestId">,
  ) => ({
    method: details ? "PUT" : "GET",
    url: await getSignedUrl(
      client,
      details
        ? new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: details.mediaType,
            ContentLength: details.byteSize,
          })
        : new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ResponseCacheControl: "private, no-store",
            ResponseContentDisposition: "inline",
          }),
      {
        expiresIn,
        signableHeaders: new Set(["content-type", "content-length"]),
      },
    ),
    headers: details
      ? {
          "Content-Type": details.mediaType,
          "Content-Length": String(details.byteSize),
        }
      : {},
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  });
  return {
    authorize,
    head: async (key: string) =>
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    copy: async (source: string, key: string, etag: string, type: string) =>
      client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: key,
          CopySource: `/${bucket}/${source}`,
          CopySourceIfMatch: etag,
          MetadataDirective: "REPLACE",
          ContentType: type,
          CacheControl: "private, no-store",
          ContentDisposition: "inline",
        }),
      ),
    remove: async (key: string) =>
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    bytes: async (key: string) => {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!result.Body)
        throw new HttpError(
          409,
          "upload_incomplete",
          "Upload this file before finishing.",
        );
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > GUIDE_FILE_LIMIT)
            throw new HttpError(
              422,
              "invalid_file",
              "Files must be no larger than 20 MB.",
            );
          chunks.push(Buffer.from(chunk));
        }
      } finally {
        if (
          "destroy" in result.Body &&
          typeof result.Body.destroy === "function"
        )
          result.Body.destroy();
      }
      return Buffer.concat(chunks);
    },
  };
}
