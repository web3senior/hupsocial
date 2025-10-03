'use client'

import { useEffect, useState, Suspense, useRef } from 'react'
import { FluentProvider, webLightTheme, Badge, Textarea, Input, Label, InteractionTag } from '@fluentui/react-components'
import { useId, Button } from '@fluentui/react-components'
import Image from 'next/image'
import Link from 'next/link'
import Icon from '../../../helper/MaterialIcon'
import Nav from '../nav'
import blueCheckMarkIcon from '@/../public/icons/blue-checkmark.svg'
import { useAuth } from '@/contexts/AuthContext'
import { useParams } from 'next/navigation'
import Web3 from 'web3'
import { getProfile, updateProfile } from '../../../util/api'
import { initContract, initStatusContract, getEmoji, getStatus, getMaxLength } from '@/util/communication'
import { toast } from '@/components/NextToast'
import abi from '@/abi/hup.json'
import statusAbi from '@/abi/status.json'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import { useConnectorClient, useConnections, useClient, networks, useWaitForTransactionReceipt, useAccount, useDisconnect, Connector, useConnect, useWriteContract, useReadContract } from 'wagmi'
import moment from 'moment'
import { InlineLoading } from '@/components/Loading'
import styles from './page.module.scss'

export default function Page() {
  const [isLoading, setIsLoading] = useState(false)
  const [data, setData] = useState()
  const [activeTab, setActiveTab] = useState('posts') // New state for active tab
  const params = useParams()
  const { web3, contract } = initContract()

  const handleForm = async (e) => {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.target)
    const fullname = formData.get('fullname')
    const phone = formData.get('phone')
    const address = formData.get('address')
    const wallet = formData.get('wallet')
    const errors = {}

    const post = {
      fullname: fullname,
      phone: phone,
      address: address,
      wallet: wallet,
    }

    updateProfile(post).then((res) => {
      console.log(res)
      toast(`${res.message}`, 'success')
    })
  }

  useEffect(() => {}, [])

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <h3 className={`page-title`}>profile</h3>

        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          <div className={`${styles.profileWrapper}`}>
            <Profile addr={params.wallet} />
          </div>

          <ul className={`${styles.tab} flex flex-row align-items-center justify-content-center w-100`}>
            <li>
              <button className={activeTab === 'posts' ? styles.activeTab : ''} onClick={() => setActiveTab('posts')}>
                Posts <span className={`lable lable-dark`}>0</span>
              </button>
            </li>
            <li>
              <button className={activeTab === 'activity' ? styles.activeTab : ''} onClick={() => setActiveTab('activity')}>
                Activity
              </button>
            </li>
            <li>
              <button className={activeTab === 'reposts' ? styles.activeTab : ''} onClick={() => setActiveTab('reposts')}>
                Reposts
              </button>
            </li>
          </ul>

          {activeTab === 'posts' && (
            <div className={`${styles.tabContent} ${styles.posts} relative`}>
              <Post addr={params.wallet} />
            </div>
          )}

          {activeTab === 'activity' && (
            <div className={`${styles.tabContent} ${styles.activity} relative`}>
              <NoData name={`activity`} />
            </div>
          )}

          {activeTab === 'reposts' && (
            <div className={`${styles.tabContent} ${styles.reposts} relative`}>
              <NoData name={`reposts`} />
            </div>
          )}
        </div>
      </div>
    </FluentProvider>
  )
}
/**
 * No data in tab content
 * @param {*} param0
 * @returns
 */
const NoData = ({ name }) => {
  return (
    <div className={`${styles.tabContent} ${styles.posts} d-f-c`}>
      <p>No {name} yet.</p>
    </div>
  )
}

/**
 * Profile
 * @param {String} addr
 * @returns
 */
