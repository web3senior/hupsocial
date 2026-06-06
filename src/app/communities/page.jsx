'use client'

import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi'
import { parseEther } from 'viem'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'
import HupCommunityABI from '@/abis/HupCommunity'

const CONTRACT_ADDRESS = '0x021Ee55BaA5058A38A4BF3AAbd90f5c1b31068CD'

// Helper component to fetch, render, and update individual community data cards
function CommunityCard({ id }) {
  const { address: activeAccountAddress } = useAccount()
  const [isEditing, setIsEditing] = useState(false)

  // Update states for inline form
  const [editName, setEditName] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editLogoUrl, setEditLogoUrl] = useState('')
  const [editMembershipType, setEditMembershipType] = useState(0)
  const [editCommunityType, setEditCommunityType] = useState(0)

  // Contract data query hook
  const { data, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: HupCommunityABI,
    functionName: 'communities',
    args: [id],
  })

  // Contract modification hook for updating state
  const { 
    writeContract: updateContract, 
    data: updateHash, 
    isPending: isUpdatePending, 
    error: updateError 
  } = useWriteContract()

  const { 
    isLoading: isUpdateConfirming, 
    isSuccess: isUpdateConfirmed 
  } = useWaitForTransactionReceipt({ hash: updateHash })

  if (isLoading || !data) {
    return <div className={clsx(styles.card, styles['card--loading'])}>Loading space #{id}...</div>
  }

  const [, creator, membershipType, cType, metadataString] = data
  
  let metadata = {}
  try {
    metadata = JSON.parse(metadataString)
  } catch (e) {
    metadata = { name: `Space #${id}`, summary: 'Invalid metadata payload structure' }
  }

  const membershipLabels = ['Public', 'Request-Based', 'Private', 'NFT-Gated', 'Token-Gated']
  const typeLabels = ['Discussion', 'Broadcast']

  // Validate ownership block
  const isOwner = activeAccountAddress?.toLowerCase() === creator?.toLowerCase()

  const handleStartEditing = () => {
    setEditName(metadata.name || '')
    setEditSummary(metadata.summary || '')
    setEditDescription(metadata.description || '')
    setEditLogoUrl(metadata['logo url'] || '')
    setEditMembershipType(membershipType)
    setEditCommunityType(cType)
    setIsEditing(true)
  }

  const handleUpdateSubmit = (e) => {
    e.preventDefault()

    const updatedMetadataObj = {
      name: editName,
      summary: editSummary,
      description: editDescription,
      "logo url": editLogoUrl
    }
    const updatedMetadataString = JSON.stringify(updatedMetadataObj)

    updateContract({
      address: CONTRACT_ADDRESS,
      abi: HupCommunityABI,
      functionName: 'updateCommunity',
      args: [id, editMembershipType, updatedMetadataString],//TODO: need to redeploy the community   editCommunityType, 
    })
  }

  return (
    <div className={styles.card}>
      {!isEditing ? (
        <>
          <div className={styles.card__header}>
            {metadata['logo url'] && (
              <img src={metadata['logo url']} alt={metadata.name} className={styles.card__logo} />
            )}
            <div className={styles.card__titleGroup}>
              <h3 className={styles.card__title}>{metadata.name || `Community #${id}`}</h3>
              <span className={styles.card__creator}>By {creator.slice(0, 6)}...{creator.slice(-4)}</span>
            </div>
            {isOwner && (
              <button 
                type="button" 
                className={styles.card__editBtn}
                onClick={handleStartEditing}
              >
                Modify
              </button>
            )}
          </div>
          
          <p className={styles.card__summary}>{metadata.summary || metadata.description}</p>
          
          <div className={styles.card__tags}>
            <span className={styles.card__tag}>{membershipLabels[membershipType]}</span>
            <span className={styles.card__tag}>{typeLabels[cType]}</span>
          </div>
        </>
      ) : (
        <form className={styles.card__form} onSubmit={handleUpdateSubmit}>
          <div className={styles.card__formHeader}>
            <h4 className={styles.card__formTitle}>Modify Space #{id}</h4>
            <button 
              type="button" 
              className={styles.card__cancelBtn}
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </button>
          </div>

          <div className={styles.card__row}>
            <div className={styles.card__field}>
              <label className={styles.card__label}>Membership Rule</label>
              <select 
                className={styles.card__select}
                value={editMembershipType} 
                onChange={(e) => setEditMembershipType(Number(e.target.value))}
              >
                <option value={0}>Public</option>
                <option value={1}>Request-Based</option>
                <option value={2}>Private (Invite Only)</option>
                <option value={3}>NFT-Gated</option>
                <option value={4}>Token-Gated</option>
              </select>
            </div>

            <div className={styles.card__field}>
              <label className={styles.card__label}>Channel Type</label>
              <select 
                className={styles.card__select}
                value={editCommunityType} 
                onChange={(e) => setEditCommunityType(Number(e.target.value))}
              >
                <option value={0}>Discussion</option>
                <option value={1}>Broadcast</option>
              </select>
            </div>
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Name</label>
            <input 
              className={styles.card__input} 
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Short Summary</label>
            <input 
              className={styles.card__input} 
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              required
            />
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Description</label>
            <textarea 
              className={styles.card__textarea} 
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              required
            />
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Logo URL</label>
            <input 
              className={styles.card__input} 
              value={editLogoUrl}
              onChange={(e) => setEditLogoUrl(e.target.value)}
            />
          </div>

          <button 
            type="submit" 
            className={clsx(styles.card__submit, { [styles['card__submit--loading']]: isUpdatePending || isUpdateConfirming })}
            disabled={isUpdatePending || isUpdateConfirming}
          >
            {isUpdatePending ? 'Confirm Wallet...' : isUpdateConfirming ? 'Updating Block...' : 'Save Configuration'}
          </button>

          {updateHash && (
            <div className={styles.card__monitor}>
              <p className={styles.card__tx}>Tx: <span>{updateHash}</span></p>
              {isUpdateConfirming && <p className={styles.card__status}>Waiting for confirmation...</p>}
              {isUpdateConfirmed && <p className={clsx(styles.card__status, styles['card__status--success'])}>Changes committed on-chain!</p>}
            </div>
          )}
          
          {updateError && (
            <div className={styles.card__error}>
              Error: {updateError.shortMessage || updateError.message}
            </div>
          )}
        </form>
      )}
    </div>
  )
}

