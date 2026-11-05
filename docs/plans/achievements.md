# Implementation Plan — User Achievements (OG, Season Top 10, …)

## Implementation status — 2026-11-04

Implemented the migration, eight-entry catalog, automatic rules, concurrent-safe awards,
notifications, independent scheduler, signed APIs, profile section and featured mark, public
catalog, admin controls, and sitemap entry. Feed bylines and onchain minting remain future phases.

Validation completed:
- Applied the migration to the local database and ran a silent initial backfill. A second run
  produced zero new awards. Production still requires the migration below.
- Pure helper/signature tests pass with `pnpm achievements:test`. ERC-1271 coverage uses a mocked
  RPC boundary; interactive MetaMask and Universal Profile signing still needs a connected wallet.
- Isolated local database tests cover concurrent awards and one notification, silent reruns,
  qualified followers, agent exclusion, permanent rule awards, feature ownership, nonce replay,
  featured-row cleanup, signed admin grant/revoke/run, signed EOA featuring, open and closed seasons,
  and missing-migration API responses. Run with `ACHIEVEMENTS_TEST_DB=1`, the local database env,
  and the same Node loader as the test script. Fixtures create and remove their own test database.
- Browser checks cover all eight catalog cards, responsive layout, deep links, and the profile
  achievement dialog. Achievement-specific lint passes. Repository-wide `pnpm lint` currently
  reports existing failures elsewhere; see `output/achievements-lint.txt` for the local report.

Implementation details: admin signatures cover notes and notification preferences as well as the
action, wallet and achievement. A connection-bound database lock serializes award/revoke/feature
writes across processes so concurrent grants cannot notify the same holder twice. Admin holder
lists are limited to the newest 500 rows. Scheduler startup remains independent of the agent
scheduler's opt-out.

---

> Hand-off plan for an implementing agent. Read `AGENTS.md` first: every rule there applies
> (2-space indent, SCSS Modules + BEM + `clsx`, `NativeDialog`/`NativePopover` only, spinners only
> from `src/components/Loading.jsx`, motion via `cube-motion`, `pnpm` not `npm`, write "onchain"
> never "on-chain", Conventional Commits, commit on `main`). This repo runs a non-standard Next.js:
> check `node_modules/next/dist/docs/` before using any route/handler API you're unsure of.

---

## 1. Objective

Give wallets permanent **achievements**: small marks like **OG**, **Season Top 10**, **First Tip**
and **Rising Voice**. They're earned automatically from activity or granted by the admin. They show
on the profile, users can feature one beside their name, and each new award sends a notification.

## 2. Naming: why "achievement" and not "badge"

The word **badge** is already used for a different feature. In `src/lib/badge.js`,
`/api/v1/users/[address]/badges` and `getUserBadges`, a "badge" is the **community tag** a wallet
wears. Don't rename or reuse any of that. Everything in this plan is called **achievement**.

Achievements also behave differently from the existing marks:

| Mark | Source | Lifetime |
|---|---|---|
| Community tag (`lib/badge.js`) | Checked again on every read | Disappears when the user leaves the community |
| Role (`lib/rolesServer.js`, e.g. ambassador) | Admin grant | Disappears when revoked |
| **Achievement (new)** | Rule job or admin grant, **stored once** | **Permanent.** A historical fact. Only admin-granted ones can be revoked |

So achievements are **stored, not recomputed on read**. Someone who earned OG keeps it even if
their numbers change later.

---

## 3. Architecture & Scope

### Create