const Profile = ({ addr }) => {
  const [profile, setProfile] = useState({
    data: {
      Profile: [
        {
          id: '0x0d5c8b7cc12ed8486e1e0147cc0c3395739f138d',
          fullName: 'arattalabs#0D5C',
          tags: ['dev', 'founder', 'dao'],
          standard: 'LSP0ERC725Account',
          transactions_aggregate: {
            aggregate: {
              count: 1122,
            },
          },
          profileImages: [
            {
              src: 'https://api.universalprofile.cloud/image/QmaZqvrtLtLCaYth3DiN6KS1SK6nuGSXXzimxghvjpiQtJ?method=keccak256(bytes)&data=0x27a297c9605a4ab6118627a1aa8e513e44ae2816a26bde2d9f15a87497d110a8',
              url: 'ipfs://QmaZqvrtLtLCaYth3DiN6KS1SK6nuGSXXzimxghvjpiQtJ',
            },
            {
              src: 'https://api.universalprofile.cloud/image/QmcnBYzr4DJhWQce7tERAiTip2dz6yQBXFjQ8zweG5wuDH?method=keccak256(bytes)&data=0x33e4a6a4e6e105b224e590d51b0f13504a877a283cff22036b65f665955ed1ae',
              url: 'ipfs://QmcnBYzr4DJhWQce7tERAiTip2dz6yQBXFjQ8zweG5wuDH',
            },
            {
              src: 'https://api.universalprofile.cloud/image/QmPGHJV7AK2RYLSu6B1a6YjTfKNVbmDJMNJJTbeUaLGtZg?method=keccak256(bytes)&data=0x448485c195adf3a4a9a991d8d143fb6352cb86ac512426f392d485ba53f52c9e',
              url: 'ipfs://QmPGHJV7AK2RYLSu6B1a6YjTfKNVbmDJMNJJTbeUaLGtZg',
            },
          ],
          name: 'arattalabs',
          isEOA: false,
          isContract: true,
          followed_aggregate: {
            aggregate: {
              count: 454,
            },
          },
          following_aggregate: {
            aggregate: {
              count: 24,
            },
          },
          description: 'Aratta Labs is a Web3 blockchain guild',
          createdBlockNumber: 1236480,
          createdTimestamp: 1699971948,
          lastMetadataUpdate: 5656224,
          url: 'ipfs://QmWoLLLvxhU1YoMdnoq1HoxnKXYJHx7B6iwzecSNe95D8s',
        },
      ],
    },
  })
  const [selfView, setSelfView] = useState()
  const params = useParams()
  const defaultUsername = `hup-user`
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  /* Error during submission (e.g., user rejected)  */
  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()
  /* Error after mining (e.g., transaction reverted) */
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
  })

  const follow = async () => toast(`Coming soon `, `warning`)

  const handleDisconnect = async () => {
    disconnect()

    setTimeout(() => {
      window.location.reload()
    }, 1000)
  }

  useEffect(() => {
    getProfile(addr).then((res) => {
      console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setProfile(res)
        setSelfView(addr.toString().toLowerCase() === res.data.Profile[0].id.toLowerCase())
      }
    })
  }, [])

  if (!profile) return <div className={`shimmer ${styles.shimmer}`} />

  return (
    <>
      <section className={`${styles.profile} relative flex flex-column align-items-start justify-content-start gap-1`}>
        <header className={`flex flex-row align-items-center justify-content-between gap-050`}>
          <div className={`flex-1 flex flex-column align-items-start justify-content-center gap-025`}>
            <div className={`flex align-items-center gap-025`}>
              <h1 className={`${styles.profile__name}`}>{profile.data.Profile[0].name ?? defaultUsername}</h1>
              <img className={`${styles.profile__checkmark}`} alt={`Checkmark`} src={blueCheckMarkIcon.src} />
            </div>

            <code className={`${styles.profile__wallet}`}>
              <Link href={`https://explorer.lukso.network/address/${profile.data.Profile[0].id}`} target={`_blank`}>
                {`${profile.data.Profile[0].id.slice(0, 4)}…${profile.data.Profile[0].id.slice(38)}`}
              </Link>
            </code>

            <p className={`${styles.profile__description} mt-20`}>{profile.data.Profile[0].description || `This user has not set up a bio yet.`}</p>

            <div className={`${styles.profile__tags} flex flex-row align-items-center flex-wrap gap-050`}>{profile.data.Profile[0].tags && profile.data.Profile[0].tags.map((tag, i) => <small key={i}>#{tag}</small>)}</div>
          </div>

          <div className={`${styles.profile__pfp} relative`}>
            <figure className={`rounded`}>
              <img
                alt={profile.data.Profile[0].name || `PFP`}
                src={`${profile.data.Profile[0].profileImages.length > 0 ? profile.data.Profile[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
              />
            </figure>

            <Status addr={addr} profile={profile} selfView={selfView} />
          </div>
        </header>

        <footer className={`w-100`}>
          <ul className={`flex flex-column align-items-center justify-content-between gap-1`}>
            <li className={`flex flex-row align-items-start justify-content-start gap-025 w-100`}>
              <button className={`${styles.btnFollowers}`}>
                <span className={`mt-20 text-secondary`}>{profile.data.Profile[0].followed_aggregate.aggregate.count} followers</span>
              </button>
              <span>•</span>
              <Link className={`${styles.link}`} target={`_blank`} href={`https://hup.social/u/${addr}`}>
                hup.social/u/{`${addr.slice(0, 4)}…${addr.slice(38)}`}
              </Link>
            </li>
            {selfView && (
              <li className={`w-100 grid grid--fit gap-1`} style={{ '--data-width': `200px` }}>
                <button className={`${styles.profile__btnFollow}`} onClick={() => follow()}>
                  Edit profile
                </button>
                {isConnected && address.toString().toLowerCase() === params.wallet.toString().toLowerCase() && (
                  <button className={`${styles.profile__btnDisconnect}`} onClick={() => handleDisconnect()}>
                    Disconnect
                  </button>
                )}
              </li>
            )}
            {!selfView && (
              <li className={`w-100 grid grid--fit gap-1`} style={{ '--data-width': `200px` }}>
                <button className={`${styles.profile__btnFollow}`} onClick={() => follow()}>
                  Follow
                </button>
              </li>
            )}
          </ul>
        </footer>
      </section>
    </>
  )
}

const Status = ({ addr, profile, selfView }) => {
  const placeholders = [
    'Share a short status',
    "What's on your mind?",
    'Working on a new idea...',
    'The best thing I saw today was...',
    "What's the next big thing in Web3?",
    'Launching something new soon!',
    'Share one emoji that describes your day.',
    'I just learned something new about...',
    'How are you feeling in 3 emojis?',
    'A random memory that popped up today...',
    'What book/podcast should everyone check out?',
    'Best DAO right now?',
    'Next trend?',
    'Your biggest gain today?',
    'Share a mini dapp',
    'Bull or bear today?',
    'My last trade was...',
    'Watching [Coin Ticker]...',
    'Favorite yield farm?',
    'Best dating advice received?',
    'Tell us about your crush...',
    'What makes a perfect date?',
  ]
  const [showModal, setShowModal] = useState(false)
  const [status, setStatus] = useState()
  const [statusContent, setStatusContent] = useState('')
  const [expirationTimestamp, setExpirationTimestamp] = useState(24)
  const [maxLength, setMaxLength] = useState()
  const { web3, contract } = initContract()
  const { contract: statusContract } = initStatusContract()
  const statusRef = useRef(``)

  /* Error during submission (e.g., user rejected)  */
  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()
  /* Error after mining (e.g., transaction reverted) */
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
  })
  /**
   * Selects a random placeholder phrase from the list.
   * @returns {string} The randomly selected placeholder text.
   */
  function getRandomPlaceholder() {
    // 1. Math.random() generates a floating point number between 0 (inclusive) and 1 (exclusive).
    // 2. We multiply it by the array's length to get a number between 0 and array.length.
    // 3. Math.floor() rounds this number down to the nearest whole integer, giving us a valid array index.
    const randomIndex = Math.floor(Math.random() * placeholders.length)
    return placeholders[randomIndex]
  }

  const clearStatus = () => {
    try {
      const result = writeContract({
        abi: statusAbi,
        address: process.env.NEXT_PUBLIC_CONTRACT_STATUS,
        functionName: 'clearStatus',
        args: [],
      })
      console.log('Transaction sent:', result)
    } catch (error) {
      console.error('Contract write failed:', error)
    }
  }

  const updateStatus = (e) => {
    writeContract({
      abi: statusAbi,
      address: process.env.NEXT_PUBLIC_CONTRACT_STATUS,
      functionName: 'updateStatus',
      args: [statusContent, 'public', '', 24],
    })
  }

  // const getStatus = async () => {
  //   // const result = await readContract(config, {
  //   //   statusAbi,
  //   //   address: process.env.NEXT_PUBLIC_CONTRACT_STATUS,
  //   //   functionName: 'notes',
  //   //   args: [`${addr}`],
  //   // })

  //   // return result

  //   statusContract
  // }
  useEffect(() => {
    getStatus(addr).then((res) => {
      console.log(res)
      setStatus(res)
    })

    getMaxLength().then((res) => {
      console.log(res)
      setMaxLength(web3.utils.toNumber(res))
    })
  }, [showModal])
  return (
    <>
      {showModal && (
        <div className={`${styles.statusModal} animate fade`} onClick={() => setShowModal(false)}>
          <div className={`${styles.statusModal__card}`} onClick={(e) => e.stopPropagation()}>
            <header className={``}>
              <div className={``} aria-label="Close" onClick={() => setShowModal(false)}>
                <svg class="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="16" role="img" viewBox="0 0 24 24" width="16">
                  <title>Close</title>
                  <line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="21" x2="3" y1="3" y2="21"></line>
                  <line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="21" x2="3" y1="21" y2="3"></line>
                </svg>
              </div>
              <div className={`flex-1`}>
                <h3>Set your status</h3>
              </div>
              <div className={`pointer`} onClick={(e) => updateStatus(e)}>
                {isSigning ? `Signing...` : isConfirming ? 'Confirming...' : status && status.content !== '' ? `Update` : `Share`}
              </div>
            </header>

            <main className={`flex flex-column align-items-center gap-1 `}>
              <div className={`${styles.statusModal__pfp} relative`}>
                <figure className={`rounded`}>
                  <img
                    alt={profile.data.Profile[0].name || `PFP`}
                    src={`${profile.data.Profile[0].profileImages.length > 0 ? profile.data.Profile[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
                  />
                </figure>

                <div className={`d-f-c`} title={status && status.content !== '' && moment.unix(web3.utils.toNumber(status.timestamp)).utc().fromNow()}>
                  <textarea autoFocus defaultValue={status && status !== '' ? status.content : statusContent} onInput={(e) => setStatusContent(e.target.value)} placeholder={`${getRandomPlaceholder()}`} maxLength={maxLength ? maxLength : 60} />
                </div>
              </div>

              <div className={`${styles.statusModal__expirationTimestamp} relative`}>
                <label htmlFor="">Clear after </label>
                <select name="" id="" onChange={(e) => setexpirationTimestamp(e.target.value)}>
                  <option value={24}>24h</option>
                  <option value={8}>8h</option>
                  <option value={6}>6h</option>
                  <option value={4}>4h</option>
                  <option value={1}>1h</option>
                  <option value={0}>∞</option>
                </select>
              </div>

              {isConfirmed && <p className="text-center badge badge-success">Done</p>}

              <div title={`Expire: ${status && moment.unix(web3.utils.toNumber(status.expirationTimestamp)).utc().fromNow()}`}>{status && status.content !== '' && selfView && <button onClick={(e) => clearStatus(e)}>Delete status</button>}</div>

              <div className={`flex flex-row align-items-center gap-025`}>
                <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#1f1f1f">
                  <path d="M460-300h40v-220h-40v220Zm20-276.92q10.46 0 17.54-7.08 7.08-7.08 7.08-17.54 0-10.46-7.08-17.54-7.08-7.07-17.54-7.07-10.46 0-17.54 7.07-7.08 7.08-7.08 17.54 0 10.46 7.08 17.54 7.08 7.08 17.54 7.08Zm.13 456.92q-74.67 0-140.41-28.34-65.73-28.34-114.36-76.92-48.63-48.58-76.99-114.26Q120-405.19 120-479.87q0-74.67 28.34-140.41 28.34-65.73 76.92-114.36 48.58-48.63 114.26-76.99Q405.19-840 479.87-840q74.67 0 140.41 28.34 65.73 28.34 114.36 76.92 48.63 48.58 76.99 114.26Q840-554.81 840-480.13q0 74.67-28.34 140.41-28.34 65.73-76.92 114.36-48.58 48.63-114.26 76.99Q554.81-120 480.13-120Zm-.13-40q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
                </svg>
                <small>Your status is viewable by all users.</small>
              </div>
            </main>
          </div>
        </div>
      )}

      <div
        className={`${styles.status} animate pointer`}
        onClick={() => {
          setShowModal(true)
        }}
      >
        {status && (
          <p title={`Updated at ${moment.unix(web3.utils.toNumber(status.timestamp)).utc().fromNow()} - Expiration ${moment.unix(web3.utils.toNumber(status.expirationTimestamp)).utc().fromNow()}`}>
            {status.content !== '' ? <>{status.content}</> : <> Status...</>}
          </p>
        )}
      </div>
    </>
  )
}

/**
 * Post
 * @param {String} addr
 * @returns
 */
const Post = ({ addr }) => {
  const [profile, setProfile] = useState({
    data: {
      Profile: [
        {
          fullName: 'anonymous',
          name: 'anonymous',
          description: ``,
          id: '0x188eec07287d876a23565c3c568cbe0bb1984b83',
          profileImages: [],
        },
      ],
    },
  })
  const [content, setContent] = useState('Question?')
  const [showForm, setShowForm] = useState(`post`)
  const [votingLimit, setVotingLimit] = useState(1)
  const [postContent, setPostContent] = useState(localStorage.getItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}post-content`))
  const [showWhitelist, setShowWhitelist] = useState(false)
  const [whitelist, setWhitelist] = useState({ list: [] })
  const [filteredProfiles, setFilteredProfiles] = useState()
  const [options, setOptions] = useState({ list: [``, ``] })
  const createFormRef = useRef()
  const whitelistInputRef = useRef()
  const { address, isConnected } = useAccount()
  const { data: hash, isPending: isSigning, error: submitError /* Error during submission (e.g., user rejected)  */, writeContract } = useWriteContract()
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError /* Error after mining (e.g., transaction reverted) */,
  } = useWaitForTransactionReceipt({
    hash,
  })
  const { web3, contract } = initContract()

  const handleForm = async (e) => {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.target)
    const fullname = formData.get('fullname')
    const phone = formData.get('phone')
    const address = formData.get('address')
    const wallet = formData.get('wallet')
    const errors = {}

    const post = {
      fullname: fullname,
      phone: phone,
      address: address,
      wallet: wallet,
    }

    updateProfile(post).then((res) => {
      console.log(res)
      toast(`${res.message}`, 'success')
    })
  }

  const handleCreatePoll = async (e) => {
    e.preventDefault()

    // upload metadata
    // const choices = document.querySelectorAll(`[name="choice"]`)
    // console.log(choices)
    // let choiceValues = []
    // choices.forEach((element) => {
    //   choiceValues.push(element.value)
    // })

    // const upload = await pinata.upload.json({
    //   q: document.querySelector(`[name="q"]`).value,
    //   choices: choiceValues,
    //   creator: profile.id,
    // })
    // console.log(`IPFS`, upload)
    // console.log(process.env.NEXT_PUBLIC_CONTRACT)
    // const web3 = new Web3(window.lukso)
    // const contract = new web3.eth.Contract(ABI, process.env.NEXT_PUBLIC_CONTRACT)
    // const t = toast(`Waiting for transaction's confirmation`)
    const formData = new FormData(e.target)

    // try {
    //   const t = toast.loading(`Uploading to IPFS`)
    //   const upload = await pinata.upload.file(formData.get(`file`))
    //   console.log(upload)
    //   toast.dismiss(t)
    //   image = upload.IpfsHash
    // } catch (error) {
    //   console.log(error)
    // }

    // const upload = await pinata.upload.json({
    //   image: image,
    //   creator: profile.id,
    // })
    let whitelist_accounts = []
    if (whitelist.list.length > 0) {
      whitelist.list.map((profile, i) => {
        whitelist_accounts.push(profile.id)
      })
    }
    console.log(whitelist_accounts)

    writeContract({
      abi,
      address: process.env.NEXT_PUBLIC_CONTRACT,
      functionName: 'createPoll',
      args: [
        '',
        content,
        options.list,
        moment(formData.get(`startTime`)).utc().unix().toString(),
        moment(formData.get(`endTime`)).utc().unix().toString(),
        whitelist_accounts,
        formData.get(`votesPerAccount`),
        formData.get(`pollType`),
        formData.get(`token`),
        web3.utils.toWei(formData.get(`holderAmount`), `ether`),
        formData.get(`allowComments`) === 'true' ? true : false,
      ],
    })
  }

  const handlePostContentChange = (e) => {
    const value = e.target.value
    setPostContent(value)
    localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}post-content`, value)
  }

  const handleCreatePost = async (e) => {
    e.preventDefault()

    const formData = new FormData(e.target)

    writeContract({
      abi,
      address: process.env.NEXT_PUBLIC_CONTRACT,
      functionName: 'createPoll',
      args: ['', postContent, [], 0, 0, [], 0, 0, `0x0000000000000000000000000000000000000000`, 0, formData.get(`allowComments`) === 'true' ? true : false],
    })
  }

  const addOption = () => {
    let optionList = options.list
    if (optionList.length === 8) return
    optionList.push(``)
    setOptions({ list: optionList })
  }

  const updateOption = (e, index) => {
    options.list[index] = e.target.value
    setOptions(options)
  }

  const delOption = (e, index) => {
    if (options.list.length === 2) return
    let optionList = []
    options.list.map((item, i) => {
      if (i !== index) optionList.push(``)
    })
    setOptions({ list: optionList })
  }

  const handleSearchProfile = async (e) => {
    const q = e.target.value

    if (q === '') {
      setFilteredProfiles()
      return
    }

    let filtered_wallets = []
    whitelist.list.map((profile) => filtered_wallets.push(profile.id))

    var myHeaders = new Headers()
    myHeaders.append('Content-Type', `application/json`)
    myHeaders.append('Accept', `application/json`)

    var requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: JSON.stringify({
        query: `query MyQuery {
  search_profiles(
    args: {search: "${q}"}
    limit: 5
    where: {id: {_nin: ${JSON.stringify(filtered_wallets)}}}
  ) {
    fullName
    id
    profileImages {
      src
    }
  }
}`,
      }),
    }
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}`, requestOptions)
    if (!response.ok) {
      throw new Response('Failed to ', { status: 500 })
    }
    const data = await response.json()
    console.log(data)
    setFilteredProfiles(data)
  }

  const handleAddWhitelist = async (e, profile, profileCardElement) => {
    console.log(whitelist.list)
    console.log(profile)
    // Check if the wallet address isn't repetitive
    if (whitelist.list.length > 0 && whitelist.list.find((item) => item.id === profile.id) !== undefined) return

    let newVal = whitelist.list
    newVal.push(profile)
    console.log(newVal)
    setWhitelist({ list: newVal })
    e.target.innerText = `Added`
    e.target.style.backgroundColor = `gray`

    // Close whitelist modal
    setFilteredProfiles()
    whitelistInputRef.current.value = ''
  }

  const handleRemoveWhitelist = (e, index) => {
    let newWhitelist = []
    whitelist.list.map((profile, i) => {
      if (i !== index) newWhitelist.push(profile)
    })
    console.log(newWhitelist)
    setWhitelist({ list: newWhitelist })
  }

  const post = () => {
    try {
      // window.lukso.request({ method: 'eth_requestAccounts' }).then((accounts) => {})
      const web3 = new Web3(window.ethereum)

      // Create a Contract instance
      const contract = new web3.eth.Contract(ABI, process.env.NEXT_PUBLIC_SOMNIA_CONTRACT)
      contract.methods
        .react(auth.contextAccounts[0], selectedEmoji.item.emojiId, web3.utils.toHex(message))
        .send({
          from: auth.accounts[0],
          value: selectedEmoji.item.price,
        })
        .then((res) => {
          console.log(res)

          toast.success(`Done`)

          party.confetti(document.body, {
            count: party.variation.range(20, 40),
          })
        })
        .catch((error) => {})
    } catch (error) {
      console.log(error)
    }
  }

  useEffect(() => {
    getProfile(addr).then((res) => {
      console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setProfile(res)
      }
    })
  }, [])

  if (!profile) return <div className={`shimmer ${styles.shimmer}`} />

  return (
    <div className={`${styles.post} flex flex-row align-items-start justify-content-between gap-1`}>
      <img
        alt={profile.data.Profile[0].name || `PFP`}
        src={`${profile.data.Profile[0].profileImages.length > 0 ? profile.data.Profile[0].profileImages[0].src : 'https://ipfs.io/ipfs/bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm'}`}
        className={`${styles.post__pfp} rounded`}
      />
      <div className={`flex-1`}>
        {showForm === `poll` && (
          <form ref={createFormRef} className={`form flex flex-column gap-050`} onSubmit={(e) => handleCreatePoll(e)}>
            <div>
              <textarea type="text" name="q" placeholder={`What's up!`} defaultValue={content} onChange={(e) => setContent(e.target.value)} rows={10} />
              <small className={`text-secondary`}>Only the first 280 characters will be visible on the timeline.</small>
            </div>
            <div>
              Options:
              {options &&
                options.list.map((item, i) => {
                  return (
                    <div key={i} className={`flex mt-10 gap-1`}>
                      <input type="text" name={`option`} onChange={(e) => updateOption(e, i)} defaultValue={``} placeholder={`Option ${i + 1}`} />

                      <button type={`button`} className="btn" onClick={(e) => delOption(e, i)}>
                        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#fff">
                          <path d="M304.62-160q-27.62 0-46.12-18.5Q240-197 240-224.62V-720h-40v-40h160v-30.77h240V-760h160v40h-40v495.38q0 27.62-18.5 46.12Q683-160 655.38-160H304.62Zm87.69-120h40v-360h-40v360Zm135.38 0h40v-360h-40v360Z" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              {options.list.length < 8 && (
                <>
                  <div className={`mt-10`}>
                    <button className={`${styles.btnAddOption}`} type="button" onClick={(e) => addOption(e)}>
                      Add option
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className={`grid grid--fill grid--gap-1`} style={{ '--data-width': `200px` }}>
              <div>
                <label htmlFor={`startTime`}>Start time</label>
                <input type={`datetime-local`} name={`startTime`} required />
                <small>Start time must be at least a minute from now.</small>
              </div>

              <div>
                <label htmlFor={`endTime`}>End time</label>
                <input type={`datetime-local`} name={`endTime`} required />
              </div>
            </div>

            <div className={`flex flex-column`}>
              <Label htmlFor={``}>Voting Limit</Label>
              <input type={`number`} name={`votesPerAccount`} list={`sign-limit`} defaultValue={1} onChange={(e) => setVotingLimit(e.target.value)} />
              <small>Each account is limited to {votingLimit} votes for this poll.</small>
            </div>
            <div>
              <label htmlFor={`pollType`}>Poll Type</label>
              <select
                name={`pollType`}
                id=""
                onClick={(e) => {
                  const selectedOption = e.target.value
                  if (selectedOption === `1`) setShowWhitelist(true)
                  else setShowWhitelist(false)
                }}
              >
                <option value={0}>Public</option>
                <option value={1}>Private (Whitelisted)</option>
                <option value={2}>Only native token holders (LYX)</option>
                <option value={3}>Only tokens holder (LSP7)</option>
                <option value={4}>Only NFT holders (LSP8)</option>
              </select>
            </div>
            {showWhitelist && (
              <div className={`${styles['whitelist-container']} relative form-group`}>
                <label htmlFor={`whitelist`}>Whitelist</label>

                {whitelist && whitelist.list.length > 0 && (
                  <div className={`${styles['selected-whitelist']} grid grid--fill grid--gap-1`} style={{ '--data-width': `200px` }}>
                    {whitelist.list.map((profile, i) => {
                      return (
                        <div key={i} className={`d-flex grid--gap-050 ms-motion-slideDownIn`}>
                          <figure>
                            <img src={`${profile.profileImages.length > 0 ? profile.profileImages[0].src : `https://ipfs.io/ipfs/bafkreic63gdzkdiye7vlcvbchillkszl6wbf2t3ysxcmr3ovpah3rf4h7i`}`} alt={`${profile.fullName}`} />
                          </figure>
                          <div className={`w-100 d-flex flex-row align-items-center justify-content-between`}>
                            <div className={`d-flex flex-column`}>
                              <small className={`ms-fontWeight-bold`}>{profile.fullName}</small>
                              <span>{`${profile.id.slice(0, 4)}...${profile.id.slice(38)}`}</span>
                            </div>

                            <button className={`rounded d-f-c`} type={`button`} title={`Clear ${profile.fullName}`} onClick={(e) => handleRemoveWhitelist(e, i)}>
                              <Icon name={`close`} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <input ref={whitelistInputRef} type={`text`} name={`whitelist`} autoComplete={`off`} placeholder={`Search profile by name or address`} onChange={(e) => handleSearchProfile(e)} />

                {filteredProfiles && filteredProfiles?.data && (
                  <div className={`${styles['filter-profile']} ms-depth-8`}>
                    {filteredProfiles.data.search_profiles.map((profile, i) => {
                      return (
                        <div key={i} id={`profileCard${i}`} className={`d-flex grid--gap-050`}>
                          <figure>
                            <img src={`${profile.profileImages.length > 0 ? profile.profileImages[0].src : `https://ipfs.io/ipfs/bafkreic63gdzkdiye7vlcvbchillkszl6wbf2t3ysxcmr3ovpah3rf4h7i`}`} alt={`${profile.fullName}`} />
                          </figure>
                          <div className={`w-100 d-flex flex-row align-items-center justify-content-between`}>
                            <div className={`d-flex flex-column`}>
                              <b>{profile.fullName}</b>
                              <span>{`${profile.id.slice(0, 4)}…${profile.id.slice(38)}`}</span>
                            </div>
                            <button className={`btn`} type={`button`} onClick={(e) => handleAddWhitelist(e, profile, `profileCard${i}`)}>
                              Add profile
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div>
              <label htmlFor={`token`}>Token</label>
              <select name="token" id="">
                <option value={`0x0000000000000000000000000000000000000000`}>$LYX</option>
                <option value={`0x59a070edc7d5c621a845ddbdfafbbde9f25dbc70`}>$ARATTA</option>
                <option value={`0x00ecc3275aeb551ec553bfcb966cd0813ecf2935`}>$FISH</option>
              </select>
            </div>

            <div>
              <label htmlFor={`holderAmount`}>Amount</label>
              <input type={`number`} name={`holderAmount`} defaultValue={0} />
            </div>

            <div>
              <label htmlFor={`allowComments`}>Allow comments</label>
              <select name={`allowComments`} id="">
                <option value={true}>Yes</option>
                <option value={false}>No</option>
              </select>
            </div>

            <div className={`mt-10`}>
              <button className={`btn`} type="submit">
                {status.pending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {showForm === `post` && (
          <form ref={createFormRef} className={`form flex flex-column gap-050 ${styles.postForm}`} onSubmit={(e) => handleCreatePost(e)}>
            <div className={`form-group ${styles.postForm__postContent}`}>
              <textarea type="text" name="q" placeholder={`What's up!`} defaultValue={postContent} onChange={(e) => handlePostContentChange(e)} rows={10} />
              <small className={`text-secondary`}>Only the first 280 characters will be visible on the timeline.</small>
            </div>

            <div>
              <label htmlFor={`allowComments`}>Allow comments</label>
              <select name={`allowComments`} id="">
                <option value={true}>Yes</option>
                <option value={false}>No</option>
              </select>
            </div>

            <div className={`mt-10`}>
              <button className={`btn`} type="submit" disabled={isSigning}>
                {isConfirming ? `Posting...` : isSigning ? `Signing...` : 'Post'}
              </button>
            </div>
          </form>
        )}

        {isConnected && (
          <>
            <ul className={`flex ${styles.post__actions}`}>
              <li title={`Write post`} onClick={() => setShowForm(`post`)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M5 19H6.098L16.7962 8.302L15.698 7.20375L5 17.902V19ZM4 20V17.4807L17.1807 4.2865C17.2832 4.19517 17.3963 4.12458 17.52 4.07475C17.6438 4.02492 17.7729 4 17.9072 4C18.0416 4 18.1717 4.02117 18.2977 4.0635C18.4236 4.10583 18.5397 4.18208 18.6462 4.29225L19.7135 5.3655C19.8237 5.47183 19.899 5.5885 19.9395 5.7155C19.9798 5.84267 20 5.96975 20 6.09675C20 6.23225 19.9772 6.36192 19.9315 6.48575C19.8858 6.60942 19.8132 6.7225 19.7135 6.825L6.51925 20H4ZM16.2375 7.7625L15.698 7.20375L16.7962 8.302L16.2375 7.7625Z"
                    fill="#1F1F1F"
                  />
                </svg>
              </li>
              <li title={`Attach media`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.6155 20C5.15517 20 4.77083 19.8458 4.4625 19.5375C4.15417 19.2292 4 18.8448 4 18.3845V5.6155C4 5.15517 4.15417 4.77083 4.4625 4.4625C4.77083 4.15417 5.15517 4 5.6155 4H18.3845C18.8448 4 19.2292 4.15417 19.5375 4.4625C19.8458 4.77083 20 5.15517 20 5.6155V18.3845C20 18.8448 19.8458 19.2292 19.5375 19.5375C19.2292 19.8458 18.8448 20 18.3845 20H5.6155ZM5.6155 19H18.3845C18.5385 19 18.6796 18.9359 18.8077 18.8077C18.9359 18.6796 19 18.5385 19 18.3845V5.6155C19 5.4615 18.9359 5.32042 18.8077 5.19225C18.6796 5.06408 18.5385 5 18.3845 5H5.6155C5.4615 5 5.32042 5.06408 5.19225 5.19225C5.06408 5.32042 5 5.4615 5 5.6155V18.3845C5 18.5385 5.06408 18.6796 5.19225 18.8077C5.32042 18.9359 5.4615 19 5.6155 19ZM7.5 16.5H16.6538L13.827 12.7308L11.2115 16.0385L9.4615 13.923L7.5 16.5Z" />
                </svg>
              </li>
              <li title={`Add a gif`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.6155 20C5.15517 20 4.77083 19.8458 4.4625 19.5375C4.15417 19.2292 4 18.8448 4 18.3845V5.6155C4 5.15517 4.15417 4.77083 4.4625 4.4625C4.77083 4.15417 5.15517 4 5.6155 4H18.3845C18.8448 4 19.2292 4.15417 19.5375 4.4625C19.8458 4.77083 20 5.15517 20 5.6155V18.3845C20 18.8448 19.8458 19.2292 19.5375 19.5375C19.2292 19.8458 18.8448 20 18.3845 20H5.6155ZM5.6155 19H18.3845C18.5385 19 18.6796 18.9359 18.8077 18.8077C18.9359 18.6796 19 18.5385 19 18.3845V5.6155C19 5.4615 18.9359 5.32042 18.8077 5.19225C18.6796 5.06408 18.5385 5 18.3845 5H5.6155C5.4615 5 5.32042 5.06408 5.19225 5.19225C5.06408 5.32042 5 5.4615 5 5.6155V18.3845C5 18.5385 5.06408 18.6796 5.19225 18.8077C5.32042 18.9359 5.4615 19 5.6155 19Z" />
                  <path d="M11.3333 14V10H12.3333V14H11.3333ZM7.66667 14C7.46667 14 7.30556 13.9306 7.18333 13.7917C7.06111 13.6528 7 13.5 7 13.3333V10.6667C7 10.5 7.06111 10.3472 7.18333 10.2083C7.30556 10.0694 7.46667 10 7.66667 10H9.66667C9.86667 10 10.0278 10.0694 10.15 10.2083C10.2722 10.3472 10.3333 10.5 10.3333 10.6667V11H8V13H9.33333V12H10.3333V13.3333C10.3333 13.5 10.2722 13.6528 10.15 13.7917C10.0278 13.9306 9.86667 14 9.66667 14H7.66667ZM13.3333 14V10H16.3333V11H14.3333V11.6667H15.6667V12.6667H14.3333V14H13.3333Z" />
                </svg>
              </li>
              <li title={`Add a poll`} onClick={() => setShowForm(`poll`)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 10H16.6155V9H12V10ZM12 15H16.6155V14H12V15ZM9 10.7307C9.34483 10.7307 9.63617 10.6118 9.874 10.374C10.1118 10.1362 10.2308 9.84483 10.2308 9.5C10.2308 9.15517 10.1118 8.86383 9.874 8.626C9.63617 8.38817 9.34483 8.26925 9 8.26925C8.65517 8.26925 8.36383 8.38817 8.126 8.626C7.88817 8.86383 7.76925 9.15517 7.76925 9.5C7.76925 9.84483 7.88817 10.1362 8.126 10.374C8.36383 10.6118 8.65517 10.7307 9 10.7307ZM9 15.7308C9.34483 15.7308 9.63617 15.6118 9.874 15.374C10.1118 15.1362 10.2308 14.8448 10.2308 14.5C10.2308 14.1552 10.1118 13.8638 9.874 13.626C9.63617 13.3882 9.34483 13.2692 9 13.2692C8.65517 13.2692 8.36383 13.3882 8.126 13.626C7.88817 13.8638 7.76925 14.1552 7.76925 14.5C7.76925 14.8448 7.88817 15.1362 8.126 15.374C8.36383 15.6118 8.65517 15.7308 9 15.7308ZM5.6155 20C5.15517 20 4.77083 19.8458 4.4625 19.5375C4.15417 19.2292 4 18.8448 4 18.3845V5.6155C4 5.15517 4.15417 4.77083 4.4625 4.4625C4.77083 4.15417 5.15517 4 5.6155 4H18.3845C18.8448 4 19.2292 4.15417 19.5375 4.4625C19.8458 4.77083 20 5.15517 20 5.6155V18.3845C20 18.8448 19.8458 19.2292 19.5375 19.5375C19.2292 19.8458 18.8448 20 18.3845 20H5.6155ZM5.6155 19H18.3845C18.5385 19 18.6796 18.9359 18.8077 18.8077C18.9359 18.6796 19 18.5385 19 18.3845V5.6155C19 5.4615 18.9359 5.32042 18.8077 5.19225C18.6796 5.06408 18.5385 5 18.3845 5H5.6155C5.4615 5 5.32042 5.06408 5.19225 5.19225C5.06408 5.32042 5 5.4615 5 5.6155V18.3845C5 18.5385 5.06408 18.6796 5.19225 18.8077C5.32042 18.9359 5.4615 19 5.6155 19Z" />
                </svg>
              </li>
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
