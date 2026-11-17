# NMT Solutions ownership transfer

Status on November 17, 2026: the Vercel project transfer is complete. GitHub's repository transfer was requested for `Wafa-Khan-05` and still requires that account to accept GitHub's confirmation email. The old repository remains the issue-tracker target until GitHub reports the new owner.

## Vercel

Use account `wafakhan`, email `wafa.khan@nmtsolutions.in`, and team `nmt-solutions` (NMT Solutions). This replaces the earlier requirement to deploy under `tauqeer-ahmed-99` / `tauqeerahmed99s-projects`. Historical setup and release notes describe those earlier accounts.

- [Project dashboard](https://vercel.com/nmt-solutions/nmt-travel-api)
- Team ID: `team_KcQIKHFr0SKxNkZqEpi2M1Hh`.
- Project ID: `prj_OK2LNGxdaHfUMm0nBJ7d37nCx5A2`, unchanged.
- API: `https://nmt-travel-api.vercel.app`, unchanged.
- Function region: Mumbai, `bom1`.
- Root directory: `apps/api`; framework: Next.js.

The provider's project-transfer flow moved the existing project, deployments, domain and configuration. All 15 environment entries retained their keys, targets and sensitive types. Values were not printed or replaced with local values. In particular, the deployed R2 connection was retained despite the different local R2 settings.

The transfer completed under the destination team. The local `.vercel/project.json` now selects that team and the same project. For CLI deployments, verify `vercel whoami` is `wafakhan`, then use `vercel --prod --scope nmt-solutions` from the repository root. No new app environment variable is needed for this ownership change.

The Git repository connection was removed during transfer. Reconnect it to `Wafa-Khan-05/hajj-and-umrah-travel-checklist` after GitHub acceptance, and verify its production branch before allowing a Git-triggered deployment. The latest app source currently lives on `integration/spec-1-nmt-travel`, ahead of `main`; selecting an older branch must not replace the current API accidentally. The existing production deployment remains serving while this step is pending.

## GitHub

The requested destination is [Wafa-Khan-05/hajj-and-umrah-travel-checklist](https://github.com/Wafa-Khan-05/hajj-and-umrah-travel-checklist). A native repository transfer was initiated, rather than a replacement repository or issue recreation. GitHub requires the receiving personal account to accept within one day. See [GitHub's transfer documentation](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository).

The pre-transfer inventory contains repository ID `1456773800`, 22 issues, 14 labels, five branch refs, no pull requests and no release assets. There are no repository Actions secrets, variables, milestones or webhooks to recreate. Wiki is disabled. Issue IDs, numbers, states, comment counts, labels and exact branch heads were recorded privately for comparison after acceptance. GitHub Project boards could not be inventoried because the existing token lacks `read:project`; an enabled repository Projects setting alone does not establish that a board exists.

The latest local integration work was published to the source repository with a normal fast-forward push from `b071291` to `9ae34d54fa68338646caf0e208a7735f9c8aca86` while acceptance was pending. Those commits therefore accompany the repository transfer. The recorded pre-transfer branch head for this branch predates that intentional push.

After acceptance, verify the repository ID, issues and refs against that inventory and the intentional integration-branch update, update the local Git remote and issue-tracker instructions, and reconnect Vercel. The acceptance step is pending, so those dependent changes are not recorded as completed here.

## Connected providers and verification

Vercel's hosting ownership changed. The existing paid Neon database, Clerk instance, R2 account and Expo project retain their provider identities. Moving their billing or provider ownership is a separate operation; copying Vercel credentials does not perform those transfers. The [service account audit](service-account-audit.md) records their exact identities. No database, member identity, private object or Expo signing configuration was replaced.

After transfer, an explicitly disposable Clerk account completed 18 successful authenticated API calls: profile save, trip creation, seven read paths in two rounds, pending guide metadata and private upload authorization. A database lookup confirmed the API writes still reached the configured paid Neon endpoint. File authorization still selected Cloudflare account `0d2ad4278f04cbbfd3123a756c9683c1`, bucket `nmt-travel-private`; no object bytes were uploaded. Unauthenticated `/api/me` returned 401 and the home page returned 200. Authenticated function responses reported `bom1::bom1`. The disposable trip and account were removed through the app's API afterward.

The fresh manual deployment [5E9W5hko5Boyu1BxaMQ2tTebiMFP](https://vercel.com/nmt-solutions/nmt-travel-api/5E9W5hko5Boyu1BxaMQ2tTebiMFP) also completed under NMT Solutions, from source `9ae34d54fa68338646caf0e208a7735f9c8aca86`. The public API alias points to this READY deployment. The same 18-call authenticated check passed again against this deployment, including live paid-database correlation and the unchanged Clerk/R2 identities; its disposable trip and account were removed afterward. An accidentally submitted duplicate deployment was cancelled; it did not replace the serving alias. Automatic Git deployment from the destination repository remains pending GitHub acceptance and reconnection.

References: [Vercel project transfer](https://vercel.com/docs/projects/transferring-projects), [cross-account project claims](https://vercel.com/docs/deployments/claim-deployments).