| File | Purpose |
|---|---|
| `deploy/migrations/20261105-user-achievements.sql` | Tables `user_achievements` and `user_featured_achievement` |
| `src/config/achievements.js` | Pure-data catalog shared by server and client (copy the shape of `src/config/decorations.js`) |
| `src/lib/achievements.js` | Pure helpers safe on both client and server: catalog lookup, signed-message builders, claim validation |
| `src/lib/achievementRules.js` | Server only. One SQL rule per auto achievement; returns eligible wallets |
| `src/lib/achievementsServer.js` | Server only. Read, award, revoke, featured get/set, notify, run all rules |
| `src/lib/achievementScheduler.js` | Background tick that runs the rules (copy the shape of `src/lib/agentScheduler.js`) |
| `src/app/api/v1/achievements/route.js` | GET: catalog + holder counts (rarity) |
| `src/app/api/v1/users/[address]/achievements/route.js` | GET: one wallet's earned achievements |
| `src/app/api/v1/users/achievements/featured/route.js` | POST: set or clear the featured achievement (signed) |
| `src/app/api/v1/admin/achievements/route.js` | GET: holders of one achievement. POST: grant / revoke / run rules (admin-signed) |
| `src/components/achievements/achievementIcons.js` | Maps catalog `icon` key → `@phosphor-icons/react` component (client) |
| `src/components/ui/AchievementBadge.jsx` + `.module.scss` | The small featured mark beside a name (copy the shape of `AmbassadorBadge.jsx`) |
| `src/components/achievements/AchievementsRow.jsx` + `.module.scss` | Profile section: grid of earned achievements, detail dialog, "Feature" action |
| `src/components/achievements/AchievementDialog.jsx` + `.module.scss` | `NativeDialog` with one achievement's details, earned date and rarity |
| `src/app/achievements/page.jsx` + `page.module.scss` | Public page: full catalog, rarity, viewer's earned state |
| `src/app/admin/_components/AchievementsSection.jsx` | Admin grant/revoke/run UI (copy the shape of `RolesSection.jsx`) |
| `src/tests/achievements/achievements.test.mjs` | `node --test` unit tests for the pure helpers |

### Modify

| File | Change |
|---|---|
| `src/instrumentation.js` | Also start the achievement scheduler (own env switch) |
| `src/app/api/v1/users/profile/[address]/route.js` | Add `achievements` to the parallel read; attach to both `shapeUniversalProfile` and `shapeDatabaseProfile` |
| `src/app/(user)/[wallet]/_components/UserProfile.jsx` | Render `AchievementBadge` next to `PremiumBadge`/`AmbassadorBadge` (~line 682). Render `AchievementsRow` in the profile body |
| `src/app/notifications/_components/notificationModel.js` | Add an `ACTION_META.achievement_earned` entry (Trophy icon, `group: 'none'`) |
| `src/app/notifications/_components/NotificationRow.jsx` | Only if needed so the new type renders its title/message/link correctly |
| `src/lib/api.js` | Client fetchers: `getAchievementCatalog`, `getUserAchievements`, `setFeaturedAchievement` |
| `src/app/admin/page.jsx` | Mount `AchievementsSection` |
| `src/app/sitemap.js` | Add `/achievements` |
| `package.json` | Script `"achievements:test": "node --test src/tests/achievements/*.test.mjs"` |

### Delete
None.

---

## 4. Technical Specs

### 4.1 Database — `deploy/migrations/20261105-user-achievements.sql`

Production is migrated by hand. Follow the style of `deploy/migrations/20261104-user-decorations.sql`
(header comment, `IF NOT EXISTS`, InnoDB, utf8mb4_general_ci).

```sql
-- Achievements a wallet has earned. Catalog lives in src/config/achievements.js; an id this table
-- holds that the catalog no longer lists is ignored on read. Rows are permanent facts: auto rules
-- only ever INSERT IGNORE, and only admin-granted rows may be deleted (revoke).
CREATE TABLE IF NOT EXISTS user_achievements (
  wallet_address VARCHAR(42) NOT NULL,          -- always lowercase
  achievement_id VARCHAR(48) NOT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT '',        -- '' for one-off; season id ('1','2'…) for per-season ones
  source ENUM('rule','admin') NOT NULL,
  granted_by VARCHAR(42) NULL,                  -- admin wallet for source='admin'
  note VARCHAR(255) NULL,
  awarded_at BIGINT UNSIGNED NOT NULL,          -- ms epoch, like user_decorations.updated_at
  PRIMARY KEY (wallet_address, achievement_id, scope),
  KEY idx_achievement (achievement_id, scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- The one achievement a wallet wears beside its name. Deleting the row un-features it.
CREATE TABLE IF NOT EXISTS user_featured_achievement (
  wallet_address VARCHAR(42) NOT NULL,
  achievement_id VARCHAR(48) NOT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT '',
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (wallet_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

Every server read must guard with `hasTable('user_achievements')` from `src/lib/schema.js`. Until
the migration has run, return `[]` / `null`, never a 500. The profile route already does this for
decorations and roles; do the same.

### 4.2 Catalog — `src/config/achievements.js`

Pure data only (no React, no `pool`), so the client and server import the same file.

```js
export const RARITIES = ['common', 'rare', 'epic', 'legendary']

