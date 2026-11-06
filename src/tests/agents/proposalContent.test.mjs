import assert from 'node:assert/strict'
import test from 'node:test'
import { PROPOSAL_FILE_MAX_BYTES, proposalContentSchema, proposalElements, proposalFileType } from '../../lib/agentProposalContent.js'

const attachment = { cid: 'ipfs://bafytest', type: 'file', name: 'report.pdf', mimeType: 'application/pdf', size: 100, storage: 'IPFS' }

test('approved content keeps draft text and all attachment types in feed metadata', () => {
  const attachments = ['image', 'video', 'audio', 'file'].map((type) => ({ ...attachment, type }))
  const elements = proposalElements({ text: '  Updated digest  ', attachments })
  assert.equal(elements[0].data.text, 'Updated digest')
  assert.deepEqual(elements[1].data.items, attachments)
})

test('existing drafts without attachments still publish', () => {
  assert.deepEqual(proposalElements({ text: 'Digest' })[1].data.items, [])
})

test('rejects unsafe references, too many files, oversized files and invalid text', () => {
  const invalid = [
    { attachments: [{ ...attachment, cid: 'javascript:alert(1)' }] },
    { attachments: [{ ...attachment, cid: 'https://example.com/report.pdf' }] },
    { attachments: Array.from({ length: 9 }, () => attachment) },
    { attachments: [{ ...attachment, size: PROPOSAL_FILE_MAX_BYTES + 1 }] },
    { attachments: [{ ...attachment, size: 0 }] },
    { attachments: [{ ...attachment, name: '' }] },
    { text: ' ' },
    { text: 'x'.repeat(1001) },
  ]
  for (const change of invalid) assert.equal(proposalContentSchema.safeParse({ text: 'Digest', ...change }).success, false)
})

test('file metadata is classified as playable media or a download', () => {
  for (const type of ['image/png', 'video/mp4', 'audio/mpeg']) assert.equal(proposalFileType({ type }), type.split('/')[0])
  for (const type of ['', 'application/pdf', 'text/plain']) assert.equal(proposalFileType({ type }), 'file')
})
