import { identify } from "../src/identity";

// Only this explicit service check consumes a real short-lived session token.
const token = process.env.CLERK_CHECK_SESSION_TOKEN;
if (!token)
  throw new Error(
    "Supply CLERK_CHECK_SESSION_TOKEN for this provider check only. Never commit it.",
  );
await identify(
  new Request("https://travel.nmtsolutions.in/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  }),
);
console.log(
  "Clerk signature, issuer, active session and verified primary email check passed. No profile data printed.",
);