// The date OG is measured against. users.created_at strictly before this = OG.
// Default: Season 1 start (config/points.js). ⚠ Product owner to confirm — see §7.
export const OG_CUTOFF = '2026-11-05 00:00:00'

export const ACHIEVEMENTS = [
  { id: 'og',            name: 'OG',            kind: 'auto',    rarity: 'legendary', icon: 'crown',
    description: 'Was on Hup before Season 1.' },
  { id: 'season-top-10', name: 'Season Top 10', kind: 'auto',    rarity: 'epic',      icon: 'trophy', perSeason: true,
    description: 'Finished in the top 10 of a points season.' },
  { id: 'first-post',    name: 'First Words',   kind: 'auto',    rarity: 'common',    icon: 'pencil',
    description: 'Published a first post.' },
  { id: 'first-tip',     name: 'Tipper',        kind: 'auto',    rarity: 'common',    icon: 'hand-coins',
    description: 'Sent a first tip.' },
  { id: 'generous',      name: 'Generous',      kind: 'auto',    rarity: 'rare',      icon: 'gift', threshold: 50,
    description: 'Sent 50 tips.' },
  { id: 'rising-voice',  name: 'Rising Voice',  kind: 'auto',    rarity: 'rare',      icon: 'megaphone', threshold: 100,
    description: 'Reached 100 followers.' },
  { id: 'early-tester',  name: 'Early Tester',  kind: 'granted', rarity: 'epic',      icon: 'flask',
    description: 'Helped test Hup before launch.' },
  { id: 'bug-hunter',    name: 'Bug Hunter',    kind: 'granted', rarity: 'rare',      icon: 'bug',
    description: 'Reported a real bug.' },
]

export const achievementById = (id) => ACHIEVEMENTS.find((a) => a.id === id) ?? null
```

Rules for the catalog:
- `id` is `[a-z0-9-]{1,48}`, unique, and **never renamed** once shipped (it's stored in the database).
- `kind: 'granted'` entries have no rule and can only be awarded through the admin route.
- `perSeason: true` means rows are stored with `scope = String(season.id)`, and the UI shows "Season N".
- Adding an achievement later = add a catalog entry + (if auto) a rule in `achievementRules.js`. Nothing else.

### 4.3 Rules — `src/lib/achievementRules.js` (server only)

Export `RULES`: a map of `achievementId → async () => Array<{ wallet, scope }>`. Every rule must:
- Return **lowercase** wallet addresses (`LOWER(...)` in SQL). Some tables store checksummed
  addresses. See the comment at the top of `src/lib/badge.js`.
- Be idempotent and cheap enough to run every tick. Use `NOT EXISTS (SELECT 1 FROM user_achievements …)`
  to skip wallets that already hold it, so each run only returns new winners.
- Reuse the leaderboard's definitions instead of inventing new ones. Activity tables used by
  `src/lib/leaderboard.js`: `users`, `posts`, `post_likes`, `post_views`, `follows`, `tips`.
  Before writing a query, read that file to get the right column names and the "qualified
  follower" definition.

| Achievement | Rule |
|---|---|
| `og` | `users.created_at < OG_CUTOFF`. Exclude rows with no `created_at` |
| `first-post` | wallet has ≥1 row in `posts` (root post, same filter the leaderboard uses for `root_posts`) |
| `first-tip` | ≥1 row in `tips` as sender |
| `generous` | ≥ `threshold` tips sent (**count** rows, never sum `amount`; see the tips comment in leaderboard.js) |
| `rising-voice` | ≥ `threshold` **qualified** followers, same definition as leaderboard `follower_count` |
| `season-top-10` | For each season in `POINTS_SEASONS` whose `endsAt` is set **and in the past**: `getSeasonStandings(season)` from `src/lib/points.js`, take rows with `rank !== null && rank <= 10`, scope = `String(season.id)`. Open seasons (`endsAt: null`) award nothing |

Agent and bot wallets: check whether `users` marks hosted agents (see `src/lib/agentProfile.js` /
`hostedAgents.js`). If it does, exclude them from auto rules.

### 4.4 Server lib — `src/lib/achievementsServer.js`

```js
readAchievements(address)            // → [{ id, scope, awardedAt, source }] filtered to catalog ids, newest first
readFeaturedAchievement(address)     // → { id, scope } | null — null if the row points at something no longer held
readAchievementSummary(address)      // → { earned: [...], featured } — what the profile route attaches
readHolderCounts()                   // → { [id]: count } — cached in-memory 60s (same pattern as leaderboard cache)
awardAchievement({ wallets, id, scope = '', source, grantedBy = null, note = null, notify = true })
                                     // bulk INSERT IGNORE in batches of 500; returns newly inserted wallets; notifies only those
