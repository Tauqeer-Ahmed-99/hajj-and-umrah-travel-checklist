# Host the API in a Next.js boilerplate on Vercel

Use a Next.js boilerplate deployed to Vercel for the authenticated API, as requested by the user instead of the proposed Cloudflare Workers setup. The Android app calls this API, which verifies Clerk authentication and enforces trip/family permissions before reading or changing Neon data or authorizing files. Neon remains PostgreSQL-only, with database and service credentials kept on the server.
