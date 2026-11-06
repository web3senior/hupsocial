import { z } from 'zod'
import { AGENT_POST_MAX } from './hostedAgentMessages.js'

export const PROPOSAL_FILE_MAX = 8
export const PROPOSAL_FILE_MAX_BYTES = 10 * 1024 * 1024
export const EDITABLE_PROPOSAL_KINDS = new Set(['post', 'edit', 'reply'])

export const proposalAttachmentsSchema = z.array(z.object({
  cid: z.string().regex(/^ipfs:\/\/[a-zA-Z0-9]+(?:\/[^\s?#]*)?$/).max(500),
  type: z.enum(['image', 'video', 'audio', 'file']),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().max(150),
  size: z.number().int().positive().max(PROPOSAL_FILE_MAX_BYTES),
  storage: z.literal('IPFS'),
})).max(PROPOSAL_FILE_MAX)

export const proposalContentSchema = z.object({
  text: z.string().trim().min(1).max(AGENT_POST_MAX),
  attachments: proposalAttachmentsSchema.default([]),
})

export const proposalFileType = (file) => {
  const type = file.type.split('/')[0]
  return ['image', 'video', 'audio'].includes(type) ? type : 'file'
}

/** Keep the post's published content in the format used by Hup's feed. */
export const proposalElements = (proposal) => {
  const { text, attachments } = proposalContentSchema.parse(proposal)
  return [
    { type: 'text', data: { text } },
    { type: 'media', data: { items: attachments } },
  ]
}