revokeAchievement({ wallet, id, scope = '' })   // only allowed when the row's source = 'admin'; also clears featured if it matched
setFeaturedAchievement({ wallet, id, scope })   // must currently hold it; id = null clears
runAchievementRules({ only } = {})   // runs RULES (or one), awards with source='rule'; returns { [id]: newCount }
```

**Finding which rows are new.** `INSERT IGNORE` doesn't tell you which rows it inserted. To notify
only new holders, first select which of the candidate wallets already hold the achievement, then
insert the rest, all inside one transaction. Or, simpler: the rules already exclude existing
holders, so their output is the new set.

**Notifications.** Copy `notifyGranted` in `src/lib/rolesServer.js`. It's best effort: a failed
notification must never undo the award.

```sql
INSERT INTO notifications (recipient_wallet_address, action_type, entity_type, entity_id, title, message, action_url, email_status)
VALUES (?, 'achievement_earned', 'achievement', ?, ?, ?, ?, 'skipped')
```
- title: `` `Achievement unlocked: ${name}` ``, message: the catalog description, action_url: `/achievements#${id}`
- Use a multi-row INSERT in batches of 500.
- **Backfill switch:** the first OG run may award thousands of wallets. `runAchievementRules` takes
  `{ notify }`, and the admin "Run now" button exposes it. Leave notifications **on** by default
  but make it possible to backfill silently.

### 4.5 Scheduler — `src/lib/achievementScheduler.js`

Copy `startAgentScheduler` in `src/lib/agentScheduler.js` exactly:
- `globalThis.__hupAchievementScheduler` guard so it starts only once
- First tick after about 60s, then every **15 min**. Both timers `.unref()`
- Skip the tick if the previous one is still running (an in-flight flag)
- Catch and `console.error('[achievements] …')`. Never throw out of a tick

In `src/instrumentation.js`, start it after the agent scheduler, with its own opt-out:
`ACHIEVEMENTS_SCHEDULER=off`. The existing early return for `AGENT_TASKS_SCHEDULER === 'off'` must
not also turn this off, so restructure into two independent `if` blocks.

### 4.6 API routes

All routes use `export const runtime = 'nodejs'` and the `{ success, data | error }` shape. Validate
addresses with `isWalletAddress` / `normalizeAddress` from `src/lib/address.js`. Use the same error
logging and production `details` hiding as `api/v1/points/route.js`.

1. **`GET /api/v1/achievements`** returns `{ catalog: ACHIEVEMENTS, holders: readHolderCounts(), totalWallets }`.
   Public. `Cache-Control: public, s-maxage=60`.
2. **`GET /api/v1/users/[address]/achievements`** returns `readAchievementSummary(address)`.
   Public (achievements are public). `no-store`.
3. **`POST /api/v1/users/achievements/featured`**, body
   `{ address, achievementId|null, scope, nonce, issuedAt, signature, chainId }`.
   - Message builder `featuredAchievementMessage(...)` lives in `src/lib/achievements.js` so the client signs the exact same text.
     Copy `userDecorationsMessage` + `validateDecorationsClaim` in `src/lib/userDecorations.js`
     (freshness window, nonce).
   - Verify with `verifyWalletSignature(address, message, signature, { chainId })`. It already
     handles EOAs **and** Universal Profiles (ERC-1271). Don't add anything that assumes an EOA.
   - Reject with a typed error (pattern: `DecorationError`) when the wallet doesn't hold that achievement.
