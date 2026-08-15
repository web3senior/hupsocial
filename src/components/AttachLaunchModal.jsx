'use client'

import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { useConnection } from 'wagmi'
import { CoinIcon, PlusIcon } from '@phosphor-icons/react'
import CreateLaunchDialog from './CreateLaunchDialog'
import NativeDialog from './ui/NativeDialog'
import styles from './AttachLaunchModal.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * Attach Launch Modal
 * Lets the post composer attach a token launch on the post's chain: either one the author already
 * created (from the indexed API), or a brand-new one created inline via CreateLaunchDialog — the
 * launch id is read from the creation receipt so the attachment never waits on the indexer.
 *
 * @param {Object} props
 * @param {number} props.chainId The chain the post lands on — the launch is pinned to it too.
 * @param {string} [props.prefillImage] IPFS CID of the post's first image, offered as the token image.
 * @param {string} [props.prefillDescription] Post text, seeding the token description.
 * @param {Function} props.onAttached Receives the { launchId, token, chainId } content reference.
 * @param {Function} props.onClose Clears the open-modal state on close.
 */
const AttachLaunchModal = ({ chainId, prefillImage = '', prefillDescription = '', onAttached, onClose }) => {
  const dialogRef = useRef(null)
  const createDialogRef = useRef(null)
  const { address } = useConnection()

  // Mount = open / unmount = close, matching the TipModal dialog contract
  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const { data: mine } = useSWR(
    address ? `/api/v1/launches?scope=mine&creator=${address.toLowerCase()}&networkId=${chainId}&limit=50` : null,
    fetcher,
  )

  const myLaunches = mine?.data ?? []

  const handleCreated = (launchRef) => {
    // Receipt parsing can fail on exotic RPCs — the launch exists onchain either way, the picker
    // just stays open so the author can attach it manually once indexed
    if (launchRef?.launchId) {
      onAttached({ launchId: launchRef.launchId, token: launchRef.token, chainId })
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.attachLaunch}
      aria-label="Attach a token launch"
      onClick={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation()
        onClose?.()
      }}
    >
      <header className={styles.attachLaunch__header}>
        <button type="button" className={styles.attachLaunch__cancel} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <h3>Attach a token</h3>
      </header>

      <main className={styles.attachLaunch__body}>
        <button
          type="button"
          className={styles.attachLaunch__create}
          // The create dialog stacks on top of this one in the browser's top layer; the picker
          // stays open underneath so canceling creation falls back to it
          onClick={() => createDialogRef.current?.open()}
        >
          <PlusIcon size={16} />
          Launch a new token
        </button>

        {myLaunches.length > 0 && (
          <>
            <p className={styles.attachLaunch__sectionTitle}>Or pin one of yours</p>
            <ul className={styles.attachLaunch__list}>
              {myLaunches.map((launch) => (
                <li key={`${launch.network_id}-${launch.launch_id}`}>
                  <button
                    type="button"
                    onClick={() =>
                      onAttached({ launchId: String(launch.launch_id), token: launch.token, chainId })
                    }
                  >
                    <CoinIcon size={16} />
                    <span>
                      {launch.name} <em>${launch.symbol}</em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      <CreateLaunchDialog
        ref={createDialogRef}
        fixedChainId={chainId}
        prefillImage={prefillImage}
        prefillDescription={prefillDescription}
        onCreated={handleCreated}
      />
    </NativeDialog>
  )
}

export default AttachLaunchModal
