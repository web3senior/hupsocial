/**
 * @file config/agentModels.js
 * @description The models an owner can give a hosted agent, all through AIML API's
 * chat-completions endpoint with tool calling. Prices are not kept here: every run is billed at
 * what AIML reports it cost, so a price change upstream can never make Hup charge the wrong amount.
 * `tier` is only a rough guide for the picker.
 */

export const AGENT_MODELS = Object.freeze([
  { id: 'openai/gpt-5-nano-2025-08-07', label: 'GPT-5 nano', tier: 'Lowest cost' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', tier: 'Low cost' },
  { id: 'openai/gpt-5-mini-2025-08-07', label: 'GPT-5 mini', tier: 'Medium cost' },
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', tier: 'Medium cost' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', tier: 'Higher cost' },
])

export const DEFAULT_AGENT_MODEL = AGENT_MODELS[0].id

export const isAgentModel = (id) => AGENT_MODELS.some((model) => model.id === id)

export const agentModelLabel = (id) => AGENT_MODELS.find((model) => model.id === id)?.label ?? id

// --- Credits ---

/** AIML's own unit, kept as-is so a run's cost is measured exactly as AIML reported it. */
export const CREDITS_PER_USD = 2_000_000

/** Hup's share on top of each run's model cost: a run AIML bills at $0.010 costs the agent $0.012. */
export const CREDIT_MARGIN = 1.2

/** Below this a run is refused before it starts: about what one short turn costs on the cheapest model. */
export const MIN_RUN_CREDITS = 2_000

/** The network a top-up defaults to; any Hup network's own coin is accepted. */
export const TOP_UP_CHAIN_ID = 42

/** Where top-ups go. Unset means they are off on this deployment. */
export const agentBillingAddress = () => process.env.NEXT_PUBLIC_AGENT_BILLING_ADDRESS || ''

export const creditsToUsd = (credits) => Number(credits) / CREDITS_PER_USD
