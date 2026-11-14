import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { guideStorage } from "../src/guide-storage";

// Opt-in live provider exercise. Only these newly generated keys are ever removed.
// This is object recovery evidence, not a database backup or family-access test.
const expectedBucket = process.argv[2];
if (!expectedBucket || process.env.R2_BUCKET !== expectedBucket)
  throw new Error(
    "Pass the exact intended R2 bucket name as the only argument.",
  );
if (new URL(process.env.R2_ENDPOINT ?? "").protocol !== "https:")
  throw new Error("This check requires the real HTTPS R2 endpoint.");

const storage = guideStorage();
const prefix = `release-check/${randomUUID()}`;
const keys = ["staging", "immutable", "backup", "restored"].map(
  (name) => `${prefix}/${name}.pdf`,
);
let phase = "prepare";
let failed = false;
try {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("NMT Travel disposable provider recovery check");
  const bytes = Buffer.from(await pdf.save());
  const digest = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  const upload = async (key: string, value: Buffer) => {
    const signed = await storage.authorize(key, {
      fileName: "release-check.pdf",
      mediaType: "application/pdf",
      byteSize: value.length,
    });
    const url = new URL(signed.url);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "120");
    const headers = new Headers();
    for (const [name, value] of Object.entries(signed.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const response = await fetch(signed.url, {
      method: "PUT",
      headers,
      body: new Uint8Array(value),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    assert.equal(response.status, 200);
    await response.body?.cancel();
  };
  phase = "signed upload and immutable copy";
  await upload(keys[0], bytes);
  const head = await storage.head(keys[0]);
  assert.equal(head.ContentLength, bytes.length);
  assert.ok(head.ETag);
  await storage.copy(keys[0], keys[1], head.ETag, "application/pdf");
  phase = "staging overwrite isolation";
  await upload(keys[0], Buffer.from("replacement staging bytes"));
  assert.equal(digest(await storage.bytes(keys[1])), digest(bytes));
  phase = "private signed viewing";
  const view = await storage.authorize(keys[1]);
  const response = await fetch(view.url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  assert.equal(response.status, 200);
  assert.equal(
    digest(new Uint8Array(await response.arrayBuffer())),
    digest(bytes),
  );
  phase = "private cache headers";
  assert.match(
    response.headers.get("cache-control") ?? "",
    /private.*no-store/,
  );
  const unsigned = new URL(view.url);
  unsigned.search = "";
  const denied = await fetch(unsigned, { signal: AbortSignal.timeout(30_000) });
  phase = "anonymous viewing denial";
  // R2's S3 endpoint returns 400 for a missing authorization mechanism, whereas
  // a present but invalid signature returns 403. Neither may disclose bytes.
  assert.ok([400, 401, 403].includes(denied.status));
  await denied.body?.cancel();
  const tampered = new URL(view.url);
  tampered.pathname = tampered.pathname.replace("immutable.pdf", "staging.pdf");
  const wrongKey = await fetch(tampered, {
    signal: AbortSignal.timeout(30_000),
  });
  phase = "tampered signed key denial";
  assert.equal(wrongKey.status, 403);
  await wrongKey.body?.cancel();
  phase = "isolated object backup and restore";
  const immutable = await storage.head(keys[1]);
  assert.ok(immutable.ETag);
  await storage.copy(keys[1], keys[2], immutable.ETag, "application/pdf");
  await storage.remove(keys[1]);
  const backup = await storage.head(keys[2]);
  assert.ok(backup.ETag);
  await storage.copy(keys[2], keys[3], backup.ETag, "application/pdf");
  assert.equal(digest(await storage.bytes(keys[3])), digest(bytes));
  console.log(
    JSON.stringify({
      check: "real-r2-provider",
      bucket: expectedBucket,
      prefix,
      sha256: digest(bytes),
      anonymousStatus: denied.status,
      tamperedStatus: wrongKey.status,
      passed: [
        "signed-put-120s",
        "immutable-copy-survives-staging-overwrite",
        "signed-get",
        "anonymous-and-tampered-key-denied",
        "isolated-object-backup-restore",
      ],
    }),
  );
} catch (error) {
  failed = true;
  console.error(
    `R2 provider check failed during ${phase}; no credentials printed.`,
  );
  if (error instanceof assert.AssertionError)
    console.error(
      `Assertion ${error.operator}; expected ${JSON.stringify(error.expected)}, observed ${JSON.stringify(error.actual)}.`,
    );
} finally {
  const cleanup = await Promise.allSettled(
    keys.map((key) => storage.remove(key)),
  );
  if (cleanup.some((result) => result.status === "rejected")) {
    failed = true;
    console.error(
      `Cleanup incomplete: inspect only task-owned prefix ${prefix}.`,
    );
  } else {
    console.log(`Removed only the four task-owned keys under ${prefix}.`);
  }
}
if (failed) process.exitCode = 1;
