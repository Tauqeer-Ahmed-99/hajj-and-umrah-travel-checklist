---
status: accepted
---

# Use private R2 storage and open guides in the app

Use a private Cloudflare R2 bucket for PDFs, images, bag photos, and attachments while Neon stores file metadata and permissions. The Next.js API on Vercel checks Clerk identity and current family/trip access before issuing short-lived authorization for an exact file operation; storage credentials stay on the server and the bucket is not public.

Guides, PDFs, and images open inside the app by default. Viewing can fetch bytes and use an app-private temporary cache, but never automatically saves a file into Android Downloads or another device folder. Saving a persistent offline copy inside the app or downloading to device files requires an explicit user action.

See [R2 private access through applications](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/) and [S3-compatible presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/). R2 is the file host; the API remains Next.js on Vercel.
