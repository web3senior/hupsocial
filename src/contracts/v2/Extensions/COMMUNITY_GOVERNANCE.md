# Community voting and treasury deployment

Each existing community is a voting group. Its current, non-banned members can propose and
cast one ballot per proposal. Members may join during an open vote and participate immediately.
The deployed HupCommunity contract, its ABI, and its deployment artifact stay unchanged.
There is no community migration or membership history requirement.

## Contracts

- `HupCommunityGovernance.sol` takes the existing HupCommunity address as its sole constructor
  argument. It reads `communities(id)` for the owner and `registry(id, account)` for membership.
  Only the current community creator can change voting rules; moderators and the optional
  community governor cannot. There is no separate group registration or member list.
- `HupCommunityTreasury.sol` is deployed per community by governance using CREATE2. Read its
  address with `treasuryAddress(communityId)`. Anyone can call `ensureTreasury`; deposits and
  spending proposals also create it automatically. Do not deploy a treasury manually.
- The vault has an immutable governance controller and community id. Neither contract provides
  an owner withdrawal, protocol admin withdrawal, or arbitrary contract execution function.

## Voting rules

Creators choose a voting duration for each proposal, within the owner's minimum and maximum
limits. Default limits are one hour to ninety days; the creation form suggests three days,
clamped to the community's allowed range. The contract enforces these limits for all proposals,
including treasury payments. Durations and closing times cannot change after submission.

Voting starts immediately by default, requires at least one ballot and 50.01% approval, and
payments wait two days after voting ends. The owner can change minimum ballot count, approval
percentage, allowed duration limits, voting delay and execution delay for future proposals.
Duration limits must be ordered between one hour and ninety days. Execution delays must remain
between one hour and thirty days. Updating rules never changes existing deadlines.

Turnout is an absolute minimum number of ballots (`minimumVotes`), not a percentage of the
community. The existing contract restricts member-count reads to moderators, so governance
does not depend on those reads, an indexer, a trusted count, or extra community roles. Set an
appropriate minimum for the community before accepting treasury deposits.

Eligibility is checked when someone proposes or votes. New members can vote on existing open
proposals immediately, even in the same block as joining. Removed or banned members cannot cast
a ballot. Already cast ballots remain counted; leaving and rejoining never resets the one-ballot
limit. There are no membership snapshots or join-date checks.

Every ballot counts toward turnout. Binary approval is Yes / (Yes + No); abstention alone
never passes. A multiple-choice proposal requires one choice to meet the approval percentage.
Spending proposals are binary and fix asset, token standard, recipient and amount onchain.
Existing proposals retain their rules after ownership or rule changes. A proposer can cancel
a pending or active proposal; the owner can cancel only pending proposals and cannot veto a
passed payment. Ownership follows HupCommunity's existing two-step transfer.

## Treasury payments

After a spending proposal passes and its delay ends, anyone can submit `execute(proposalId)`.
This is a separate transaction, not an automatic scheduled payment. No owner signature is needed.
Execution is non-reentrant and marks the proposal executed before calling the vault. Failed
transfers roll back and can be retried after funding. Each community uses only its own vault.
Concurrent spending proposals do not reserve funds.

Native transfers use `call`, ERC20 transfers use SafeERC20, and LSP7 transfers use `force=true`.
Contract wallets, including Universal Profiles, can propose, vote, deposit and receive funds.
Governance uses the caller itself as identity; it does not support relayed sender suffixes.
Token deposits require approval/authorization for governance. The UI can query token balances
by asset without a token indexer. Fee-taking token deposits report the received balance delta;
tokens may also deduct fees from payouts.

## Build and activate

Use solc **0.8.36**, OpenZeppelin **5.6.1**, optimizer **1 run**, viaIR, and Cancun.
Run `node src/tests/deploy-artifacts/build-community-governance.cjs <solc-module-directory>
<openzeppelin-contracts-directory>`. This generates only the governance/treasury ABIs and
deployment artifacts, plus `src/contracts/v2/for-verification/community-governance.json`.
It never rebuilds or overwrites HupCommunity's source, ABI or artifact.

The governance ABI uses `minVotingPeriod` and `maxVotingPeriod` in rules, and `propose` takes
the creator's `votingPeriod` in seconds before the payment argument. If an earlier governance
version with a single global duration has already been deployed, this is a new deployment;
do not point this ABI at that older contract or replace its treasury references. Existing
HupCommunity deployments remain unchanged.

The Forge suite is `src/contracts/forge-test/evm/HupCommunityGovernance.t.sol`. Run it from
`src/contracts` with `forge test --match-path forge-test/evm/HupCommunityGovernance.t.sol
--optimizer-runs 1`, with a remapping to OpenZeppelin 5.6.1 as needed. Tests exercise the
unchanged HupCommunity implementation, including immediate joining, voting and proposing.

1. Deploy and verify **only HupCommunityGovernance**, passing the existing mainnet HupCommunity
   address as `source`. The deploy helper includes its artifact and verification input.
2. Set `communityGovernance` for that chain in `src/config/contracts.js`. Keep the existing
   `community` address. The UI verifies that governance's immutable source matches it.
3. Configure voting rules as the community owner and exercise small treasury payments before
   funding the treasury. Vaults are created automatically; no per-community group deployment,
   community redeployment, indexer migration, or member import is required.

Until configured, the UI indicates that governance/treasury deployment is pending and disables
writes. Proposals and treasury are inside each community's tab; no sidebar entry is needed.
Legacy proposal links continue to work. New links use
`/communities/{chain}/{community}/proposals/{proposal}` and can be attached to feed posts.