4. **`/api/v1/admin/achievements`**. Copy `src/app/api/v1/admin/roles/route.js` exactly:
   - GET `?id=&scope=` lists holders (wallet, name, username, avatar, source, awardedAt, grantedBy).
   - POST `{ action: 'grant'|'revoke'|'run', wallet?, id?, scope?, note?, notify?, signature, nonce, chainId }`.
     Signed by `NEXT_PUBLIC_ADMIN_WALLET_ADDRESS` over `achievementAdminMessage(...)`, verified the
     same way the roles route does it.
   - `grant` only for `kind: 'granted'` catalog ids (admins may also force-grant auto ones; allow
     it, but store `source='admin'`). `revoke` only removes `source='admin'` rows. `run` calls
     `runAchievementRules({ only: id, notify })` and returns the counts.
   - Return 503 `"Run deploy/migrations/20261105-user-achievements.sql first."` when the table is missing.

### 4.7 Profile route integration

In `src/app/api/v1/users/profile/[address]/route.js` (~line 376), add
`readAchievementSummary(address).catch(err => { console.error('[ACHIEVEMENTS_RESOLVE_ERROR]:', err.message); return { earned: [], featured: null } })`
to the `Promise.all`. Pass `achievements` through the options object into both shapers, the same
way `decorations` is passed, and set `profile.achievements = achievements`.

### 4.8 UI

General: SCSS Modules, BEM class names (`.achievementBadge`, `.achievementBadge__icon`,
`.achievementBadge--legendary`), `clsx`, 2 spaces. Rarity colours go in SCSS tokens, one modifier
per rarity, and must work in light and dark theme. Use the variables the other `ui/*Badge.module.scss` files use.

- **`achievementIcons.js`**: `{ crown: CrownIcon, trophy: TrophyIcon, pencil: PencilSimpleIcon, 'hand-coins': HandCoinsIcon, gift: GiftIcon, megaphone: MegaphoneIcon, flask: FlaskIcon, bug: BugIcon }`
  from `@phosphor-icons/react`. Fall back to `MedalIcon` for unknown keys.
- **`AchievementBadge.jsx`**: props `{ featured, size = 'sm'|'lg', linked = true, className }`.
  Returns `null` when `featured` is null or not in the catalog. It's a glyph the size of
  Premium/Ambassador (14/18px). Linked → `/achievements#id`. Supports `linked={false}` for use
  inside bylines that are already a link (same reasoning as `AmbassadorBadge`). Set accessible name
  via `alt`/`aria-label`. For the tooltip use `title`, or `NativePopover` if a richer hover is
  wanted. Never hand-roll a popover.
- **`AchievementsRow.jsx`** (profile body):
  - Shows nothing if no achievements are earned. Exception: on your own profile, show a muted
    "No achievements yet → see all" link.
  - Grid of icon chips with names, sorted by rarity then date.
  - Clicking a chip opens `AchievementDialog` (`NativeDialog`). Style the open state as
    `&[open] { display: flex }` with every other property on the base selector (see AGENTS.md §3).
  - Owner only: a "Feature beside my name" / "Remove" button in the dialog. It signs
    `featuredAchievementMessage` with the connected wallet (look at how the decoration sheet signs
    and posts) and updates local state on success. While pending, use `Spinner` from `Loading.jsx`.
  - Fetch from `profile.achievements`. No extra request needed on the profile page.
- **`AchievementDialog.jsx`**: icon, name, rarity, description, "Earned {date}" using
  `Intl.DateTimeFormat`, "Season N" for scoped ones, and rarity
  "{x}% of wallets" using `Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })`.
  If this dialog ever opens inside another `NativeDialog`, call `event.stopPropagation()` in `onClose`/`onCancel`.
- **`/achievements` page**: catalog grouped by rarity, each with holder count
  (`Intl.NumberFormat` compact notation) and percent. Each card has `id={achievement.id}` so
  `#og` deep links work. If a wallet is connected, mark which ones the viewer has earned. Use
  `cube-motion/react` `reveal` for the card grid entrance. Add `export const metadata` (title/description).
- **Admin `AchievementsSection.jsx`**: pick an achievement, list holders, grant (wallet + note),
  revoke (admin rows only), "Run rules now" with a "Send notifications" checkbox. Copy
  `RolesSection.jsx` and `useAdminPass.js` for the signing flow.

### 4.9 Bylines / feed (Phase 2, out of scope here)

