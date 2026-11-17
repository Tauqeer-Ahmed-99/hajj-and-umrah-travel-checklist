<img src="apps/mobile/assets/journey-mascot.png" width="72" height="72" alt="Travel Companion passport icon">

# Travel Companion

A product by [NMT Solutions](https://nmtsolutions.in). Android version 0.2.0, build 9.

See [NMT Solutions ownership and deployment](docs/ownership-transfer.md) for the current hosting account and repository transfer status.

<img src="apps/mobile/assets/nmt-solutions-logo.svg" width="32" height="32" alt="NMT Solutions logo">

Travel Companion helps families prepare for Hajj and Umrah. Add travelers, list what each family needs, mark what you have, and choose where to pack it. The app also keeps travel details, guides and reminders for the trip.

Planned application domain: `travel.nmtsolutions.in`. Android application ID: `in.nmtsolutions.travel`.

The Android app uses Expo and TanStack Query. The API uses Next.js, PostgreSQL through Drizzle ORM, Clerk and private R2 storage. JSON reads stay in the active account's memory cache. Only files saved by the user remain available after an offline restart. See [the data policy](docs/adr/0013-query-memory-and-explicit-file-copies.md).

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

The API's lazy Drizzle client is in `apps/api/src/database.ts`; its typed table
definitions are in `apps/api/src/schema.ts`. Routine writes use Drizzle's query
builder, and complex permission/quantity projections use parameterized `sql`
queries within Drizzle transactions. PostgreSQL remains the source of exact
quantity arithmetic and locking.

Existing databases keep their data and `schema_migrations` history. Continue
applying the versioned SQL files with `npm run db:migrate -w @nmt/api`, using
the API's existing `DATABASE_URL` in `apps/api/.env.local`. Update the SQL migration
and Drizzle schema together when changing tables. Do not replace an existing
database with generated schema or apply migrations during application builds.
The test fixture migrates a fresh PostgreSQL database twice before HTTP checks.

For service configuration, migrations, Android development/preview builds, the
native signup check, known local build limits, and primary documentation, see
[Account flow setup and verification](docs/account-flow.md). See the
[native Google setup and acceptance checks](docs/google-sign-in.md) for #3,
[private trips, family permissions, and Android roster flow](docs/trips-and-families.md)
for #4, and the
[product brief](docs/idea.md) for the complete agreed scope and architecture.

Created in [T3 Code](https://t3.codes).
