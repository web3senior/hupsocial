# VPS deployment

Hup runs as a single Next.js Node.js process on AlmaLinux, behind the server's existing Caddy installation. The service listens only on `127.0.0.1:3000`. Caddy owns public HTTPS and certificate renewal.

## Layout

- `/srv/hupsocial/releases/<release>` contains a source snapshot, Linux dependencies, and its production build.
- `/srv/hupsocial/shared/.env.production.local` contains production environment variables, owned by `hupsocial` with mode `0600`.
- Each release links `.env.production.local` to the shared file before building.
- `/srv/hupsocial/current` points to the active, verified release.
- `/etc/systemd/system/hupsocial.service` is installed from the service template here.

## Initial deployment

1. Export the **Production** environment variables from Vercel into a dotenv file. Transfer it over SSH to the shared environment path; never commit it. Local development environment files are not a substitute.
2. Verify `NEXT_PUBLIC_BASE_URL` is `https://hup.social`, the database is reachable from the VPS, and all production service credentials are present. Keep existing session, encryption, and wallet keys unchanged. Audit any external origin allowlists.
3. Upload a source snapshot excluding Git internals, dependencies, build output, environment files, and local certificates. Create a new release directory owned by `hupsocial` and link its environment file.
4. As `hupsocial`, run `pnpm install --frozen-lockfile` and `pnpm build` inside the release. Production public variables must be present at build time. Do not build over a running release.
5. Point `current` at the release. Install the service template and run `systemctl daemon-reload`, followed by `systemctl enable --now hupsocial`.
6. Check `systemctl status hupsocial`, `journalctl -u hupsocial`, and `curl -I http://127.0.0.1:3000`. Test read-only API responses, static assets, and authentication rejection without publishing posts or sending transactions.
7. Back up the existing Caddy configuration, merge the provided site blocks, run `caddy validate --config /etc/caddy/Caddyfile`, then reload Caddy. Existing site blocks must remain intact.
8. Change the apex A record for `hup.social` to `162.254.38.22` and set `www` to a CNAME for `hup.social`. Check for conflicting AAAA records. Preserve unrelated DNS records, including mail records. Verify public HTTPS after DNS propagation.
9. Test login, uploads, live streams, and wallet flows with the owner. Keep Vercel available during the transition.

## Updates and rollback

Build each update in a new release directory with the production environment linked. Only switch `current` after the build succeeds. Restart `hupsocial` and repeat health checks. Retain the previous release; rollback means restoring its symlink target and restarting the service. Switching releases restarts the single process and can cause a brief interruption.

Changing `NEXT_PUBLIC_*` values requires rebuilding. Shared runtime secret changes require a service restart. Use versioned secure backups for environment changes so a release rollback can restore compatible configuration.

### User blocks migration

Apply `deploy/migrations/20261029-user-blocks.sql` to the app database before activating a release with database-backed blocking. It creates the `user_blocks` table with a wallet-pair primary key and case-sensitive address storage. EVM addresses are normalized by the app; Solana addresses retain their case. The migration is additive and safe to leave in place if the app release is rolled back.

Block/Unblock updates require a wallet signature and consume a single-use authentication nonce in the same database transaction as the write. Block lists are read from MySQL; the previous browser-only list is no longer used.

## Scheduled work

The repository has an author-authenticated scheduled-post delivery endpoint, but no Vercel cron configuration or general cron-authenticated delivery endpoint was found during deployment preparation. Do not attach a privileged timer to that endpoint or trigger deliveries as a health check. Confirm any external scheduler/indexer configuration separately before retiring Vercel.

## Operational checks

The existing MariaDB, indexer, live media, realtime server, and other Caddy sites are separate services. This deployment does not move their data or change their credentials. Monitor app memory, disk use, certificate renewal, and database backups after cutover. The repo's existing dependency lifecycle allowlist remains in effect during pnpm installation.
