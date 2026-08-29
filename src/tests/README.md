# IPFS payload schemes

Every JSON document Hup pins, with one sample file each. These are reference documents, not
fixtures — nothing imports them. They exist so the shape of a payload can be read without
tracing it back through the composer that builds it, and so a change to one of those builders
has something to be diffed against.

Values are illustrative. `0xe119…C4d0` stands in for the connected wallet throughout, and every
CID is elided to `...` after its prefix.

## The author stamp

Everything Hup publishes *openly* carries `author`: the wallet that pinned it, appended last. The
encrypted payloads carry nothing — see below, because that exemption is the load-bearing part.

A CID is content-addressed — it says what a document is and nothing about who wrote it. The
transaction carrying it is not a reliable answer either: a gasless post arrives from the relayer,
a Universal Profile calls through its own ERC725X `execute()`, and a burner session key signs on
its owner's behalf. Keeping the author inside the document keeps the two together no matter which
path the CID travelled, and survives being read straight off a gateway with no chain in reach.

One helper does it, `withAuthor` in [../lib/ipfs.js](../lib/ipfs.js), called at each pin site. An
unconnected wallet writes no key at all rather than an empty string.

### What is *not* stamped, and why

**Chat and posts to an encrypted community carry no `author`.** Not on the envelope, and not
inside the ciphertext either — the key is simply never written, anywhere, in any form.

Sealing it inside would have been the tempting half-measure, and it is the wrong one. A ciphertext
is only as private as its key, and a key outlives the moment it was used: an encrypted community
rotates its key to every member who joins later, and keys leak. An author sealed inside is a
record that has to be decrypted exactly once, years later, to attribute every word in a private
room to the wallet that wrote it. An author that was never written down cannot be recovered at all.

The envelopes already give up more than they look like they do — an encrypted community post
names its `communityId` and `keyVersion` in the clear, and a chat message is pinned against a
topic. Adding identity to that is the difference between "someone in this room said something"
and a full transcript with names on it.

Neither is an oversight to be tidied up later. Do not add the stamp to either one.

| Payload | Stamped? |
| --- | --- |
| Posts, articles, polls, markets, launches, events, mini apps, drops | yes |
| Community profiles — public, listed in the directory either way | yes |
| Posts to a *plaintext* community | yes |
| Posts to an *encrypted* community | **no** |
| Chat messages and chat contact lists | **no** |

Mechanically: the post composer applies the stamp *after* `sealForCommunity` has decided the
payload's shape, and skips it when what came back is an encrypted envelope. `Chat.jsx` has its
own uploader and never calls the helper at all.

## Posts

| Sample | What it is |
| --- | --- |
| [metadata-sample.json](metadata-sample.json) | A post — text plus the four media kinds. The baseline every other post shape extends. |
| [post-attachments-metadata-sample.json](post-attachments-metadata-sample.json) | The same envelope carrying every attachment reference at once. No real post has all of them; this is the union. |

Built by `getSerializablePostContent` in [../components/NewPost.jsx](../components/NewPost.jsx).
`elements` is positional — index 0 is always the text, index 1 always the media — and an
attachment is a *reference*, never a copy: the card resolves supply, price, or tally live, so a
stored post never carries a number that has since moved.

A media item writes `aiGenerated` only when the file itself declared a credential, never `false`.
An absent key costs nothing in the pinned JSON and leaves every post that predates the check
indistinguishable from one whose attachment simply carried no credential — both mean the same
thing: nothing was claimed.

| Reference key | Shape |
| --- | --- |
| `quoteOf` | post id, as a string — per-network, so it only means something beside the post's own chain |
| `communityId` | number |
| `nftListing` | `listingId, chainId, collection, tokenId, isLsp8, token, isTokenLsp7, price, referralBps` |
| `predictMarket` | `marketId, chainId` |
| `tokenLaunch` | `launchId, token, chainId` |
| `nftDrop` | `dropId, chainId, collection, standardId, name, symbol, image` |
| `miniApp` | `appId, chainId` |
| `poll` | `pollId, chainId` |
| `article` | the card, built by `makeArticleRef` — the body lives under its own CID |

## Communities

| Sample | What it is |
| --- | --- |
| [community-metadata-sample.json](community-metadata-sample.json) | A post in a plaintext community — an ordinary post payload tagged with `communityId`. |
| [community-metadata-encrypted-sample.json](community-metadata-encrypted-sample.json) | A post in an encrypted community. The envelope is all a non-member ever sees. What decrypts out of it looks like the sample above **minus `author`** — the stamp is never applied on this path. |
| [community-info-metadata-sample.json](community-info-metadata-sample.json) | The community's own profile — name, branding, links. |

