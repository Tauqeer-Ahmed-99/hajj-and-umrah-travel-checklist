# Current service setup

These resources were created on November 14, 2026. Their existence does not
establish production or native acceptance. Use Vercel account
`tauqeer-ahmed-99`, team `tauqeerahmed99s-projects`; the default CLI account is
different and must not be used for this application.

| Service    | Resource             | Dashboard                                                                                                                                                             |
| ---------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel API | `nmt-travel-api`     | [Project](https://vercel.com/tauqeerahmed99s-projects/nmt-travel-api)                                                                                                 |
| Neon       | `nmt-travel-db`      | [Vercel resource](https://vercel.com/tauqeerahmed99s-projects/~/integrations/neon/icfg_SEEdxuMZmz1r0PGKSpqo2sgT/resources/storage/store_JbANWhmxn3nGUqfm/guides)      |
| Clerk      | `nmt-travel`         | [Vercel resource](https://vercel.com/tauqeerahmed99s-projects/~/integrations/clerk/icfg_b4t6wPTG0Yjxsu9ECS97Wlpx/resources/authentication/ir_RUNidSEePN3VWmdD/guides) |
| Private R2 | `nmt-travel-private` | [Bucket settings](https://dash.cloudflare.com/0d2ad4278f04cbbfd3123a756c9683c1/r2/default/buckets/nmt-travel-private/settings)                                        |

## Configuration verified

Neon uses the Free plan in Singapore (`sin1`). Neon Auth and Realtime are off;
the application uses Clerk and its existing API. All 17 migration files have
been applied and replayed successfully on the selected database. Its connection
value is saved in the API project's Preview/Production Secrets; a deployment
using it has not been verified. An isolated branch recovery exercise restored
the task trip, permissions and permitted file access after source deletion;
that task branch and its disposable identities were subsequently removed.
Existing unrelated databases were not changed. See [release evidence](release.md).

Clerk uses Hobby with no paid add-ons and production domain
`travel.nmtsolutions.in`. Both development and production instances have email
verification codes for signup and login, require verified email, and have password
signup and password addition disabled. Native applications are enabled. The
Android package `in.nmtsolutions.travel` is registered in both with the existing
EAS preview signing SHA-256 recorded in [Google sign-in](google-sign-in.md). The
actual preview APK certificate now matches that registered identity. First and last
names are not required by Clerk; the application's profile gate owns them.

Clerk's user permission to delete an account directly is disabled in both
instances before creating app users. App removal must perform the responsibility
checks and recoverable provider operation described by the account-removal slice;
the Clerk administration API remains available to that implementation.

R2 uses Standard storage in Asia-Pacific. It has no custom domain and its public
development URL is disabled. Credential `nmt-travel-api` grants Object Read &
Write only for this bucket. Its values are held outside the repository in a
restricted operator file and the API project's Preview/Production Secrets. They
are absent from mobile configuration; the hosted API still needs a rebuild.
Actual signed PUT/GET, immutable copy/overwrite isolation, anonymous and
tampered-key denial, and isolated object copy/restore passed. The real API also
uploaded, finalized and viewed a private PDF, rejected another family's access,
and rejected fresh authorization after revocation. These checks used disposable
development identities. Referenced immutable objects are retained deliberately;
account removal never deletes their bytes. Existing buckets/tokens were not
changed. Physical viewing and production checks remain separate.

## Google OAuth preparation

Google Cloud project `nmt-travel` has no linked billing account. Its NMT Travel
OAuth consent configuration is created for an External audience in Testing mode,
using the signed-in owner's support/contact address. The owner is the one
configured test user. The Web client is
`25995067202-352dv27r48c33djo27i3kmi601kgl3eh.apps.googleusercontent.com`;
the Android client is
`25995067202-efm67oepebtu1k68jut0i0glnnpeshkv.apps.googleusercontent.com`,
for `in.nmtsolutions.travel` and the verified preview certificate SHA-1.
Both Clerk instances now use custom Web credentials, with signup/signin enabled
and only basic identity scopes. Exact callbacks are
`https://polite-reptile-6620.clerk.accounts.dev/v1/oauth_callback` and
`https://clerk.travel.nmtsolutions.in/v1/oauth_callback`.
Production branding/domain/consent requirements and physical Google/email
continuity remain unverified. Existing unrelated Google projects were not changed.

Firebase was enabled on this existing Google project using Spark/no-cost, with
Analytics off. Its Android app is
`1:25995067202:android:ce29a907a261c36e2512db`. The dedicated service account
`nmt-travel-expo-push@nmt-travel.iam.gserviceaccount.com` has only the Firebase
Cloud Messaging API admin role. Its private key is assigned to this EAS Android
application for FCM V1, separate from the public Android client configuration in
the EAS preview environment. The API's Expo Push access token is still missing:
normal Expo owner email-code sign-in required a factor that expired unanswered.
Remote push dispatch remains disabled; no real delivery pass is claimed.

## Production DNS still pending

The domain's nameservers resolve to Cloudflare. The currently signed-in
Cloudflare account has R2 but no DNS zones, and its account switcher lists only
that account. Old recent-page shortcuts did not establish DNS access. A secure
request for a token scoped to DNS editing of `nmtsolutions.in` expired without a
response. No DNS record was changed.

Clerk supplied the following CNAMEs. Inspect existing records before creating
them, use DNS-only mode, and leave unrelated records unchanged.

| Name within `nmtsolutions.in` | Target                              |
| ----------------------------- | ----------------------------------- |
| `clerk.travel`                | `frontend-api.clerk.services`       |
| `accounts.travel`             | `accounts.clerk.services`           |
| `clkmail.travel`              | `mail.sltwyh3z1q0q.clerk.services`  |
| `clk._domainkey.travel`       | `dkim1.sltwyh3z1q0q.clerk.services` |
| `clk2._domainkey.travel`      | `dkim2.sltwyh3z1q0q.clerk.services` |

After authorized DNS changes, verify all five in the production Clerk dashboard
and wait for its frontend/account-portal certificates. API hosting for the travel
domain is a separate configuration step; it has not been completed here.

## Remaining release work

The intended Vercel API project exists with seven consumed values saved as
Secrets for Preview/Production, using development Clerk for hosted preview
verification. Its default public hostname still serves older source `8d72647`;
an unauthenticated JSON 401 is not provider acceptance. Rebuilding reviewed source
`b716cc3` required a fresh Vercel authenticator code; the secure request expired,
and verification and the pending redeploy were canceled. Complete that rebuild,
then verify authenticated hosted API/cron, production DNS/OAuth and notification
delivery. Correct-account UI settings and exact commands are in
[release acceptance](release.md). No server secret belongs in Expo public config.

An internal signed preview APK and compatible preview OTA were built on normal
EAS/Linux hosts. Actual APK/certificate/Hermes/runtime/secret inspection passed.
A task-owned headless Android 16 Play Store emulator installed it and received
the compatible update on next start. This exposed and verified a fix for a
native Clerk token-callback render loop. A second signed Firebase-configured APK
has a distinct runtime and versionCode 2; install-r preserved the account, cached
trip and saved PDF across disconnected cold starts. Reconnected real-provider
reads verified the same identity, quantities, bag and private PDF hash. These are
supplemental emulator results; no physical Android device is attached. Exact
build/source/artifact identities are in [release evidence](release.md). Windows
Hermes policy was not changed.
Physical Google/email continuity, lifecycle/offline/SAF, accessibility/Arabic,
install/upgrade and OTA journeys remain launch gates. Public production release
and production OTA wait for those gates and the parent's final review/fixes.
