import { createClerkClient } from "@clerk/backend";
import { parsePublishableKey } from "@clerk/shared/keys";
import { profileInput, type ProfileInput } from "@nmt/contracts";
import { HttpError } from "./response";

let client: ReturnType<typeof createClerkClient> | undefined;
export async function identify(request: Request) {
  if (!/^Bearer \S+$/i.test(request.headers.get("authorization") ?? "")) {
    throw new HttpError(401, "invalid_session", "Sign in to continue.");
  }
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey)
    throw new Error("The API requires its Clerk keys.");
  const key = parsePublishableKey(publishableKey, { fatal: true });
  client ??= createClerkClient({
    secretKey,
    publishableKey,
    // The HTTP integration fixture controls only Clerk's external boundary.
    // Production always uses Clerk's real Backend API.
    apiUrl:
      process.env.NODE_ENV === "production"
        ? undefined
        : process.env.CLERK_API_URL,
  });
  const state = await client.authenticateRequest(request, {
    acceptsToken: "session_token",
    issuer: `https://${key.frontendApi}`,
  });
  if (!state.isAuthenticated) {
    console.warn("Session rejected", { reason: state.reason });
    if (state.reason === "jwk-remote-failed-to-load") {
      throw new HttpError(
        503,
        "identity_unavailable",
        "We could not check your session. Try again when connected.",
      );
    }
    throw new HttpError(
      401,
      "invalid_session",
      "Your session has ended. Sign in again.",
    );
  }
  const auth = state.toAuth();
  if (!auth.userId || !auth.sessionId)
    throw new HttpError(401, "invalid_session", "Sign in again.");
  // Native bearer tokens can omit azp. Validate it after signature verification
  // when present; cookies are deliberately not accepted by this native API.
  if (
    auth.sessionClaims.azp &&
    auth.sessionClaims.azp !== "https://travel.nmtsolutions.in"
  ) {
    throw new HttpError(401, "invalid_session", "Sign in from NMT Travel.");
  }
  let user;
  let session;
  try {
    [user, session] = await Promise.all([
      client.users.getUser(auth.userId),
      client.sessions.getSession(auth.sessionId),
    ]);
  } catch (error) {
    console.warn("Identity provider request failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    if (
      typeof error === "object" &&
      error &&
      "status" in error &&
      error.status === 404
    ) {
      throw new HttpError(
        401,
        "invalid_session",
        "Your session has ended. Sign in again.",
      );
    }
    throw new HttpError(
      503,
      "identity_unavailable",
      "We could not check your account. Try again when connected.",
    );
  }
  if (
    session.status !== "active" ||
    session.userId !== auth.userId ||
    user.banned ||
    user.locked
  ) {
    throw new HttpError(
      401,
      "invalid_session",
      "Your session has ended. Sign in again.",
    );
  }
  const email = user.emailAddresses.find(
    (email) =>
      email.id === user.primaryEmailAddressId &&
      email.verification?.status === "verified",
  );
  if (!email)
    throw new HttpError(
      403,
      "email_unverified",
      "Verify your email address before completing your profile.",
    );
  const profileDefaults: Partial<ProfileInput> = {};
  const google = user.externalAccounts.find(
    (account) =>
      (account.provider === "google" || account.provider === "oauth_google") &&
      account.verification?.status === "verified",
  );
  for (const field of ["firstName", "lastName", "username"] as const) {
    const parsed = profileInput.shape[field].safeParse(user[field]);
    const fallback = profileInput.shape[field].safeParse(google?.[field]);
    if (parsed.success) profileDefaults[field] = parsed.data;
    else if (fallback.success) profileDefaults[field] = fallback.data;
  }
  return {
    clerkUserId: auth.userId,
    email: email.emailAddress,
    profileDefaults,
  };
}
