# Current service setup

These resources were created on November 14, 2026. Their existence does not
establish production or native acceptance. Use Vercel account
`tauqeer-ahmed-99`, team `tauqeerahmed99s-projects`; the default CLI account is
different and must not be used for this application.

| Service    | Resource             | Dashboard                                                                                                                                                             |
| ---------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon       | `nmt-travel-db`      | [Vercel resource](https://vercel.com/tauqeerahmed99s-projects/~/integrations/neon/icfg_SEEdxuMZmz1r0PGKSpqo2sgT/resources/storage/store_JbANWhmxn3nGUqfm/guides)      |
| Clerk      | `nmt-travel`         | [Vercel resource](https://vercel.com/tauqeerahmed99s-projects/~/integrations/clerk/icfg_b4t6wPTG0Yjxsu9ECS97Wlpx/resources/authentication/ir_RUNidSEePN3VWmdD/guides) |
| Private R2 | `nmt-travel-private` | [Bucket settings](https://dash.cloudflare.com/0d2ad4278f04cbbfd3123a756c9683c1/r2/default/buckets/nmt-travel-private/settings)                                        |

## Configuration verified

Neon uses the Free plan in Singapore (`sin1`). Neon Auth and Realtime are off;
the application uses Clerk and its existing API. The database is not connected
to a Vercel project or migrated yet. Existing databases were not changed.

Clerk uses Hobby with no paid add-ons and production domain
`travel.nmtsolutions.in`. Both development and production instances have email
verification codes for signup and login, require verified email, and have password
signup and password addition disabled. Native applications are enabled. The
Android package `in.nmtsolutions.travel` is registered in both with the existing
EAS preview signing SHA-256 recorded in [Google sign-in](google-sign-in.md). The
resulting APK certificate still needs independent verification. First and last
names are not required by Clerk; the application's profile gate owns them.

Clerk's user permission to delete an account directly is disabled in both
instances before creating app users. App removal must perform the responsibility
checks and recoverable provider operation described by the account-removal slice;
the Clerk administration API remains available to that implementation.

R2 uses Standard storage in Asia-Pacific. It has no custom domain and its public
development URL is disabled. Credential `nmt-travel-api` grants Object Read &
Write only for this bucket. Its values are held outside the repository in a
restricted operator file, and have not been added to a deployment or mobile
bundle. An authenticated read-only S3 listing succeeded and returned zero
objects. No object was uploaded by this setup check. Existing buckets and tokens
were not changed. Actual API upload, immutable validation, viewing and revocation
checks remain pending; see [guide files](guide-files.md) and
[travel files](travel-files.md).

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

Configure the intended Vercel API project with current-consumer variables only,
run the complete migration set, configure Google OAuth and notification delivery,
and perform real multi-account/provider/file/recovery checks. No API project or
public deployment has been created in the intended team yet. No server secret
belongs in Expo public configuration.

The EAS project and remote preview signing identity exist. No complete signed
release APK or OTA update is published. No Android device is attached and no AVD
is configured; installed system images alone are not a device journey. Hermes
execution remains blocked by Windows Application Control. A normal cloud build
can establish compilation, but physical Android email/Google continuity, lifecycle,
offline files, accessibility, install/upgrade and compatible/incompatible update
journeys remain required. See the feature runbooks for prepared, unrun checks.
