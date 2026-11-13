import {
  accountResponse,
  type Account,
  type ApiError,
  type ProfileInput,
} from "@nmt/contracts";
import { travelFetch } from "./trip-cache";

export class AccountError extends Error {
  constructor(
    message: string,
    public status = 0,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
export function apiOrigin() {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && !(__DEV__ && url.protocol === "http:"))
      return null;
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export async function accountRequest(
  token: string,
  signal: AbortSignal,
  profile?: ProfileInput,
): Promise<Account> {
  const origin = apiOrigin();
  if (!origin)
    throw new AccountError(
      "This build could not connect to NMT Travel. Contact the person who shared it.",
    );
  const response = await travelFetch(`${origin}/api/me`, {
    method: profile ? "PUT" : "GET",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(profile ? { "Content-Type": "application/json" } : {}),
    },
    ...(profile ? { body: JSON.stringify(profile) } : {}),
  });
  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = await response.json();
    } catch {}
    throw new AccountError(
      error?.error?.message ??
        "Your profile could not be loaded or saved. Try again.",
      response.status,
      error?.error?.fields,
    );
  }
  const parsed = accountResponse.safeParse(await response.json());
  if (!parsed.success)
    throw new AccountError("We could not read your saved profile. Try again.");
  return parsed.data;
}
