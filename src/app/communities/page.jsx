'use client'

import { useState, useEffect } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, usePublicClient, useConnection } from 'wagmi'
import { parseEther } from 'viem'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'
import HupCommunityABI from '@/abis/HupCommunity'
import HupCoreABI from '@/abis/HupCore'

const CONTRACT_ADDRESS = '0x021Ee55BaA5058A38A4BF3AAbd90f5c1b31068CD'
const CORE_CONTRACT_ADDRESS = '0x77F884698945883841384bCA8bE6df17fCB7c04D'

// Dedicated presentation sub-component to isolate ERC-721 naming hooks safely
function NftTag({ tokenAddress, minBalance }) {
  const { data: nftName } = useReadContract({
    address: tokenAddress,
    abi: [{ name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }],
    functionName: 'name',
  })

  return (
    <span 
      className={styles.card__tag} 
      style={{ background: 'var(--bg-light)', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', fontSize: '0.8rem' }}
      title={`Contract: ${tokenAddress}`}
    >
      NFT: {nftName || `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`} (Min: {minBalance || '1'})
    </span>
  )
}

// Helper component to fetch, render, update, and post within individual community cards
function CommunityCard({ id }) {
  const { address, isConnected } = useConnection()
  const { address: activeAccountAddress } = useAccount()
  const publicClient = usePublicClient()
  
  const [isEditing, setIsEditing] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [communityPosts, setCommunityPosts] = useState([])
  const [isFeedLoading, setIsFeedLoading] = useState(false)

  // Update states for inline modifications
  const [editName, setEditName] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editLogoUrl, setEditLogoUrl] = useState('')
  const [editMembershipType, setEditMembershipType] = useState(0)
  const [editCommunityType, setEditCommunityType] = useState(0)

  // NFT Requirement Input States
  const [nftContractAddress, setNftContractAddress] = useState('')
  const [minNftBalance, setMinNftBalance] = useState('1')

  // New post content inputs
  const [postContent, setPostContent] = useState('')
  const [postAttachmentUrl, setPostAttachmentUrl] = useState('')

  // Contract data query hook
  const { data, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: HupCommunityABI,
    functionName: 'communities',
    args: [id],
  })

  // Read data directly from the automatically generated public mapping getter
  const { data: nftRequirementData, refetch: refetchNftRequirements } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: HupCommunityABI,
    functionName: 'nftRequirements',
    args: [id],
  })

  // Contract modification hook for updating space metadata
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

  // Contract modification hook for setting NFT configuration requirements
  const {
    writeContract: updateNftRequirement,
    data: nftHash,
    isPending: isNftPending,
    error: nftError
  } = useWriteContract()

  const {
    isLoading: isNftConfirming,
    isSuccess: isNftConfirmed
  } = useWaitForTransactionReceipt({ hash: nftHash })

  // Contract modification hook targeting Hup Core directly via background session authorization
  const {
    writeContract: publishPostContract,
    data: postHash,
    isPending: isPostPending,
    error: postError
  } = useWriteContract()

  const {
    isLoading: isPostConfirming,
    isSuccess: isPostConfirmed
  } = useWaitForTransactionReceipt({ hash: postHash })

  // Refresh NFT requirement state on successful block confirmation
  useEffect(() => {
    if (isNftConfirmed) {
      refetchNftRequirements()
    }
  }, [isNftConfirmed, refetchNftRequirements])

  // Query and filter feed arrays using a direct contract view function call
  useEffect(() => {
    const fetchCommunityFeed = async () => {
      if (!publicClient) return
      setIsFeedLoading(true)
      try {
        // Read directly from the core contract state instead of relying on RPC log intervals
        const feedData = await publicClient.readContract({
          address: CORE_CONTRACT_ADDRESS,
          abi: HupCoreABI,
          functionName: 'getFeed',
          args: [
            0n,   // Offset/Start index for pagination (adjust based on contract requirements)
            10n,  // Limit/Count of total items to return in the array pass
            address
          ],
        })

        // Ensure we have a valid array to map over
        const rawPosts = Array.isArray(feedData) ? feedData : []

        const filteredAndParsedPosts = rawPosts
          .map((post) => {
            // Adjust property keys based on the exact struct returned by your getFeed function
            const { id: postId, owner, metadata: rawMetadata } = post
            
            let parsedMeta = {}
            try {
              parsedMeta = JSON.parse(rawMetadata)
            } catch (err) {
              return null
            }

            // Verify if the metadata object matches this community context
            if (Number(parsedMeta.communityId) !== Number(id)) {
              return null
            }

            return {
              postId: postId ? postId.toString() : '0',
              author: owner,
              content: parsedMeta.content || '',
              attachment: parsedMeta.attachment || '',
              timestamp: parsedMeta.timestamp || Date.now()
            }
          })
          .filter(Boolean)
          // Sort to ensure the latest community items appear at the head of the list
          .sort((a, b) => b.timestamp - a.timestamp)

        setCommunityPosts(filteredAndParsedPosts)
      } catch (err) {
        console.error('Failed to parse feed data from core contract view:', err)
      } finally {
        setIsFeedLoading(false)
      }
    }

    fetchCommunityFeed()
  }, [id, publicClient, isPostConfirmed])

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

  const isOwner = activeAccountAddress?.toLowerCase() === creator?.toLowerCase()

  // Auto-generated mapping getters return fields in structural definition order
  // This layout structure maps fields as: [address tokenAddress, uint256 minimumBalance]
  const savedNftAddress = nftRequirementData ? nftRequirementData[0] : null
  const savedNftMinBalance = nftRequirementData ? nftRequirementData[1]?.toString() : null
  const hasValidNftAddress = savedNftAddress && savedNftAddress !== '0x0000000000000000000000000000000000000000'

  const handleStartEditing = () => {
    setEditName(metadata.name || '')
    setEditSummary(metadata.summary || '')
    setEditDescription(metadata.description || '')
    setEditLogoUrl(metadata['logo url'] || '')
    setEditMembershipType(membershipType)
    setEditCommunityType(cType)
    setNftContractAddress(savedNftAddress || '')
    setMinNftBalance(savedNftMinBalance || '1')
    setIsEditing(true)
    setIsPosting(false)
  }

  const handleStartPosting = () => {
    setPostContent('')
    setPostAttachmentUrl('')
    setIsPosting(true)
    setIsEditing(false)
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

    // Execute standard community info update rule
    updateContract({
      address: CONTRACT_ADDRESS,
      abi: HupCommunityABI,
      functionName: 'updateCommunity',
      args: [id, editMembershipType, updatedMetadataString], 
    })

    // Trigger update rule targeting public mapping setter when membership rule is set to NFT-Gated
    if (editMembershipType === 3 && nftContractAddress) {
      updateNftRequirement({
        address: CONTRACT_ADDRESS,
        abi: HupCommunityABI,
        functionName: 'setNftRequirement',
        args: [id, nftContractAddress, BigInt(minNftBalance)],
      })
    }
  }

  const handlePostSubmit = (e) => {
    e.preventDefault()

    if (!activeAccountAddress) return

    const postMetadataObj = {
      content: postContent,
      attachment: postAttachmentUrl,
      communityId: id,
      timestamp: Date.now()
    }
    
    const postMetadataString = JSON.stringify(postMetadataObj)

    publishPostContract({
      address: CORE_CONTRACT_ADDRESS,
      abi: HupCoreABI,
      functionName: 'create',
      args: [
        activeAccountAddress, 
        0,                     
        postMetadataString,   
        0,                     
        true                   
      ],
    })
  }

  return (
    <div className={styles.card}>
      {!isEditing && !isPosting && (
        <>
          <div className={styles.card__header}>
            {metadata['logo url'] && (
              <img src={metadata['logo url']} alt={metadata.name} className={styles.card__logo} />
            )}
            <div className={styles.card__titleGroup}>
              <h3 className={styles.card__title}>{metadata.name || `Community #${id}`}</h3>
              <span className={styles.card__creator}>By {creator.slice(0, 6)}...{creator.slice(-4)}</span>
            </div>
            <div className={styles.card__actionRow}>
              <button 
                type="button" 
                className={styles.card__postTriggerBtn}
                onClick={handleStartPosting}
              >
                Write Post
              </button>
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
          </div>
          
          <p className={styles.card__summary}>{metadata.summary || metadata.description}</p>
          
          <div className={styles.card__tags} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <span className={styles.card__tag}>{membershipLabels[membershipType]}</span>
            <span className={styles.card__tag}>{typeLabels[cType]}</span>
            
            {/* Render the extracted sub-component to eliminate the rule-of-hooks error */}
            {membershipType === 3 && hasValidNftAddress && (
              <NftTag tokenAddress={savedNftAddress} minBalance={savedNftMinBalance} />
            )}
          </div>

          {/* Sub-Feed Component Layer */}
          <div className={styles.feed}>
            <h4 className={styles.feed__title}>Recent Updates</h4>
            {isFeedLoading ? (
              <div className={styles.feed__loading}>Syncing feed events...</div>
            ) : communityPosts.length === 0 ? (
              <div className={styles.feed__empty}>No posts published in this space yet.</div>
            ) : (
              <div className={styles.feed__list}>
                {communityPosts.map((post) => (
                  <div key={post.postId} className={`${styles.feed__item} card`}>
                    <div className={`${styles.feed__itemHeader} card__body`}>
                      <span className={styles.feed__itemAuthor}>
                        {post?.author && post.author.slice(0, 6)}...{post?.author && post.author.slice(-4)}
                      </span>
                      <span className={styles.feed__itemTime}>
                        {new Date(post.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <p className={styles.feed__itemContent} style={{padding:`1rem`}}>{post.content}</p>
                    {post.attachment && (
                      <div className={styles.feed__itemMedia}>
                        <img src={post.attachment} alt="Attachment payload" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {isEditing && (
        <form className={styles.card__form} onSubmit={handleUpdateSubmit}>
          <div className={styles.card__formHeader}>
            <h4 className={styles.card__formTitle}>Modify Space #{id}</h4>
            <button type="button" className={styles.card__cancelBtn} onClick={() => setIsEditing(false)}>
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

          {/* Conditional Input UI layer for handling smart NFT registration gating configuration properties */}
          {editMembershipType === 3 && (
            <div className={clsx(styles.card__gatingRequirementSection, 'alert alert--info')} style={{ marginTop: '1rem', marginBottom: '1rem' }}>
              <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>NFT Gating Configuration</h5>
              <div className={styles.card__field}>
                <label className={styles.card__label}>NFT Token Address</label>
                <input 
                  className={styles.card__input} 
                  placeholder="0x..." 
                  value={nftContractAddress}
                  onChange={(e) => setNftContractAddress(e.target.value)}
                  required={editMembershipType === 3}
                />
              </div>
              <div className={styles.card__field} style={{ marginTop: '0.5rem' }}>
                <label className={styles.card__label}>Minimum NFT Balance Threshold</label>
                <input 
                  type="number"
                  className={styles.card__input} 
                  placeholder="1" 
                  min="1"
                  value={minNftBalance}
                  onChange={(e) => setMinNftBalance(e.target.value)}
                  required={editMembershipType === 3}
                />
              </div>
            </div>
          )}

          <div className={styles.card__field}>
            <label className={styles.card__label}>Name</label>
            <input className={styles.card__input} value={editName} onChange={(e) => setEditName(e.target.value)} required />
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Short Summary</label>
            <input className={styles.card__input} value={editSummary} onChange={(e) => setEditSummary(e.target.value)} required />
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Description</label>
            <textarea className={styles.card__textarea} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} required />
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Logo URL</label>
            <input className={styles.card__input} value={editLogoUrl} onChange={(e) => setEditLogoUrl(e.target.value)} />
          </div>

          <button type="submit" className={styles.card__submit} disabled={isUpdatePending || isUpdateConfirming || isNftPending || isNftConfirming}>
            {isUpdatePending || isNftPending ? 'Confirm Wallet...' : isUpdateConfirming || isNftConfirming ? 'Updating Block...' : 'Save Configuration'}
          </button>

          {(updateHash || nftHash) && (
            <div className={styles.card__monitor}>
              {updateHash && <p className={styles.card__tx}>Metadata Tx: <span>{updateHash}</span></p>}
              {nftHash && <p className={styles.card__tx}>NFT Requirement Tx: <span>{nftHash}</span></p>}
              {(isUpdateConfirming || isNftConfirming) && <p className={styles.card__status}>Waiting for confirmation...</p>}
              {(isUpdateConfirmed && (editMembershipType !== 3 || isNftConfirmed)) && <p className={clsx(styles.card__status, styles['card__status--success'])}>Changes committed on-chain!</p>}
            </div>
          )}
          
          {(updateError || nftError) && (
            <div className={styles.card__error}>
              Error: {updateError?.shortMessage || updateError?.message || nftError?.shortMessage || nftError?.message}
            </div>
          )}
        </form>
      )}

      {isPosting && (
        <form className={styles.card__form} onSubmit={handlePostSubmit}>
          <div className={styles.card__formHeader}>
            <h4 className={styles.card__formTitle}>New Post inside {metadata.name || `Space #${id}`}</h4>
            <button type="button" className={styles.card__cancelBtn} onClick={() => setIsPosting(false)}>
              Cancel
            </button>
          </div>

          <div className={styles.card__field}>
            <label className={styles.card__label}>Message Content</label>
            <textarea 
              className={styles.card__textarea} 
              placeholder="What is happening on-chain?"
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              required
            />
          </div>

          <div className={styles.manager__field}>
            <label className={styles.manager__label}>Media Attachment Link (Optional)</label>
            <input 
              className={styles.manager__input} 
              placeholder="ipfs://... or image address URL"
              value={postAttachmentUrl}
              onChange={(e) => setPostAttachmentUrl(e.target.value)}
            />
          </div>

          <button 
            type="submit" 
            className={clsx(styles.card__submit, { [styles['card__submit--loading']]: isPostPending || isPostConfirming })}
            disabled={isPostPending || isPostConfirming}
          >
            {isPostPending ? 'Confirm Wallet...' : isPostConfirming ? 'Publishing Transact...' : 'Broadcast Message'}
          </button>

          {postHash && (
            <div className={styles.card__monitor}>
              <p className={styles.card__tx}>Tx: <span>{postHash}</span></p>
              {isPostConfirming && <p className={styles.card__status}>Transmitting to core engine layer...</p>}
              {isPostConfirmed && <p className={clsx(styles.card__status, styles['card__status--success'])}>Message published successfully!</p>}
            </div>
          )}

          {postError && (
            <div className={styles.card__error}>
              Gating Failure: {postError.shortMessage || postError.message}
            </div>
          )}
        </form>
      )}
    </div>
  )
}

// Top-level layout entry default page export module
export default function CommunitiesPage() {
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [logoUrl, setLogoUrl] = useState('')

  const [membershipType, setMembershipType] = useState(0) 
  const [communityType, setCommunityType] = useState(0)   

  const { writeContract, data: hash, isPending, error: createError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  const { data: countData, isLoading: isCountLoading, error: readError } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: HupCommunityABI,
    functionName: 'communityCount',
  })

  const totalCommunities = countData ? Number(countData) : 0
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