import {
  fileOperationInput,
  openFileInput,
  travelFileInput,
  travelFileQuery,
  travelFileVisibility,
  uploadDetails,
} from "@nmt/contracts";
import { requireMember } from "./permissions";
import { failure, HttpError, json } from "./response";
import { readJson } from "./input";
import { guideParse } from "./guide-http";
import {
  accessTravelFile,
  authorizeTravelUpload,
  beginTravelFile,
  finalizeTravelUpload,
  listTravelFiles,
  pendingTravelUploads,
  readTravelFile,
  replaceTravelFile,
  shareTravelFile,
} from "./travel-files";

type Context = {
  params: Promise<{ tripId: string; fileId?: string; operation?: string[] }>;
};
export async function travelFilesHttp(request: Request, context: Context) {
  try {
    const member = await requireMember(request),
      { tripId, fileId, operation = [] } = await context.params;
    const path = operation.join("/");
    if (!fileId) {
      if (request.method === "GET")
        return json(
          await listTravelFiles(
            member,
            tripId,
            guideParse(
              travelFileQuery,
              Object.fromEntries(new URL(request.url).searchParams),
            ),
          ),
        );
      if (request.method === "POST")
        return json(
          await beginTravelFile(
            member,
            tripId,
            guideParse(travelFileInput, await readJson(request, "file")),
          ),
          201,
        );
    } else {
      if (request.method === "GET" && !path)
        return json(await readTravelFile(member, tripId, fileId));
      if (request.method === "GET" && path === "uploads")
        return json(await pendingTravelUploads(member, tripId, fileId));
      if (request.method === "POST") {
        const body = await readJson(request, "file");
        if (path === "visibility")
          return json(
            await shareTravelFile(
              member,
              tripId,
              fileId,
              guideParse(travelFileVisibility, body),
            ),
          );
        if (path === "uploads")
          return json(
            await replaceTravelFile(
              member,
              tripId,
              fileId,
              guideParse(uploadDetails, body),
            ),
            201,
          );
        if (path === "open" || path === "access") {
          const { version } = guideParse(openFileInput, body);
          return json(
            await accessTravelFile(
              member,
              tripId,
              fileId,
              version,
              path === "open",
            ),
          );
        }
        if (operation.length === 3 && operation[0] === "uploads") {
          guideParse(fileOperationInput, body);
          if (operation[2] === "authorize")
            return json(
              await authorizeTravelUpload(member, tripId, fileId, operation[1]),
            );
          if (operation[2] === "finalize")
            return json(
              await finalizeTravelUpload(member, tripId, fileId, operation[1]),
            );
        }
      }
    }
    throw new HttpError(
      404,
      "not_found",
      "This file operation is not available.",
    );
  } catch (error) {
    return failure(
      error,
      "The file request could not be confirmed. Reconnect and explicitly retry the same upload.",
    );
  }
}
