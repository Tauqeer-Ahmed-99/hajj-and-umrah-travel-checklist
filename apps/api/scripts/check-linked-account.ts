import { accountResponse } from "@nmt/contracts";
import { isDeepStrictEqual } from "node:util";
import { identify } from "../src/identity";

// Opt-in live acceptance check. Obtain these from two actual native sign-ins;
// this script neither performs Google OAuth nor manufactures linked identities.
const emailToken = process.env.CLERK_CHECK_EMAIL_SESSION_TOKEN;
const googleToken = process.env.CLERK_CHECK_GOOGLE_SESSION_TOKEN;
if (!emailToken || !googleToken || emailToken === googleToken) {
  throw new Error(
    "Supply two distinct, active native email/Google session tokens to this check only. Never commit or log them.",
  );
}
const api = new URL(process.argv[2] ?? "https://travel.nmtsolutions.in");
if (
  api.protocol !== "https:" ||
  api.username ||
  api.password ||
  api.pathname !== "/" ||
  api.search ||
  api.hash
)
  throw new Error("Pass an HTTPS API origin without a path or credentials.");

// A live check must never silently use the deterministic provider fixture.
if (process.env.CLERK_API_URL) {
  throw new Error(
    "Unset the fixture's CLERK_API_URL before running a live check.",
  );
}
const accounts = [];
const identities = [];
for (const token of [emailToken, googleToken]) {
  const request = new Request(new URL("/api/me", api), {
    headers: { Authorization: `Bearer ${token}` },
  });
  identities.push(await identify(request));
  const response = await fetch(request, {
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`Account HTTP check failed (${response.status}).`);
  accounts.push(accountResponse.parse(await response.json()));
  if (response.headers.get("cache-control") !== "private, no-store") {
    throw new Error(
      "The account response must remain private and uncacheable.",
    );
  }
}
if (
  identities[0].clerkUserId !== identities[1].clerkUserId ||
  identities[0].email !== identities[1].email
)
  throw new Error(
    "The sessions do not resolve to one verified Clerk identity.",
  );
if (!accounts[0].profile || !accounts[1].profile) {
  throw new Error("Finish the application profile before checking continuity.");
}
if (!isDeepStrictEqual(accounts[0], accounts[1])) {
  throw new Error(
    "The two sign-in methods did not return the same saved member.",
  );
}
console.log(
  "Both real sessions verified; the API returned the same saved member and private account response. No identity, email or token printed.",
);
