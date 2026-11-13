import { Directory, File, FileMode, Paths } from "expo-file-system";
import { StorageAccessFramework as SAF } from "expo-file-system/legacy";
import { randomUUID } from "expo-crypto";
import { Platform } from "react-native";
import {
  guideRecord,
  memberProfile,
  type GuideRecord,
  type MemberProfile,
} from "@nmt/contracts";
import { guideCopyApi } from "./guide-copy-api";
import { guideFileApi } from "./guide-file-api";
import { TripError } from "./trip-api";

const root = () => new Directory(Paths.document, "nmt-guide-copies");
export type CopySession = {
  accountId: string;
  directory: Directory;
  controller: AbortController;
  generations: Map<string, number>;
  saving: Set<string>;
};
export type SavedGuide = {
  format: 1;
  guide: GuideRecord;
  byteSize: number;
  sha256: string;
  savedAt: number;
  latestVersion: number;
  directory: Directory;
  file: File;
};
export type CopyProgress = { phase: string; bytes: number; total: number };
export type CopyReporter = (progress: CopyProgress) => void;
let active: CopySession | null = null;
const listeners = new Set<() => void>();
export function subscribeGuideCopies(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const changed = () => {
  for (const listener of listeners) listener();
};
const key = (tripId: string, id: string) => `${tripId}:${id}`;
export function assertCopySession(session: CopySession, signal?: AbortSignal) {
  if (
    active !== session ||
    session.controller.signal.aborted ||
    signal?.aborted
  )
    throw new TripError("Copy cancelled. Choose Save again when ready.");
}
export function startGuideCopies(accountId: string): CopySession {
  active?.controller.abort();
  active = null;
  // Only one account's copies are retained. The path contains no identity-supplied
  // separators. All cleanup is confined to this feature's private directory.
  const name = `account-${Array.from(new TextEncoder().encode(accountId), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const base = root();
  if (base.exists && new File(base, "discard").exists) base.delete();
  base.create({ intermediates: true, idempotent: true });
  for (const entry of base.list()) if (entry.name !== name) entry.delete();
  const directory = new Directory(base, name);
  directory.create({ idempotent: true });
  for (const entry of directory.list())
    if (
      entry.name.startsWith("pending-") ||
      (entry instanceof Directory && new File(entry, "revoked").exists)
    )
      entry.delete();
  const session: CopySession = {
    accountId,
    directory,
    controller: new AbortController(),
    generations: new Map(),
    saving: new Set(),
  };
  active = session;
  return session;
}
export function clearGuideCopies() {
  active?.controller.abort();
  active = null;
  changed();
  const base = root();
  if (base.exists) {
    // An interrupted cleanup must also discard bytes on the next same-account
    // sign-in; otherwise a failed deletion could resurrect old saved manifests.
    new File(base, "discard").writeSync("discard");
    base.delete();
  }
  clearGuideViewCache();
  changed();
}
export function clearSessionGuideCopies(session: CopySession) {
  assertCopySession(session);
  session.controller.abort();
  changed();
  new File(root(), "discard").writeSync("discard");
  for (const entry of session.directory.list()) entry.delete();
  new File(root(), "discard").delete();
  session.controller = new AbortController();
  for (const [id, generation] of session.generations)
    session.generations.set(id, generation + 1);
  changed();
}
export function stopGuideCopies(session: CopySession) {
  if (active === session) clearGuideCopies();
  else session.controller.abort();
}
export function clearGuideViewCache() {
  const cache = new Directory(Paths.cache, "nmt-guide-view");
  if (cache.exists) cache.delete();
}
export function rememberCopyProfile(
  session: CopySession,
  profile: MemberProfile,
) {
  assertCopySession(session);
  const existing = restoreCopyProfile(session);
  if (existing?.id === profile.id) return;
  if (existing) clearSessionGuideCopies(session);
  const pending = new File(session.directory, "profile.pending");
  pending.writeSync(JSON.stringify(memberProfile.parse(profile)));
  // Small synchronous rename is the publication point, after a complete write.
  pending.moveSync(new File(session.directory, "profile.json"), {
    overwrite: true,
  });
}
export function restoreCopyProfile(session: CopySession): MemberProfile | null {
  assertCopySession(session);
  try {
    return memberProfile.parse(
      JSON.parse(new File(session.directory, "profile.json").textSync()),
    );
  } catch {
    return null;
  }
}
function manifests(session: CopySession): SavedGuide[] {
  assertCopySession(session);
  const result: SavedGuide[] = [];
  for (const directory of session.directory.list()) {
    if (
      !(directory instanceof Directory) ||
      !directory.name.startsWith("ready-") ||
      new File(directory, "revoked").exists
    )
      continue;
    try {
      const value = JSON.parse(new File(directory, "manifest.json").textSync());
      const guide = guideRecord.parse(value.guide);
      if (
        value.format !== 1 ||
        !["file", "text"].includes(guide.kind) ||
        (guide.kind === "file" && !guide.file) ||
        !Number.isSafeInteger(value.byteSize) ||
        value.byteSize < 1 ||
        value.byteSize > 20_000_000 ||
        !/^[a-f0-9]{64}$/.test(value.sha256) ||
        !Number.isSafeInteger(value.savedAt) ||
        !Number.isSafeInteger(value.latestVersion) ||
        value.latestVersion < guide.version
      )
        continue;
      if (
        guide.kind === "file" &&
        (value.sha256 !== guide.file!.sha256 ||
          value.byteSize !== guide.file!.byteSize)
      )
        continue;
      const file = new File(
        directory,
        guide.kind === "text"
          ? "content.txt"
          : `content.${guide.file!.mediaType === "application/pdf" ? "pdf" : guide.file!.mediaType.split("/")[1]}`,
      );
      // Advisory metadata has its own publication file. A failed/crashed refresh
      // must never invalidate the immutable manifest of a good saved copy.
      let latestVersion = value.latestVersion;
      try {
        const status = JSON.parse(
          new File(directory, "status.json").textSync(),
        );
        if (Number.isSafeInteger(status.latestVersion))
          latestVersion = Math.max(latestVersion, status.latestVersion);
      } catch {}
      result.push({ ...value, latestVersion, guide, directory, file });
    } catch {
      /* An incomplete/corrupt manifest never establishes availability. */
    }
  }
  return result;
}
async function verify(copy: SavedGuide) {
  if (
    !copy.file.exists ||
    copy.file.size !== copy.byteSize ||
    (await copy.file.digest("SHA-256")) !== copy.sha256
  )
    throw new TripError(
      "Saved bytes could not be verified. Reconnect and explicitly save this guide again.",
    );
  if (
    copy.guide.kind === "text" &&
    (await copy.file.text()) !== copy.guide.text
  )
    throw new TripError("The saved note does not match its version.");
}
export async function listSavedGuides(session: CopySession, tripId?: string) {
  const copies = new Map<string, SavedGuide>();
  for (const copy of manifests(session).sort((a, b) => b.savedAt - a.savedAt)) {
    if (tripId && copy.guide.tripId !== tripId) continue;
    const id = key(copy.guide.tripId, copy.guide.id);
    if (copies.has(id)) continue;
    try {
      await verify(copy);
      assertCopySession(session);
      if (savedGuideRemoved(copy)) continue;
      copies.set(id, copy);
    } catch (error) {
      assertCopySession(
        session,
      ); /* Keep an older verified candidate if the new one is damaged. */
    }
  }
  return [...copies.values()];
}
export async function openSavedGuide(
  session: CopySession,
  tripId: string,
  id: string,
) {
  const copy = (await listSavedGuides(session, tripId)).find(
    (c) => c.guide.id === id,
  );
  if (!copy)
    throw new TripError(
      "No verified offline copy is available. Connect and choose Save offline in app.",
    );
  assertCopySession(session);
  if (savedGuideRemoved(copy))
    throw new TripError(
      "This saved version was removed. Refresh saved guides.",
    );
  return copy;
}
export function removeSavedGuide(
  session: CopySession,
  tripId: string,
  id: string,
) {
  assertCopySession(session);
  const idKey = key(tripId, id);
  session.generations.set(idKey, (session.generations.get(idKey) ?? 0) + 1);
  for (const copy of manifests(session))
    if (copy.guide.tripId === tripId && copy.guide.id === id) {
      new File(copy.directory, "revoked").writeSync("removed");
      changed();
      copy.directory.delete();
    }
  changed();
}
export function savedGuideRemoved(copy: SavedGuide) {
  return !copy.directory.exists || new File(copy.directory, "revoked").exists;
}
// Every entry is checked independently against its historical version. A failed
// provider/network request or an omitted search result is never a revocation.
export async function refreshSavedGuideAccess(
  session: CopySession,
  token: string,
  signal: AbortSignal,
) {
  assertCopySession(session, signal);
  try {
    for (const entry of session.directory.list())
      if (entry instanceof Directory && new File(entry, "revoked").exists)
        entry.delete();
  } catch {
    throw new TripError(
      "A removed guide is hidden, but private file cleanup failed. Retry Refresh saved permissions or sign out to clear it.",
    );
  }
  let unavailable = 0;
  const copies = manifests(session);
  for (const copy of copies) {
    assertCopySession(session, signal);
    try {
      const access = await guideCopyApi.access(
        copy.guide.tripId,
        copy.guide.id,
        copy.guide.version,
        token,
        signal,
      );
      assertCopySession(session, signal);
      if (!copy.directory.exists) continue;
      const pending = new File(copy.directory, "status.pending");
      pending.writeSync(
        JSON.stringify({ latestVersion: access.latestVersion }),
      );
      pending.moveSync(new File(copy.directory, "status.json"), {
        overwrite: true,
      });
    } catch (error) {
      assertCopySession(session, signal);
      if (error instanceof TripError && [403, 404].includes(error.status)) {
        const idKey = key(copy.guide.tripId, copy.guide.id);
        session.generations.set(
          idKey,
          (session.generations.get(idKey) ?? 0) + 1,
        );
        if (copy.directory.exists) {
          new File(copy.directory, "revoked").writeSync("revoked");
          changed();
          try {
            copy.directory.delete();
          } catch {
            throw new TripError(
              "Guide access was removed. This copy is hidden, but private file cleanup failed. Retry Refresh saved permissions or sign out to clear it.",
            );
          }
        }
        changed();
      } else if (error instanceof TripError && error.status === 401) {
        clearSessionGuideCopies(session);
        throw error;
      } else unavailable++;
    }
  }
  changed();
  return unavailable;
}
const manifest = ({
  guide,
  byteSize,
  sha256,
  savedAt,
  latestVersion,
}: Omit<SavedGuide, "format" | "directory" | "file">) => ({
  format: 1 as const,
  guide,
  byteSize,
  sha256,
  savedAt,
  latestVersion,
});

async function prepare(
  session: CopySession,
  tripId: string,
  id: string,
  version: number,
  token: string,
  signal: AbortSignal,
  report: CopyReporter,
) {
  assertCopySession(session, signal);
  const access = await guideCopyApi.access(tripId, id, version, token, signal);
  assertCopySession(session, signal);
  const guide = access.guide;
  const directory = new Directory(session.directory, `pending-${randomUUID()}`);
  directory.create();
  const file = new File(
    directory,
    guide.kind === "text"
      ? "content.txt"
      : `content.${guide.file!.mediaType === "application/pdf" ? "pdf" : guide.file!.mediaType.split("/")[1]}`,
  );
  try {
    if (guide.kind === "text") {
      const bytes = new TextEncoder().encode(guide.text);
      report({ phase: "Saving note", bytes: 0, total: bytes.length });
      await file.write(bytes);
      assertCopySession(session, signal);
      report({
        phase: "Verifying note",
        bytes: bytes.length,
        total: bytes.length,
      });
    } else {
      const opened = await guideFileApi.open(
        tripId,
        id,
        version,
        token,
        signal,
      );
      assertCopySession(session, signal);
      if (
        opened.file.id !== guide.file!.id ||
        opened.file.sha256 !== guide.file!.sha256
      )
        throw new TripError(
          "The file version changed. Refresh and choose Save again.",
        );
      const transfer = new AbortController(),
        abort = () => transfer.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        await File.downloadFileAsync(opened.authorization.url, file, {
          headers: opened.authorization.headers,
          signal: transfer.signal,
          onProgress: ({ bytesWritten }) => {
            if (bytesWritten > guide.file!.byteSize) {
              transfer.abort();
              return;
            }
            report({
              phase: "Receiving file",
              bytes: bytesWritten,
              total: guide.file!.byteSize,
            });
          },
        });
      } finally {
        signal.removeEventListener("abort", abort);
      }
    }
    assertCopySession(session, signal);
    const byteSize = file.size,
      sha256 = await file.digest("SHA-256");
    assertCopySession(session, signal);
    if (
      guide.kind === "file" &&
      (byteSize !== guide.file!.byteSize || sha256 !== guide.file!.sha256)
    )
      throw new TripError(
        "The file did not arrive intact. Previous saved copy retained; choose Save again.",
      );
    const copy: SavedGuide = {
      format: 1,
      guide,
      byteSize,
      sha256,
      savedAt: Date.now(),
      latestVersion: access.latestVersion,
      directory,
      file,
    };
    await verify(copy);
    // Refresh permission after receiving bytes and before publishing or exporting.
    await guideCopyApi.access(tripId, id, version, token, signal);
    assertCopySession(session, signal);
    return copy;
  } catch (error) {
    if (directory.exists) directory.delete();
    throw error;
  }
}
async function operation<T>(
  session: CopySession,
  tripId: string,
  id: string,
  signal: AbortSignal,
  run: (signal: AbortSignal, check: () => void) => Promise<T>,
) {
  assertCopySession(session, signal);
  const idKey = key(tripId, id),
    generation = session.generations.get(idKey) ?? 0;
  if (session.saving.has(idKey))
    throw new TripError("A copy action is already running for this guide.");
  session.saving.add(idKey);
  const controller = new AbortController(),
    abort = () => controller.abort();
  const sessionSignal = session.controller.signal;
  signal.addEventListener("abort", abort);
  sessionSignal.addEventListener("abort", abort);
  const check = () => {
    assertCopySession(session, controller.signal);
    if ((session.generations.get(idKey) ?? 0) !== generation)
      throw new TripError("Copy cancelled because saved access changed.");
  };
  try {
    return await run(controller.signal, check);
  } catch (error) {
    // A definitive denial cancels other in-flight work and removes managed bytes.
    if (
      active === session &&
      error instanceof TripError &&
      [403, 404].includes(error.status)
    )
      removeSavedGuide(session, tripId, id);
    if (
      active === session &&
      error instanceof TripError &&
      error.status === 401
    )
      clearSessionGuideCopies(session);
    if (controller.signal.aborted)
      throw new TripError(
        "Copy cancelled. Any previous permitted saved version is retained. Choose Save again when ready.",
      );
    throw error;
  } finally {
    session.saving.delete(idKey);
    signal.removeEventListener("abort", abort);
    sessionSignal.removeEventListener("abort", abort);
  }
}
export function saveGuideOffline(
  session: CopySession,
  tripId: string,
  id: string,
  version: number,
  token: string,
  signal: AbortSignal,
  report: CopyReporter,
) {
  return operation(session, tripId, id, signal, async (signal, check) => {
    if (!restoreCopyProfile(session))
      throw new TripError(
        "Refresh your completed profile in Account before saving offline, so saved guides can reopen after a restart.",
      );
    const copy = await prepare(
      session,
      tripId,
      id,
      version,
      token,
      signal,
      report,
    );
    try {
      const previous = manifests(session).filter(
        (c) => c.guide.tripId === tripId && c.guide.id === id,
      );
      copy.savedAt = Math.max(
        Date.now(),
        ...previous.map((c) => c.savedAt + 1),
      );
      await new File(copy.directory, "manifest.json").write(
        JSON.stringify(manifest(copy)),
      );
      await verify(copy);
      check();
      // Same-filesystem synchronous rename publishes complete immutable bytes and
      // manifest together. A crash before this leaves an ignored pending directory;
      // a crash afterwards leaves the previous verified version as a fallback.
      copy.directory.rename(`ready-${randomUUID()}`);
      copy.file = new File(copy.directory, copy.file.name);
      report({
        phase: "Available offline",
        bytes: copy.byteSize,
        total: copy.byteSize,
      });
      for (const old of previous) {
        try {
          if (old.directory.exists) old.directory.delete();
        } catch {}
      }
      changed();
      return copy;
    } finally {
      if (copy.directory.name.startsWith("pending-") && copy.directory.exists)
        copy.directory.delete();
    }
  });
}
export function exportGuideToDevice(
  session: CopySession,
  tripId: string,
  id: string,
  version: number,
  token: string,
  signal: AbortSignal,
  report: CopyReporter,
) {
  return operation(session, tripId, id, signal, async (signal, check) => {
    if (Platform.OS !== "android")
      throw new TripError("Device export is available on Android.");
    const copy = await prepare(
      session,
      tripId,
      id,
      version,
      token,
      signal,
      report,
    );
    let destination: File | undefined;
    try {
      report({
        phase: "Choose a device folder",
        bytes: 0,
        total: copy.byteSize,
      });
      const permission = await SAF.requestDirectoryPermissionsAsync();
      check();
      if (!permission.granted)
        throw new TripError("Download cancelled. No device file was saved.");
      await guideCopyApi.access(tripId, id, version, token, signal);
      check();
      const name = copy.guide.file?.fileName ?? `${copy.guide.title}.txt`;
      const safeName = name
        .replace(/[\x00-\x1f\x7f/\\]/g, "_")
        .replace(/\.[^.]+$/, "");
      destination = new File(
        await SAF.createFileAsync(
          permission.directoryUri,
          `${safeName}-v${version}`,
          copy.guide.file?.mediaType ?? "text/plain",
        ),
      );
      check();
      const input = copy.file.open(FileMode.ReadOnly);
      let output: ReturnType<File["open"]> | undefined;
      let written = 0;
      try {
        output = destination.open(FileMode.Truncate);
        while (written < copy.byteSize) {
          check();
          const bytes = await input.readBytes(
            Math.min(65536, copy.byteSize - written),
          );
          if (!bytes.length)
            throw new TripError("The device copy was interrupted.");
          check();
          await output.writeBytes(bytes);
          written += bytes.length;
          report({
            phase: "Writing device file",
            bytes: written,
            total: copy.byteSize,
          });
        }
      } finally {
        input.close();
        output?.close();
      }
      check();
      report({
        phase: "Checking device file",
        bytes: written,
        total: copy.byteSize,
      });
      if ((await destination.digest("SHA-256")) !== copy.sha256)
        throw new TripError("The device file did not verify. Download again.");
      check();
      report({
        phase: "Downloaded to chosen folder",
        bytes: written,
        total: copy.byteSize,
      });
      destination = undefined; // Explicit exports are user-owned, not recallable.
    } catch (error) {
      if (destination) {
        try {
          destination.delete();
        } catch {
          throw new TripError(
            "Download failed. A partial file may remain in the chosen folder; remove it in Files before trying again.",
          );
        }
      }
      throw error;
    } finally {
      if (copy.directory.exists) copy.directory.delete();
    }
  });
}
