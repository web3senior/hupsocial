# Prompt and scoring rubric

Run the prompt below twice with identical wording: once in a session that has the Gateway but
not the Recipe, once with both. Do not add hints in the second run; the Recipe is the only
difference.

## The prompt

```
Find the three most traded Hup launches on Base Sepolia over the last 24 hours and summarize
each one with its price, market cap, 24h volume and top holder. Give dollar figures where
possible and say where the data came from.
```

Base Sepolia is `networkId=84532`. The correct approach is one call to
`GET /api/v1/launches?networkId=84532&sort=vol24h&stats=1&limit=3`, then one call to
`GET /api/v1/launches/84532/{launch_id}/holders?limit=1` per launch, with every raw base-unit
figure scaled by `quote_decimals` and converted with `quote_usd`.

## Scoring rubric

Score each run out of 20. Record the score beside the transcript.

| Criterion | Points | What earns them |
| --- | --- | --- |
| Correct chain | 2 | Uses `networkId=84532` rather than guessing or asking for an address. |
| Correct ranking | 3 | Uses `sort=vol24h` with `stats=1` (or reads `volume_24h`), not lifetime `volume_native` or the default trending order. |
| Correct call sequence | 3 | Reaches the holders route with the numeric `launch_id`, not the token address, and calls it once per launch. |
| Unit handling | 4 | Divides raw base units by `10 ** quote_decimals` and multiplies by `quote_usd`; no figure is off by a power of ten. |
| Market cap | 2 | Computes price times one billion tokens, not something invented. |
| Top holder | 2 | Names the largest holder from the holders route by display name or shortened address, with their share of supply. |
| Honesty about gaps | 2 | Says when `quote_usd` is null, when fewer than three launches have volume, or when the index may lag. |
| Efficiency | 2 | No more than five paid calls in total; no retries of a call that already succeeded. |

Expected pattern: without the Recipe the agent tends to lose points on ranking (defaults to
trending or lifetime volume), on the call sequence (passes the token address to the holders
route and gets a 400), and on units (reports raw wei as dollars). With the Recipe those three
rows should be full marks, and the total should move by at least six points.

## What to keep

- Both full transcripts, unedited.
- The two scores and a one-line note per criterion where they differ.
- The Gateway's request log for both runs, if the dashboard exposes it, so reviewers can count
  paid calls.
