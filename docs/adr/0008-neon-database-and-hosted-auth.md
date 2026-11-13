# Use Neon PostgreSQL with Clerk authentication

Use Neon PostgreSQL for application data and Clerk for hosted Google and email-code authentication. Keep application profiles and trip/family permissions tied to the authenticated member identity so both sign-in methods retain the same memberships.

Neon is limited to the database; do not select Neon Object Storage or Neon Functions. File viewing, optional user-requested downloads, PDF and image guides, bag photos, and attachments remain in launch scope through private Cloudflare R2. The API uses a Next.js boilerplate on Vercel.

The selected Clerk production application domain is `travel.nmtsolutions.in`. DNS records, production credentials, and native OAuth registration still require setup; providing the domain does not mean those resources are configured.
