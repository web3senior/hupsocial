/**
 * @file lib/profileUpdateTracking.js
 * @description Pushes a profile that is already saved in Hup out to its Universal Profile
 * onchain: merges the fields into the UP's current LSP3Profile document, pins it, asks the
 * wallet to sign one setData, and reports the verdict through a toast.
 *
 * Lives in a module rather than in the editor because the editor closes as soon as the Hup save
 * lands — the pinning, the signature and the receipt all have to outlive it. Hup's own copy is
 * never touched here: it was written before this ran and stands whatever the chain does.
 */

import { getAccount, getPublicClient, switchChain, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { lukso } from 'wagmi/chains'
import { config } from '@/config/wagmi'
import { toast } from '@/components/NextToast'
import { encodeVerifiableURIFromDigest } from '@/lib/drops'
import { hashIpfsContent, uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import {
  LSP3_PROFILE_KEY,
  buildLsp3ProfileJson,
  erc725ySetDataAbi,
  linksToRows,
  lsp3ImageEntry,
  normalizeIpfsUri,
  readLsp3Profile,
  rowsToLsp3Links,
} from '@/lib/lsp3'

// Long enough for LUKSO to mine, short enough that a transaction nobody will ever see mined
// stops holding a toast open. Running out is not a verdict — the edit is saved in Hup either way.
const RECEIPT_TIMEOUT_MS = 120_000

const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Whether the document onchain already says what Hup now holds — if so, no signature is asked for. */
const matchesOnchain = (base, fields, links) =>
  !fields.imageUri &&
  fields.name === String(base.name ?? '').trim() &&
  fields.description === String(base.description ?? '').trim() &&
  sameList(fields.tags, Array.isArray(base.tags) ? base.tags : []) &&
  sameList(links, rowsToLsp3Links(linksToRows(base.links)))

/**
 * Syncs an already-saved Hup profile onto its Universal Profile. Never throws: every outcome is
 * reported to the user through the toast it opens.
 * @param {object} params
 * @param {string} params.address The Universal Profile to write.
 * @param {object} params.fields Saved values — `name`, `description`, `tags`, `links` (editor
 * rows), and for a newly pinned picture `imageUri` (`ipfs://…`) plus its `imageSize`.
 * @param {Function} [params.mutate] The profile page's SWR mutate, re-pulled once the write lands.
 */
export async function syncProfileToUniversalProfile({ address, fields, mutate }) {
  const handle = toast('Syncing to your Universal Profile…', 'loading')
  // The user may have navigated away — the verdict still deserves to be seen
  const report = (message, type) => {
    if (!handle.update(message, type)) toast(message, type)
  }

  try {
    const publicClient = getPublicClient(config, { chainId: lukso.id })
    if (!publicClient) {
      report('Saved on Hup. LUKSO is unreachable, so your Universal Profile is not synced yet.', 'info')
      return
    }

    /* Read at sync time rather than when the editor opened: this is the document the write
       merges into, and everything it holds that Hup does not edit — the background image above
       all — survives only because it is the base. A read that fails must stop the write. */
    const base = await readLsp3Profile(publicClient, address)
    if (!base) {
      report('Saved on Hup. Your Universal Profile could not be read, so it is not synced yet.', 'info')
      return
    }

    const links = rowsToLsp3Links(fields.links)
    if (matchesOnchain(base, fields, links)) {
      report('Your profile has been updated', 'success')
      return
    }

    let profileImage = null
    if (fields.imageUri) {
      // The digest is over the bytes a gateway serves, and a picture pinned seconds ago is the
      // slowest thing to hash — a null degrades to the unverified form rather than failing the save
      const imageDigest = await hashIpfsContent(fields.imageUri)
      profileImage = [lsp3ImageEntry(fields.imageUri, imageDigest, fields.imageSize)]
    }

    const json = withAuthor(
      buildLsp3ProfileJson({ base, name: fields.name, description: fields.description, tags: fields.tags, links, profileImage }),
      address,
    )
    const uri = normalizeIpfsUri(await uploadObjectToIPFS(json))
    const digest = await hashIpfsContent(uri)

    // writeContract asserts the connector's chain rather than switching it, so the switch is explicit
    if (getAccount(config).chainId !== lukso.id) await switchChain(config, { chainId: lukso.id })

    const hash = await writeContract(config, {
      abi: erc725ySetDataAbi,
      address,
      functionName: 'setData',
      args: [LSP3_PROFILE_KEY, encodeVerifiableURIFromDigest(uri, digest)],
      chainId: lukso.id,
    })

    const receipt = await waitForTransactionReceipt(config, { chainId: lukso.id, hash, timeout: RECEIPT_TIMEOUT_MS })
    if (receipt.status !== 'success') {
      report('Saved on Hup. The onchain update was rejected — open the editor and save again to retry.', 'error')
      return
    }

    report('Your Universal Profile has been updated', 'success')
    // The indexer's stamp moves with this write, which is what hands the profile read back to it
    if (mutate) mutate()
  } catch (error) {
    console.warn('Could not sync the profile onchain:', error.message)
    const rejected = error.name === 'UserRejectedRequestError' || /rejected|denied/i.test(error.shortMessage || error.message || '')
    report(
      rejected
        ? 'Saved on Hup. Your Universal Profile was left unchanged.'
        : 'Saved on Hup. The onchain sync did not go through — open the editor and save again to retry.',
      'info',
    )
  }
}