Showing the featured achievement in **post bylines** means adding it to every feed/post query
payload. That's a larger change touching the post routes and `src/components/Profile.jsx`. Do the
profile header only in this pass. Leave a `// TODO(achievements): byline` next to the
`AmbassadorBadge` use in `Profile.jsx` and leave the rest alone.

---

## 5. Step-by-Step Breakdown

1. **Migration**: write the SQL file (§4.1) and run it on the local database.
2. **Catalog + pure helpers**: `config/achievements.js`, `lib/achievements.js` (lookup, message
   builders, claim validation). Write `src/tests/achievements/achievements.test.mjs` covering:
   catalog ids are unique and valid, every `auto` id has a rule key (import only the key list, not
   SQL), message builders are deterministic, and claim validation rejects stale/malformed bodies.
   Add the `achievements:test` script and run `pnpm achievements:test`.
3. **Rules**: `lib/achievementRules.js`. Run each query by hand against the local database first and
   check the counts look reasonable.
4. **Server lib**: `lib/achievementsServer.js` with the table guards and best-effort notifications.
5. **API routes**: the four routes in §4.6. Smoke test with curl: catalog, a wallet's list, the 503
   when the table is dropped.
6. **Admin**: the admin route + `AchievementsSection`. Grant `early-tester` to a test wallet, then revoke it.
7. **Scheduler**: `achievementScheduler.js` + `instrumentation.js`. Start `pnpm dev` and check the
   log shows one tick and awards appear. Run OG backfill once with notifications off if the database is big.
8. **Profile**: profile route field, then `AchievementBadge` in the header, then `AchievementsRow` +
   `AchievementDialog`, then the feature/unfeature signing flow. Test with **both** a MetaMask EOA and a Universal Profile.
9. **Notifications**: `ACTION_META.achievement_earned` and check the row renders and links to `/achievements#id`.
10. **Public page + sitemap**: `/achievements`.
11. **Verify**: run `/verify` (project skill) for the UI, `pnpm lint`, `pnpm achievements:test`.
12. **Commit** on `main`, in logical pieces, e.g.
    `feat: add achievements schema, catalog and rules`,
    `feat: award achievements on a schedule with notifications`,
    `feat: show and feature achievements on profiles`,
    `feat: add achievements page and admin section`.

---

## 6. Acceptance Criteria

- [ ] With the migration **not** applied, every page and profile still loads (achievements just empty).
- [ ] A wallet with `users.created_at < OG_CUTOFF` gets `og` within one scheduler tick, plus exactly one notification.
- [ ] Re-running rules never duplicates rows or notifications.
- [ ] `season-top-10` awards nothing while the season is open. Once `endsAt` is in the past, exactly
      the top 10 get it with `scope = '<seasonId>'`.
- [ ] Admin can grant/revoke `granted` achievements. Revoking a rule-awarded row is refused.
- [ ] A user can feature only an achievement they hold. It renders beside their name in the profile
      header. Works for EOA and Universal Profile signers.
- [ ] Revoking a featured achievement also clears the featured row.
- [ ] `/achievements` lists the catalog with correct counts and percents, and `#id` deep links scroll to the card.
- [ ] No new modal/popover/spinner primitives. All styles in `.module.scss` with BEM. 2-space indent.

## 7. Open decisions (defaults chosen; product owner may override)

| Decision | Default in this plan |
|---|---|
| What counts as OG | `users.created_at` before Season 1 start (`2026-11-05 00:00:00` UTC). Alternatives: first N wallets, or first post before a date |
| Starting achievement set | The 8 in §4.2 |
| Notify on OG backfill | Yes by default. Admin can run it silently |
| Byline display | Phase 2 (§4.9) |
| Onchain claim | Phase 3 (below), not in this pass |

## 8. Phase 3 (future, not this pass): onchain claim

An optional "Mint" for an earned achievement, as a **non-transferable** token: LSP8 on LUKSO,
ERC721 elsewhere. The server signs an EIP-712 voucher `(to, achievementId, scope)`. The contract
mints to `msg.sender` after checking the voucher and blocks transfers. It must follow AGENTS.md §4:
section dividers, no `tx.origin`/EOA assumptions (Universal Profiles call through ERC725X
`execute()`), and any refunds via `.call{value:}`. Minting can go through the existing gasless relay
(`src/lib/relayGasless.js`). The offchain table stays the source of truth; the token only mirrors it.
