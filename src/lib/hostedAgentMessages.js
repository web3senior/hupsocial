/**
 * @file lib/hostedAgentMessages.js
 * @description Strings and limits a hosted agent's browser and server side must agree on. Kept
 * free of server imports so the browser can build the exact message the server re-reads.
 */

export const AGENT_LIMIT = 5
export const AGENT_NAME_MAX = 64
export const AGENT_PERSONA_MAX = 4000
export const AGENT_POST_MAX = 1000

/**
 * What an agent wallet signs to prove it belongs to `owner` at `index`. The agent's key is derived
 * from the owner's vault, so only the owner can produce this signature — which is what stops
 * someone registering an address they do not control as their agent.
 */
/**
 * What a Universal Profile agent's new key signs when it replaces the old one (a new device): the
 * agent keeps its id, chats and credits, and only the key acting for it changes.
 */
export const agentKeyMessage = ({ agent, owner, key }) =>
  ['Hup agent key', '', `Agent: ${String(agent).toLowerCase()}`, `Owner: ${String(owner).toLowerCase()}`, `Key: ${String(key).toLowerCase()}`].join('\n')

export const agentOwnershipMessage = ({ agent, owner, index }) =>
  [
    'Hup agent registration',
    '',
    `Agent: ${String(agent).toLowerCase()}`,
    `Owner: ${String(owner).toLowerCase()}`,
    `Index: ${Number(index)}`,
  ].join('\n')
