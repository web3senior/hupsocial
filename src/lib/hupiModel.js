/**
 * @file lib/hupiModel.js
 * @description The model side Hupi and hosted agents share: one AIML API client and one streamed
 * round with tool calls. Server-only.
 *
 * AIML API exposes an OpenAI-compatible surface, so this reuses the `openai` SDK with another
 * baseURL.
 */

import OpenAI from 'openai'

const AIML_BASE_URL = 'https://api.aimlapi.com/v1'
const DEFAULT_MODEL = 'openai/gpt-5-nano-2025-08-07'
/* GPT-5 models think before every round, and a turn has at least two rounds. Picking tools and
   phrasing counts needs no deliberation, so minimal is the default; the env can raise it. */
const DEFAULT_REASONING_EFFORT = 'minimal'
/* Reasoning counts toward this ceiling on GPT-5 models, so it carries headroom over the short
   reply itself */
export const DEFAULT_MAX_COMPLETION_TOKENS = 2000

/** @returns {{client: OpenAI, model: string}|null} Null when no API key is configured. */
export const createModelClient = () => {
  const apiKey = process.env.AIMLAPI_API_KEY
  if (!apiKey) return null
  return { client: new OpenAI({ apiKey, baseURL: AIML_BASE_URL }), model: process.env.AIMLAPI_MODEL || DEFAULT_MODEL }
}

/**
 * One streamed model round. Text is handed to `onText` as it arrives; tool calls arrive in
 * pieces keyed by index and are only usable once the stream ends, so they are assembled here.
 * AIML reports what the round cost in the final chunk's `meta.usage.credits_used`
 * (2,000,000 credits to the dollar); hosted agents are billed from it, Hupi ignores it.
 * @returns {Promise<{text: string, calls: object[], creditsUsed: number}>}
 */
export const streamRound = async ({ client, model, messages, tools, signal, onText, maxCompletionTokens = DEFAULT_MAX_COMPLETION_TOKENS }) => {
  const reasoningEffort = process.env.AIMLAPI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT
  const stream = await client.chat.completions.create(
    {
      model,
      messages,
      ...(tools ? { tools } : {}),
      max_completion_tokens: maxCompletionTokens,
      ...(/gpt-5/.test(model) ? { reasoning_effort: reasoningEffort } : {}),
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal },
  )

  let text = ''
  let creditsUsed = 0
  const calls = []
  for await (const chunk of stream) {
    if (chunk.meta?.usage?.credits_used) creditsUsed = Number(chunk.meta.usage.credits_used) || 0
    const delta = chunk.choices?.[0]?.delta
    if (!delta) continue

    if (delta.content) {
      text += delta.content
      onText(delta.content)
    }

    for (const part of delta.tool_calls ?? []) {
      const call = (calls[part.index ?? 0] ??= { id: '', type: 'function', function: { name: '', arguments: '' } })
      if (part.id) call.id = part.id
      // OpenAI sends the name once; Claude through AIML repeats it on every chunk, so only the first counts
      if (part.function?.name && !call.function.name) call.function.name = part.function.name
      if (part.function?.arguments) call.function.arguments += part.function.arguments
    }
  }

  return { text, calls: calls.filter((call) => call?.function.name), creditsUsed }
}
