import { copyAccessResponse } from "@nmt/contracts";
import { guideRequest } from "./guide-api";
export const guideCopyApi = {
  access: (
    tripId: string,
    id: string,
    version: number,
    token: string,
    signal: AbortSignal,
  ) =>
    guideRequest(
      tripId,
      `/${id}/copy-access`,
      token,
      signal,
      copyAccessResponse,
      "POST",
      { version },
    ),
};
