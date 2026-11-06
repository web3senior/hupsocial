# Post storage

Post deletion queues cleanup before the wallet transaction. Cleanup only runs
after cidex records `posts.is_deleted = 1`. Cancelled/reverted transactions cannot
delete stored files. Cleanup failures remain queued and are safe to retry.

## Deployment

1. Apply `migrations/20261106-post-storage.sql` to the app/indexer database. The
   app also creates these tables on first use if its database user has permission.
2. Keep `FILEBASE_IPFS_RPC_TOKEN` configured for IPFS unpinning. Existing Filebase
   S3 keys are used to delete large-upload objects whose keys the app records.
3. To enable the optional mode, create a **private conventional S3 bucket, not an
   IPFS bucket**. Set `HUP_STORAGE_BUCKET`, `HUP_STORAGE_KEY`,
   `HUP_STORAGE_SECRET`, `HUP_STORAGE_ENDPOINT`, and `HUP_STORAGE_REGION`.
   Use a separate bucket from `FILEBASE_S3_BUCKET`. Allow browser PUT requests
   from Hup's origin in its CORS policy. Disable versioning/retention rules, or
   configure provider lifecycle policies to remove retained object versions.
4. Set `HUP_STORAGE_ORIGIN` to Hup's public HTTPS origin in both Hup and cidex.
   Deploy the updated `cidex/utils/ipfsHelper.js` and restart cidex before enabling
   the hosted option. The indexer permits only this origin and the hosted JSON
   route; arbitrary metadata URLs and redirects are rejected.
5. Set a random `CRON_SECRET`. Run an authenticated GET to
   `/api/post-storage/cleanup` every minute with `Authorization: Bearer <secret>`.
   The included systemd timer/worker supports the existing VPS deployment.
   Jobs continue after the browser closes; inspect `last_error` for failed jobs.
   Each worker invocation processes ten confirmed deletions.

Install both `hupsocial-storage-cleanup.service` and
`hupsocial-storage-cleanup.timer` in `/etc/systemd/system`, run
`systemctl daemon-reload`, then `systemctl enable --now hupsocial-storage-cleanup.timer`.
The worker reads the existing release's production dotenv file; keep the secret
out of command-line arguments and timer files.

Without hosted credentials, Settings displays the option as unavailable. The
app never silently falls back to IPFS for a hosted upload. The preference is
local to the browser and applies to future post metadata and new attachments,
including replies, threads, articles, edits and scheduled posts. Existing uploads are not
migrated. This choice does not affect profile, community, NFT or agent uploads.

## Limits

Posts remain public. Onchain references remain in blockchain history. IPFS
unpinning does not erase copies kept by other peers. Previously downloaded or
cached copies can remain, including older immutable CDN/browser cache entries.
Hosted responses use `no-store` and are streamed from the private bucket.

Cleanup removes the current indexed post document and its discoverable attachment
references, preserves references used by other active/scheduled posts, and clears
the indexed post's content. It does not reconstruct old edit versions or find
attachment references hidden inside encrypted payloads. Provider backups and
retention policies require separate configuration. This feature is not a claim
of GDPR compliance.

Run focused checks with:

    node --import ./src/tests/achievements/loader.mjs --test src/tests/post-storage/*.test.mjs
