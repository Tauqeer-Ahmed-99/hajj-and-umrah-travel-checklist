<img src="assets/icon.svg" width="64" height="64" alt="">

# NMT Travel

An Android family travel helper focused on Hajj and Umrah for its first release.

Planned application domain: `travel.nmtsolutions.in`. Android application ID: `in.nmtsolutions.travel`.

The first implemented slice is public email-code signup, required member profile
completion, session restoration, and logout. It uses Expo Android, a Next.js API,
PostgreSQL, and Clerk. This is an account-flow foundation, not the full launch app.

Use Node 22.13 or newer and npm workspaces:

```sh
npm ci
npm run typecheck
npm test
npm run build:api
```

`npm test` starts disposable real PostgreSQL and a real Next.js HTTP server. It does
not require production credentials, Docker, or an existing database. Only Clerk's
external HTTP boundary is controlled by the integration fixture.

For service configuration, migrations, Android development/preview builds, the
native signup check, known local build limits, and primary documentation, see
[Account flow setup and verification](docs/account-flow.md). See the
[product brief](docs/idea.md) for the complete agreed scope and architecture.

Created in [T3 Code](https://t3.codes).
