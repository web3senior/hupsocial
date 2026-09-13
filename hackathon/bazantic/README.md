# Bazantic Continuity prize: submission steps

The Continuity prize asks for a paid API exposed through a Bazantic x402 / MPP Gateway, a Recipe
that teaches an AI agent how to use it, and evidence that the Recipe changes the agent's answer.
Our API is the public, read-only Hup Launch data described in `gateway-spec.md`. Every step
below is something the submitter does by hand; nothing in the app repo changes.

Files in this folder:

- `gateway-spec.md`: the endpoints, query parameters and response fields to enter in the Gateway.
- `recipe.md`: the Recipe text to paste, written for an AI agent.
- `prompts.md`: the prompt to run twice, plus the scoring rubric for the comparison.

## Steps

1. Create an account at https://bazantic.com and note the username. The username is part of the
   submission, so use one you are happy to publish.
2. Create a new Gateway. Choose the x402 / MPP payment type the dashboard offers and set the
   upstream base URL to `https://hup.social`. The exact menu names may differ from these notes;
   what matters is that the upstream is `https://hup.social` and the routes are the ones below.
3. Add the public GET routes from `gateway-spec.md`:
   - `/api/v1/launches`
   - `/api/v1/launches/{networkId}/{id}`
   - `/api/v1/launches/{networkId}/{id}/holders`
   - `/api/v1/launches/{networkId}/{id}/leaderboard`
   - `/api/v1/launches/{networkId}/{id}/trades`
   - `/api/v1/launches/quotes`
   Copy each route's query parameters and response fields from the spec so the Gateway's own
   schema matches what the API really returns.
4. Set a price per call. A small flat price is fine for the demo; the point is that an agent can
   pay per request rather than hold an API key.
5. Test the Gateway with one call, for example
   `GET /api/v1/launches?networkId=84532&sort=vol24h&stats=1&limit=3`, and confirm the JSON comes
   back with `success: true` and a `data` array.
6. Create a Recipe attached to the Gateway. Paste the contents of `recipe.md` as the Recipe body.
   Keep the title short, for example "Hup Launch market data".
7. Open an agent session that has access to the Gateway but not the Recipe. Run the prompt from
   `prompts.md` exactly as written. Save the full response.
8. Open a second agent session with the Gateway and the Recipe both enabled. Run the same prompt,
   unchanged. Save the full response.
9. Score both responses with the rubric in `prompts.md` and keep the two scores next to the
   two transcripts.
10. Record a short screen video (two to four minutes) that shows: the Gateway configuration, the
    Recipe, the first run without the Recipe, the second run with it, and the two scores side by
    side. Narration is optional; captions or a title card per step are enough.
11. Submit the video link, the Bazantic username, the Gateway name and a link to this folder in
    the repository (https://github.com/web3senior/hupsocial/tree/main/hackathon/bazantic).

## Notes for whoever records the video

- Base Sepolia is `networkId=84532`. It is the chain with live launches at the time of writing;
  a mainnet id returns an empty `data` array until the factory is deployed there.
- Launch ids restart from 1 on every chain, so always pass `networkId` together with an id.
- The `[id]` segment of the single-launch route accepts either the token address or the numeric
  launch id; the holders, leaderboard and trades routes take the numeric id only.
- The API reads from an indexer database. A launch created seconds ago may not be in the list
  yet, which is expected and worth saying out loud if it comes up in the video.