export default function CommunitiesPage() {
  // Metadata string construction form fields
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [logoUrl, setLogoUrl] = useState('')

  // Contract parameter enums selection handlers
  const [membershipType, setMembershipType] = useState(0) 
  const [communityType, setCommunityType] = useState(0)   

  // Write contract states with distinct namespace mapping
  const { 
    writeContract, 
    data: hash, 
    isPending, 
    error: createError 
  } = useWriteContract()
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  // Read contract data variables utilizing clear aliases to bypass scope collisions
  const { 
    data: countData, 
    isLoading: isCountLoading, 
    error: readError 
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: HupCommunityABI,
    functionName: 'communityCount',
  })

  const totalCommunities = countData ? Number(countData) : 0
  
  // Arrange array parameters to list recently launched spaces first
  const communityIds = Array.from({ length: totalCommunities }, (_, i) => i + 1).reverse()

  const handleCreate = (e) => {
    e.preventDefault()

    const metadataObj = {
      name,
      summary,
      description,
      "logo url": logoUrl
    }
    const metadataString = JSON.stringify(metadataObj)

    writeContract({
      address: CONTRACT_ADDRESS,
      abi: HupCommunityABI,
      functionName: 'createCommunity',
      args: [membershipType, communityType, metadataString],
      value: parseEther('0'), 
    })
  }

  return (
    <>
      <PageTitle name="Communities" />
      <div className={clsx(styles.page, 'animate', 'fade')}>
        <div className={clsx('__container', styles.page__container)} data-width="medium">
          <p className='alert alert--warning'>Live on Monad Testnet</p>
          {/* Form handling component for protocol-level actions */}
          <div className={styles.manager}>
            <div className={styles.manager__header}>
              <h2 className={styles.manager__title}>Launch a New Community</h2>
              <p className={styles.manager__subtitle}>Deploy an on-chain community registry with custom gating rules.</p>
            </div>

            <form className={styles.manager__form} onSubmit={handleCreate}>
              <div className={styles.manager__row}>
                <div className={styles.manager__field}>
                  <label className={styles.manager__label}>Membership Rule (Gating)</label>
                  <select 
                    className={styles.manager__select}
                    value={membershipType} 
                    onChange={(e) => setMembershipType(Number(e.target.value))}
                  >
                    <option value={0}>Public</option>
                    <option value={1}>Request-Based</option>
                    <option value={2}>Private (Invite Only)</option>
                    <option value={3}>NFT-Gated</option>
                    <option value={4}>Token-Gated</option>
                  </select>
                </div>

                <div className={styles.manager__field}>
                  <label className={styles.manager__label}>Channel Type (Permissions)</label>
                  <select 
                    className={styles.manager__select}
                    value={communityType} 
                    onChange={(e) => setCommunityType(Number(e.target.value))}
                  >
                    <option value={0}>Discussion (Members can post)</option>
                    <option value={1}>Broadcast (Read-only for members)</option>
                  </select>
                </div>
              </div>

              <div className={styles.manager__field}>
                <label className={styles.manager__label}>Community Name</label>
                <input 
                  className={styles.manager__input} 
                  placeholder="e.g., Alpha Node" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className={styles.manager__field}>
                <label className={styles.manager__label}>Short Summary</label>
                <input 
                  className={styles.manager__input} 
                  placeholder="A brief tagline for the community" 
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  required
                />
              </div>

              <div className={styles.manager__field}>
                <label className={styles.manager__label}>Full Description</label>
                <textarea 
                  className={styles.manager__textarea} 
                  placeholder="Detailed rules, manifesto, and purpose..." 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>

              <div className={styles.manager__field}>
                <label className={styles.manager__label}>Logo URL</label>
                <input 
                  className={styles.manager__input} 
                  placeholder="ipfs://... or https://..." 
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </div>

              <button 
                type="submit" 
                className={clsx(styles.manager__submit, { [styles['manager__submit--loading']]: isPending || isConfirming })}
                disabled={isPending || isConfirming}
              >
                {isPending ? 'Confirm in Wallet...' : isConfirming ? 'Mining Tx...' : 'Deploy Community'}
              </button>
            </form>

            {/* Network event feedback output window */}
            {hash && (
              <div className={styles.manager__monitor}>
                <p className={styles.manager__tx}>Tx: <span>{hash}</span></p>
                {isConfirming && <p className={styles.manager__status}>Waiting for block confirmation...</p>}
                {isConfirmed && <p className={clsx(styles.manager__status, styles['manager__status--success'])}>Community Successfully Registered!</p>}
              </div>
            )}
            
            {createError && (
              <div className={styles.manager__error}>
                Error: {createError.shortMessage || createError.message}
              </div>
            )}
          </div>

          {/* Directory view to display returned data models */}
          <div className={styles.directory}>
            <div className={styles.directory__header}>
              <h2 className={styles.directory__title}>Explore Communities</h2>
              <span className={styles.directory__count}>
                {isCountLoading ? 'Syncing...' : `${totalCommunities} Total`}
              </span>
            </div>
            
            {readError && (
              <div className={styles.manager__error}>
                Failed to sync community registry state: {readError.shortMessage || readError.message}
              </div>
            )}

            <div className={styles.directory__grid}>
              {communityIds.length === 0 && !isCountLoading ? (
                <p className={styles.directory__empty}>No communities found. Be the first to create one!</p>
              ) : (
                communityIds.map((id) => (
                  <CommunityCard key={id} id={id} />
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}