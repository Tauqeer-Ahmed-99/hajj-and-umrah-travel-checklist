# Mobile onboarding and profile recovery

The November 16 follow-up screenshot was a post-authentication API failure. A real Clerk development session against `https://nmt-travel-api.vercel.app/api/me` reproduced HTTP 503 `service_unavailable`. After the user completed Vercel verification, redeploying the reviewed API with the saved production configuration restored HTTP 200. The native rebuild addresses onboarding and recovery; the server deployment resolves the reproduced profile failure.

Production deployment [4SndUtX9W](https://vercel.com/tauqeerahmed99s-projects/nmt-travel-api/4SndUtX9WpbczgCudpQqS9m6Drkc) uses source `3a52a54a86da53feae43c0ff61dd29cbaa23e5cf`. Its API and contracts match the subsequent mobile commits. Live authenticated checks passed profile load, save, an identical save retry, read-back from a new session, protected trip listing, username immutability and rejection of unauthenticated requests. The disposable identity was removed through the application and Clerk confirmed removal completion. This verifies the real NMT Clerk/Neon HTTP path; it does not substitute for real Google identity or mailbox delivery acceptance.

## Interaction and visual direction

Preserve the approved palette: navy `#0D1324`, indigo `#253FC7`, lavender `#ACBAFF`, light canvas `#F4F6FF`, and light ink `#17213B`. Keep Geist, with 32/39 headings, 16/25 supporting text and 16/24 button labels. The welcome illustration depicts travel preparation rather than a fabricated trip. Other screens use left-aligned, focused forms without workspace branding, connectivity banners or form cards.

The native stack contains Welcome → sign-in choice → email → verification code. Google remains available from the choice screen. Authentication replaces that stack with the protected workspace, so Back cannot return to a completed verification attempt. Profile setup asks for names and then a username. Existing profile gating, verified identity, username reservations, uncertain-save recovery and private-data cleanup remain enforced.

One real text input supports OTP paste/autofill and exposes the code to accessibility services; six decorative slots display it. A keyboard-aware scrolling layout keeps the primary action reachable on Android. Inputs focus after navigation settles. Primary buttons retain the existing 120 ms press feedback; screen movement uses the native stack, with reduced-motion behavior. Light, dark and system preferences remain in Account only.

Profile recovery separates a server outage from offline and expired-session states. Retry remains the primary action. Sign out is a text action; account-removal recovery is available under Help. Cached entry points require a previously completed profile. A failed refresh keeps the recovery screen mounted while retrying.

## Evidence and limits

- Workspace TypeScript and Android JavaScript export passed.
- All 15 real HTTP/PostgreSQL profile tests passed, including restart persistence, same-member continuity, invalid sessions, username races and uncertain retries.
- An x86_64 debug APK with native Screens compiled and ran on the owned Android emulator. One official Google Maven artifact required a task-local repository after a DNS failure; its bytes and POM were verified against Google's checksums. No system DNS or security settings changed.
- Native development-key email-code signup recovered from an incorrect code, accepted the development test code, completed both profile steps, saved to the supplied Neon database, opened Trips and restored the same member after app and API restart. This uses a controlled `+clerk_test` identity, not real email delivery.
- The Android keyboard exposed a covered Continue action during the first pass. The corrected layout was inspected with the keyboard open. Name-step validation was also corrected after the native journey found an extra-field rejection.
- Native Google UI opened and cancellation returned to the sign-in screen with an email alternative. Actual Google identity completion is not claimed.
- Light welcome/forms and dark sign-in/Account were inspected. Dark preference survived app restart and logout. No appearance controls are rendered on auth screens.
- Expo Doctor ran 20 checks; its remote schema check could not complete because `exp.host` DNS failed. This is not a 20/20 claim.
- Production `/api/me` changed from 503 to 200 after deployment. Real profile save/read-back and protected trip listing passed. The saved production environment alone was not sufficient evidence; these checks ran against the public API after the deployment became Ready.

The new native navigation dependency requires a new binary and runtime. Version code 5 is reserved for this preview; do not send these native changes as an OTA to version 4.

[EAS preview 5](https://expo.dev/accounts/tauqeerahmed/projects/nmt-travel/builds/842cb0a3-7595-4e43-aa56-6eb95cd37d88) was submitted from `bc88bd864fc83254f82b7d317b2b35882576681a` and remains queued. Both that source CI run and the subsequent Maestro-selector update CI passed. Artifact download, signature/runtime/secret inspection and a signed upgrade check remain pending. Automatic approval review rejected the command preparing and installing the cached version 4 APK for a fresh emulator recheck with only “blocked by policy”; that command was not retried. The seven live HTTP checks above succeeded independently.

Physical Android, TalkBack, real mailbox delivery, real Google linking and signed-release motion acceptance still require separate evidence.