Sealed by `sealForCommunity` in [../components/NewPost.jsx](../components/NewPost.jsx); the profile
is written by [../app/communities/_components/CreateCommunityModal.jsx](../app/communities/_components/CreateCommunityModal.jsx)
and edited in [../app/communities/page.jsx](../app/communities/page.jsx). `tag` and `links` are
omitted entirely when empty — cidex reads a missing `tag` as "this community grants no badge",
so writing it blank would take the pill off every member.

## Articles

| Sample | What it is |
| --- | --- |
| [article-body-sample.json](article-body-sample.json) | The markdown body, pinned under its own CID before the composer opens. |

Built by `makeArticleBody` in [../lib/article.js](../lib/article.js). Only the reader page ever
fetches it — the card in the post payload carries everything a feed needs.

## Onchain features

| Sample | Built in |
| --- | --- |
| [poll-metadata-sample.json](poll-metadata-sample.json) | [../components/CreatePollDialog.jsx](../components/CreatePollDialog.jsx) |
| [market-metadata-sample.json](market-metadata-sample.json) | [../components/CreateMarketDialog.jsx](../components/CreateMarketDialog.jsx), re-pinned on edit by [EditMarketDialog.jsx](../app/predict/%5BnetworkId%5D/%5BmarketId%5D/_components/EditMarketDialog.jsx) |
| [launch-metadata-sample.json](launch-metadata-sample.json) | [../components/CreateLaunchDialog.jsx](../components/CreateLaunchDialog.jsx) |
| [event-metadata-sample.json](event-metadata-sample.json) | [../components/ListEventDialog.jsx](../components/ListEventDialog.jsx) |
| [app-metadata-sample.json](app-metadata-sample.json) | [../components/ListAppDialog.jsx](../components/ListAppDialog.jsx) |

A poll publishes its `allowlist` in full when it has one: the Merkle root is already onchain, so
listing the members reveals nothing new and saves a voter hunting for the set to build a proof
against. `requirementLabels` is display copy for the requirement chips.

## Drops

| Sample | What it is |
| --- | --- |
| [drop-metadata-sample.json](drop-metadata-sample.json) | Collection metadata for ERC721/ERC1155, with OpenSea's contract-level `banner_image` / `external_link`. |
| [drop-metadata-lsp4-sample.json](drop-metadata-lsp4-sample.json) | The same collection as LSP4, for LSP7/LSP8. |

Written by [../components/CreateDropDialog.jsx](../components/CreateDropDialog.jsx) and republished
by [../components/DropManagePanel.jsx](../components/DropManagePanel.jsx); the LSP4 document comes
from `buildLsp4MetadataJson` in [../lib/drops.js](../lib/drops.js). The shape is keyed on the
token standard, not the chain.

Every LSP4 media entry is verifiable — it carries the keccak256 of the bytes its CID serves, and
the `LSP4Metadata` data key is itself a VerifiableURI hashed over the JSON *as the gateway serves
it*, since the pinning service re-serializes what we posted. `author` sits at the top level beside
`LSP4Metadata` rather than inside it: LSP4 defines the contents of that one key, and a reader
following the standard reaches for `json.LSP4Metadata` and ignores whatever else the file carries.

## Chat — no author stamp

| Sample | What it is |
| --- | --- |
| [chat-message-sample.json](chat-message-sample.json) | What is actually pinned: an AES-GCM envelope, and nothing else. |
| [chat-message-plaintext-sample.json](chat-message-plaintext-sample.json) | What decrypts out of it. Never pinned in this form. |
| [chat-contacts-sample.json](chat-contacts-sample.json) | The contact list, encrypted under the user's own key. |

All three from [../app/chat/_components/Chat.jsx](../app/chat/_components/Chat.jsx). The room key
is derived by ECDH from the topic, so the envelope names neither party — which is the whole point,
and why the author stamp stops at this boundary.

`senderAddr` in the plaintext sample is not the stamp under another name: it is decrypted by the
recipient to label the bubble, and it never leaves the browser unencrypted. The pinned document is
the envelope, and the envelope names nobody.

## Not a JSON scheme

[deploy-artifacts/](deploy-artifacts/) holds compiled contract artifacts and initcode for
verifying deployments — see its own README. [test.js](test.js) predicts a CREATE2 address and
checks it against the deployed one.
