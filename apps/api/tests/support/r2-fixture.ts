// Controlled S3 HTTP provider boundary, not a production R2 emulator or domain fake.
import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
const secret = "fixture-r2-secret";
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
function presigned(req: IncomingMessage, url: URL) {
  const p = url.searchParams,
    signature = p.get("X-Amz-Signature"),
    date = p.get("X-Amz-Date") ?? "";
  if (!signature) return !!req.headers.authorization;
  const credential = (p.get("X-Amz-Credential") ?? "").split("/");
  const issued = Date.parse(
    date.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      "$1-$2-$3T$4:$5:$6Z",
    ),
  );
  if (
    Date.now() > issued + Number(p.get("X-Amz-Expires")) * 1000 ||
    credential[0] !== "fixture-access"
  )
    return false;
  const headers = (p.get("X-Amz-SignedHeaders") ?? "").split(";");
  const canonical = [
    req.method,
    url.pathname,
    [...p]
      .filter(([k]) => k !== "X-Amz-Signature")
      .map(([k, v]) => [encode(k), encode(v)])
      .sort(([a, av], [b, bv]) =>
        a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1,
      )
      .map(([k, v]) => `${k}=${v}`)
      .join("&"),
    headers
      .map((k) => `${k}:${String(req.headers[k] ?? "").trim()}\n`)
      .join(""),
    headers.join(";"),
    p.get("X-Amz-Content-Sha256") ?? "UNSIGNED-PAYLOAD",
  ].join("\n");
  const scope = credential.slice(1).join("/");
  const key = hmac(
    hmac(
      hmac(hmac(`AWS4${secret}`, credential[1]), credential[2]),
      credential[3],
    ),
    "aws4_request",
  );
  const expected = hmac(
    key,
    `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`,
  ).toString("hex");
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}
export async function startR2Fixture() {
  const objects = new Map<string, { bytes: Buffer; type: string }>();
  let available = true;
  let copyRace: Buffer | undefined;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`),
        key = decodeURIComponent(url.pathname);
      const error = (status: number, code: string) =>
        res
          .writeHead(status, { "Content-Type": "application/xml" })
          .end(`<Error><Code>${code}</Code></Error>`);
      if (!available) {
        error(503, "ServiceUnavailable");
        return;
      }
      if (!presigned(req, url)) {
        error(403, "SignatureDoesNotMatch");
        return;
      }
      const copy = req.headers["x-amz-copy-source"];
      if (req.method === "PUT" && copy) {
        const sourceKey = decodeURIComponent(String(copy));
        if (copyRace) {
          objects.set(sourceKey, { bytes: copyRace, type: "application/pdf" });
          copyRace = undefined;
        }
        const source = objects.get(sourceKey);
        if (!source) {
          error(404, "NoSuchKey");
          return;
        }
        if (
          req.headers["x-amz-copy-source-if-match"] !==
          `"${hash(source.bytes)}"`
        ) {
          error(412, "PreconditionFailed");
          return;
        }
        objects.set(key, {
          bytes: Buffer.from(source.bytes),
          type: String(req.headers["content-type"] ?? source.type),
        });
        res
          .writeHead(200, { "Content-Type": "application/xml" })
          .end(
            `<CopyObjectResult><ETag>"${hash(source.bytes)}"</ETag><LastModified>2026-11-14T00:00:00Z</LastModified></CopyObjectResult>`,
          );
        return;
      }
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        objects.set(key, {
          bytes: Buffer.concat(chunks),
          type: String(req.headers["content-type"] ?? ""),
        });
        res.writeHead(200).end();
        return;
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204).end();
        return;
      }
      const value = objects.get(key);
      if (!value) {
        error(404, "NoSuchKey");
        return;
      }
      if (!["GET", "HEAD"].includes(req.method ?? "")) {
        error(405, "MethodNotAllowed");
        return;
      }
      res.writeHead(200, {
        "Content-Type": value.type,
        "Content-Length": value.bytes.length,
        ETag: `"${hash(value.bytes)}"`,
      });
      res.end(req.method === "HEAD" ? undefined : value.bytes);
    } catch {
      res.writeHead(500).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No R2 port");
  return {
    env: {
      R2_ENDPOINT: `http://127.0.0.1:${address.port}`,
      R2_BUCKET: "private-guides",
      R2_ACCESS_KEY_ID: "fixture-access",
      R2_SECRET_ACCESS_KEY: secret,
    },
    available: (value: boolean) => {
      available = value;
    },
    raceCopy: (bytes: Buffer) => {
      copyRace = bytes;
    },
    replaceUploadedObject: (url: string, bytes: Buffer) => {
      const key = decodeURIComponent(new URL(url).pathname);
      const previous = objects.get(key);
      if (!previous) throw Error("Upload the object first");
      objects.set(key, { ...previous, bytes });
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
