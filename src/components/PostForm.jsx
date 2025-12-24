'use client'
import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'

import { initPostContract } from '@/lib/communication'
import { toast } from '@/components/NextToast'
import abi from '@/abi/post.json'
import { useClientMounted } from '@/hooks/useClientMount'
import { getActiveChain } from '@/lib/communication'
import { useWaitForTransactionReceipt, useConnection, useWriteContract } from 'wagmi'
import moment from 'moment'
import { ContentSpinner } from '@/components/Loading'
import styles from '@/components/PostForm.module.scss'
import { Image, SquarePlay } from 'lucide-react'

export default function PostForm() {
  const [isUploading, setIsUploading] = useState(false)
  const [content, setContent] = useState('Question?')
  const [showForm, setShowForm] = useState(`post`)
  const [votingLimit, setVotingLimit] = useState(1)
  const [postContent, setPostContent] = useState({
    version: '1',
    elements: [
      { type: 'text', data: { text: '' } },
      {
        type: 'media',
        data: {
          items: [
            // { type: 'image', cid: 'Qm1234...image-cid-1', alt: 'Photo of the launch party.', mimeType: 'image/jpeg' },
            // { type: 'image', cid: 'Qm5678...image-cid-2', alt: 'Screenshot of the new interface.', mimeType: 'image/jpeg' },
            // { type: 'video', cid: 'Qm9012...video-cid-3', format: 'mp4', duration: 45 },
          ],
        },
      },
    ],
  })

  const [showWhitelist, setShowWhitelist] = useState(false)
  const [whitelist, setWhitelist] = useState({ list: [] })
  const [filteredProfiles, setFilteredProfiles] = useState()
  const [options, setOptions] = useState({ list: [``, ``] })
  const activeChain = getActiveChain()
  const mounted = useClientMounted()
  const createFormRef = useRef()
  const fileInputRef = useRef()
  const whitelistInputRef = useRef()
  const { address, isConnected } = useConnection()
  const { web3, contract } = initPostContract()
  const [selectedMediaType, setSelectedMediaType] = useState(null) // Tracks if we're expecting image or video

  /* Error during submission (e.g., user rejected)  */
  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()

  const handleSuccess = (receipt) => {
    console.log('🎉 Transaction Confirmed! Receipt:', receipt)
    alert('Transaction Successful!')

    // --- 🎯 TanStack Query Step: Invalidate/Refetch Data ---
    // If this transaction changed some on-chain state (e.g., token balance, list of NFTs),
    // you must invalidate the relevant queries to refetch the latest data.
    queryClient.invalidateQueries({ queryKey: ['balanceOf', 'your-address'] })
    queryClient.invalidateQueries({ queryKey: ['totalSupply'] })
    // --------------------------------------------------------

    // Optional: Reset the write contract state to allow a new transaction
    // resetWriteContract();
  }

  const handleError = (error) => {
    console.error('🔥 Transaction Reverted/Failed:', error)
    alert(`Transaction Failed: ${error.shortMessage || error.message}`)

    // Optional: Reset the write contract state
    // resetWriteContract();
  }

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError /* Error after mining (e.g., transaction reverted) */,
  } = useWaitForTransactionReceipt({
    hash,
    query: {
      enabled: !!hash, // Only run the query once we have a transaction hash
      onSuccess: handleSuccess, // Call our success function
      onError: handleError, // Call our error function
    },
  })

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
    // console.log(process.env.NEXT_PUBLIC_CONTRACT_POST)
    // const web3 = new Web3(window.lukso)
    // const contract = new web3.eth.Contract(ABI, process.env.NEXT_PUBLIC_CONTRACT_POST)
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
      address: process.env.NEXT_PUBLIC_CONTRACT_POST,
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

  const uploadFileToIPFS = async (file) => {
    setIsUploading(true)

    try {
      if (!file) {
        console.error('No file selected.')
        return
      }

      const data = new FormData()
      data.set('file', file)

      const uploadRequest = await fetch(`/api/ipfs/file`, {
        method: 'POST',
        body: data,
      })
      const signedUrl = await uploadRequest.json()
      setIsUploading(false)
      return signedUrl
    } catch (e) {
      setIsUploading(false)
      console.log(e)
      console.error('Trouble uploading file')
    }
  }

  const uploadObjectToIPFS = async (json) => {
    setIsUploading(true)
    try {
      const uploadRequest = await fetch(`/api/ipfs/object`, {
        method: 'POST',
        // Set the Content-Type header
        headers: {
          'Content-Type': 'application/json',
        },
        // Stringify the JSON object directly (no extra wrapper)
        body: JSON.stringify(json),
      })

      // Check for non-200 status codes
      if (!uploadRequest.ok) {
        const errorData = await uploadRequest.json()
        throw new Error(errorData.error || `HTTP error! Status: ${uploadRequest.status}`)
      }

      const responseData = await uploadRequest.json()
      setIsUploading(false)
      return responseData
    } catch (e) {
      setIsUploading(false)
      console.error('Trouble uploading file/object:', e)
      // Re-throw the error or return null/undefined depending on your error handling preference
      throw e
    }
  }

  const handleCreatePost = async (e) => {
    e.preventDefault()

    const formData = new FormData(e.target)

    const resultIPFS = await uploadObjectToIPFS(postContent)
    if (!resultIPFS.cid) {
      console.error(`CID not found`)
    }
    const metadata = resultIPFS.cid
    const content = `─`

    writeContract({
      abi,
      address: activeChain[1].post,
      functionName: 'createPost',
      args: [metadata, content, formData.get(`allowComments`) === 'true' ? true : false],
    })
  }

  const handleTextContentChange = (newText) => {
    setPostContent((prevContent) => {
      // 1. Copy the elements array
      const newElements = [...prevContent.elements]

      // 2. Deep copy the specific element being modified (Element 0: text)
      const newTextElement = {
        ...newElements[0],
        data: {
          ...newElements[0].data,
          text: newText, // Set the new text value
        },
      }

      // 3. Update the elements array with the new element copy
      newElements[0] = newTextElement

      // 4. Return the new top-level state object copy
      return {
        ...prevContent,
        elements: newElements,
      }
    })
  }

  /**
   * Triggers the hidden file input with the correct acceptance mime types.
   */
  const triggerFileInput = (e, type) => {
    if (postContent.elements[1].data.items.length >= 4) {
      console.error('Maximum 4 media items reached.')
      return
    }

    setSelectedMediaType(type)

    fileInputRef.current.accept = type === 'image' ? 'image/*' : 'video/*'
    fileInputRef.current.click()
  }

  /**
   * Handles file selection from the hidden input.
   * Simulates IPFS upload and CID generation.
   */
  const handleFileSelect = async (event) => {
    const file = event.target.files[0]
    if (!file || postContent.elements[1].data.items.length >= 4) return

    // Size of the file
    const sizeInBytes = file.size
    const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2)

    if (sizeInMB > 5) {
      toast(`File size error. Maximum size is 5MB`)
      return
    }

    // console.log(`File Name: ${file.name}`);
    // console.log(`File Type: ${file.type}`);
    // console.log(`File Size: ${sizeInBytes} bytes`);
    // console.log(`File Size (MB): ${sizeInMB} MB`);

    // 1. Determine media type based on MIME type and the button clicked
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    let type

    if ((isImage && selectedMediaType === 'image') || (isVideo && selectedMediaType === 'video')) {
      type = selectedMediaType
    } else {
      // Handle type mismatch (e.g., user selects video but clicked 'Add Image')
      console.error(`File type mismatch. Expected ${selectedMediaType}, got ${file.type}`)
      return
    }

    // Upload to IPFS
    const resultIPFS = await uploadFileToIPFS(file, `file`)

    if (!resultIPFS.url || !resultIPFS.cid) return

    // 2. Create a temporary local URL for immediate preview
    const localUrl = URL.createObjectURL(file)

    // 3. Create a placeholder item with an 'isUploading' flag
    const newItem = {
      type: type,
      cid: resultIPFS.cid, // Placeholder CID
      alt: `Hup asset ${type}`,
      mimeType: file.type,
      localUrl: localUrl, // Use this as a temporary unique ID
      isUploading: true,
      duration: type === 'video' ? 0 : undefined,
      spoiler: false,
    }

    // 4. Add the placeholder item to the state immediately
    setPostContent((prevContent) => {
      const currentContent = prevContent || INITIAL_POST_CONTENT
      const newElements = [...currentContent.elements]
      const mediaElement = newElements[1]
      const newMediaItems = [...mediaElement.data.items, newItem]

      const newMediaElement = {
        ...mediaElement,
        data: { ...mediaElement.data, items: newMediaItems },
      }

      newElements[1] = newMediaElement
      return { ...currentContent, elements: newElements }
    })

    // 5. --- Simulate IPFS Upload (Asynchronous Task) ---
    console.log(`Done. file selected`)

    // Reset the file input value so the same file can be selected again
    event.target.value = null
  }

  const handleRemoveMedia = (itemIndex) => {
    setPostContent((prevContent) => {
      // 1. Get a copy of the elements array
      const newElements = [...prevContent.elements]
      const mediaElement = newElements[1]

      // 2. Filter the items array immutably
      const newMediaItems = mediaElement.data.items.filter((_, idx) => idx !== itemIndex)

      // 3. Create a deep copy of the media element with the new items array
      const newMediaElement = {
        ...mediaElement,
        data: {
          ...mediaElement.data,
          items: newMediaItems,
        },
      }

      // 4. Update the elements array
      newElements[1] = newMediaElement

      // 5. Return the new top-level state
      return {
        ...prevContent,
        elements: newElements,
      }
    })
  }

  const makeSpoiler = (itemIndex) => {
    setPostContent((prevContent) => {
      // 1. Map through the elements to find the one at index 1
      const newElements = prevContent.elements.map((element, elIdx) => {
        if (elIdx !== 1) return element // Return other elements as they are

        // 2. Map through the items within that element's data
        const newMediaItems = element.data.items.map((item, itIdx) => {
          if (itIdx !== itemIndex) return item // Return other items as they are

          // 3. Toggle the spoiler property for the target item
          return {
            ...item,
            spoiler: !item.spoiler,
          }
        })

        // 4. Return the updated media element
        return {
          ...element,
          data: {
            ...element.data,
            items: newMediaItems,
          },
        }
      })

      // 5. Return the new top-level state
      return {
        ...prevContent,
        elements: newElements,
      }
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
    if (
      whitelist.list.length > 0 &&
      whitelist.list.find((item) => item.id === profile.id) !== undefined
    )
      return

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

  /**
   * Function to get the text currently selected by the cursor in a textarea.
   * @param {HTMLTextAreaElement} textarea - The textarea element to check.
   * @returns {string} The selected text.
   */
  function getSelectedText() {
    const textarea = document.querySelector(`[name="q"]`)
    const value = textarea.value
    // 1. Get the starting index of the selection
    const start = textarea.selectionStart

    // 2. Get the ending index of the selection
    const end = textarea.selectionEnd

    // 3. Use the 'substring' method on the textarea's whole value,
    //    passing the start and end indices.
    const selectedText = value.substring(start, end)

    return { start, end, selectedText, value, textarea }
  }

  /**
   * Inserts a string into another string at a specified index.
   * @param {string} originalString - The string to insert into.
   * @param {string} stringToInsert - The string to be added.
   * @param {number} index - The index where the insertion should occur.
   * @returns {string} The new combined string.
   */
  function insertStringAtIndex(originalString, stringToInsert, index) {
    // Ensure the index is within bounds
    const safeIndex = Math.max(0, Math.min(index, originalString.length))

    // 1. Get the part of the string BEFORE the insertion point (up to the index)
    const firstPart = originalString.slice(0, safeIndex)

    // 2. Get the part of the string AFTER the insertion point (starting from the index)
    const secondPart = originalString.slice(safeIndex)

    // 3. Concatenate the three parts: first part + new string + second part
    return firstPart + stringToInsert + secondPart
  }

  const makeBold = () => {
    const { start, end, selectedText, value, textarea } = getSelectedText()
    if (selectedText === '') return

    const startString = insertStringAtIndex(value, `**`, start)
    const endString = insertStringAtIndex(startString, `**`, end + 2)

    handleTextContentChange(endString)
    textarea.value = endString
  }

  const makeItalic = () => {
    const { start, end, selectedText, value, textarea } = getSelectedText()
    if (selectedText === '') return

    const startString = insertStringAtIndex(value, `*`, start)
    const endString = insertStringAtIndex(startString, `*`, end + 2)

    handleTextContentChange(endString)
    textarea.value = endString
  }

  // const mainTextIndex = postContent.elements.findIndex((el) => el.type === 'text')
  // const mediaBlockIndex = postContent.elements.findIndex((el) => el.type === 'media')
  // const initialText = 0 !== -1 ? postContent.elements[0].data.text : ''
  // const mediaItems = 1 !== -1 ? postContent.elements[1].data.items : []

  useEffect(() => {
    if (isConfirmed) {
      localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}post-content`, '')
      toast(`Post sent.`, `success`)
    }
  }, [isConfirmed])

  return (
    <div
      className={`${styles.postForm} flex flex-row align-items-start justify-content-between gap-1`}
    >
      <div className={`flex-1`}>
        {showForm === `poll` && (
          <form
            ref={createFormRef}
            className={`form flex flex-column gap-050`}
            onSubmit={(e) => handleCreatePoll(e)}
          >
            <div>
              <textarea
                type="text"
                name="q"
                placeholder={`What's up!`}
                defaultValue={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
              />
              <small className={`text-secondary`}>
                Only the first 280 characters will be visible on the timeline.
              </small>
            </div>
            <div>
              Options:
              {options &&
                options.list.map((item, i) => {
                  return (
                    <div key={i} className={`flex mt-10 gap-1`}>
                      <input
                        type="text"
                        name={`option`}
                        onChange={(e) => updateOption(e, i)}
                        defaultValue={``}
                        placeholder={`Option ${i + 1}`}
                      />

                      <button type={`button`} className="btn" onClick={(e) => delOption(e, i)}>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          height="24px"
                          viewBox="0 -960 960 960"
                          width="24px"
                          fill="#fff"
                        >
                          <path d="M304.62-160q-27.62 0-46.12-18.5Q240-197 240-224.62V-720h-40v-40h160v-30.77h240V-760h160v40h-40v495.38q0 27.62-18.5 46.12Q683-160 655.38-160H304.62Zm87.69-120h40v-360h-40v360Zm135.38 0h40v-360h-40v360Z" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              {options.list.length < 8 && (
                <>
                  <div className={`mt-10`}>
                    <button
                      className={`${styles.btnAddOption}`}
                      type="button"
                      onClick={(e) => addOption(e)}
                    >
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
              <label htmlFor={``}>Voting Limit</label>
              <input
                type={`number`}
                name={`votesPerAccount`}
                list={`sign-limit`}
                defaultValue={1}
                onChange={(e) => setVotingLimit(e.target.value)}
              />
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
                  <div
                    className={`${styles['selected-whitelist']} grid grid--fill grid--gap-1`}
                    style={{ '--data-width': `200px` }}
                  >
                    {whitelist.list.map((profile, i) => {
                      return (
                        <div key={i} className={`d-flex grid--gap-050 ms-motion-slideDownIn`}>
                          <figure>
                            <img
                              src={`${
                                profile.profileImages.length > 0
                                  ? profile.profileImages[0].src
                                  : `https://ipfs.io/ipfs/bafkreic63gdzkdiye7vlcvbchillkszl6wbf2t3ysxcmr3ovpah3rf4h7i`
                              }`}
                              alt={`${profile.fullName}`}
                            />
                          </figure>
                          <div
                            className={`w-100 d-flex flex-row align-items-center justify-content-between`}
                          >
                            <div className={`d-flex flex-column`}>
                              <small className={`ms-fontWeight-bold`}>{profile.fullName}</small>
                              <span>{`${profile.id.slice(0, 4)}...${profile.id.slice(38)}`}</span>
                            </div>

                            <button
                              className={`rounded d-f-c`}
                              type={`button`}
                              title={`Clear ${profile.fullName}`}
                              onClick={(e) => handleRemoveWhitelist(e, i)}
                            >
                              close
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <input
                  ref={whitelistInputRef}
                  type={`text`}
                  name={`whitelist`}
                  autoComplete={`off`}
                  placeholder={`Search profile by name or address`}
                  onChange={(e) => handleSearchProfile(e)}
                />

                {filteredProfiles && filteredProfiles?.data && (
                  <div className={`${styles['filter-profile']} ms-depth-8`}>
                    {filteredProfiles.data.search_profiles.map((profile, i) => {
                      return (
                        <div key={i} id={`profileCard${i}`} className={`d-flex grid--gap-050`}>
                          <figure>
                            <img
                              src={`${
                                profile.profileImages.length > 0
                                  ? profile.profileImages[0].src
                                  : `https://ipfs.io/ipfs/bafkreic63gdzkdiye7vlcvbchillkszl6wbf2t3ysxcmr3ovpah3rf4h7i`
                              }`}
                              alt={`${profile.fullName}`}
                            />
                          </figure>
                          <div
                            className={`w-100 d-flex flex-row align-items-center justify-content-between`}
                          >
                            <div className={`d-flex flex-column`}>
                              <b>{profile.fullName}</b>
                              <span>{`${profile.id.slice(0, 4)}…${profile.id.slice(38)}`}</span>
                            </div>
                            <button
                              className={`btn`}
                              type={`button`}
                              onClick={(e) => handleAddWhitelist(e, profile, `profileCard${i}`)}
                            >
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

        {/* {showForm === `post` && ( */}
        <form
          ref={createFormRef}
          className={`form flex flex-column gap-050 ${styles.postForm}`}
          onSubmit={(e) => handleCreatePost(e)}
        >
          <div className={`form-group ${styles.postForm__postContent}`}>
            <ul className={`flex gap-025`}>
              <li>
                <button type="button" style={{ width: `20px` }} onClick={() => makeBold()}>
                  B
                </button>
              </li>
              <li>
                <button type="button" style={{ width: `20px` }} onClick={() => makeItalic()}>
                  <i>I</i>
                </button>
              </li>
            </ul>

            {/* HIDDEN FILE INPUT */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              multiple={false}
            />

            {/* --- Text Editor --- */}
            <div className="mb-6">
              <textarea
                className="w-full p-4 border border-gray-300 rounded-lg focus:ring-4 focus:ring-indigo-200 focus:border-indigo-500 transition duration-150 resize-none text-gray-800"
                name="q"
                placeholder="What's happening?"
                value={postContent && postContent.elements[0].data.text}
                onChange={(e) => handleTextContentChange(e.target.value)}
                rows={5}
              />
            </div>

            <small className={`text-secondary`}>
              Only the first 280 characters will be visible on the timeline.
            </small>
          </div>

          <div>
            <label htmlFor={`allowComments`}>Allow comments</label>
            <select name={`allowComments`} id="">
              <option value={true}>Yes</option>
              <option value={false}>No</option>
            </select>
          </div>

          <>
            <h3 className="text-lg font-medium text-gray-700 mb-3 flex items-center">
              {/* <Image className="w-5 h-5 mr-2 text-indigo-500" /> */}
              Media Gallery ({postContent && postContent.elements[1].data.items.length})
            </h3>

            <div className="flex flex-wrap gap-4 mb-4">
              {isUploading && <ContentSpinner />}
              {postContent &&
                postContent.elements[1].data.items.map((item, index) => (
                  <div key={index} className="">
                    <div
                      className=""
                      style={{
                        width: `100px`,
                        height: `100px`,
                        backgroundColor: item.type === 'image' ? '#3B82F6' : '#DC2626',
                      }}
                    >
                      {item.type === 'image' ? (
                        <>
                          <figure>
                            <img
                              src={item.localUrl}
                              alt=""
                              style={{
                                filter: item.spoiler ? 'blur(8px)' : 'none',
                                aspectRatio: `1/1`,
                              }}
                            />
                          </figure>
                        </>
                      ) : (
                        <video
                          src={item.localUrl}
                          controls
                          style={{
                            filter: item.spoiler ? 'blur(8px)' : 'none',
                            aspectRatio: `1/1`,
                          }}
                        />
                      )}
                    </div>

                    <ul className={`d-f-c flex-column gap-025`}>
                      <li>
                        <button
                          type={`button`}
                          onClick={() => handleRemoveMedia(index)}
                          aria-label={`Remove ${item.type}`}
                        >
                          remove
                        </button>
                      </li>
                      <li>
                        <button
                          type={`button`}
                          onClick={() => makeSpoiler(index)}
                          aria-label={`Remove ${item.type}`}
                        >
                          Make spoiler
                        </button>
                      </li>
                    </ul>
                  </div>
                ))}
            </div>
          </>

          <div className={`mt-10 flex gap-1`}>
      

            <button
              className={`${styles.addButton} ${styles.addImageButton}`}
              type={`button`}
              onClick={(e) => triggerFileInput(e, `image`)}
              disabled={postContent.elements[1].data.items.length === 4 || isUploading}
            >
             <Image  strokeWidth={1.2} width={24}/>
             <span>Add Image</span>
            </button>
            <button
            className={`${styles.addButton} ${styles.addVideoButton}`}
              type={`button`}
              onClick={(e) => triggerFileInput(e, `video`)}
              disabled={postContent.elements[1].data.items.length === 4 || isUploading}
            >
          <SquarePlay strokeWidth={1.2} width={24}/>
            <span>Add Video</span>
            </button>
          </div>

                <button className={`btn`} type="submit" disabled={isSigning}>
              {isConfirming ? `Posting...` : isSigning ? `Signing...` : 'Post'}
            </button>
        </form>

        {!mounted && isConnected && (
          <ul className={`flex ${styles.post__actions}`}>
            <li title={`Write post`} onClick={() => setShowForm(`post`)}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5 19H6.098L16.7962 8.302L15.698 7.20375L5 17.902V19ZM4 20V17.4807L17.1807 4.2865C17.2832 4.19517 17.3963 4.12458 17.52 4.07475C17.6438 4.02492 17.7729 4 17.9072 4C18.0416 4 18.1717 4.02117 18.2977 4.0635C18.4236 4.10583 18.5397 4.18208 18.6462 4.29225L19.7135 5.3655C19.8237 5.47183 19.899 5.5885 19.9395 5.7155C19.9798 5.84267 20 5.96975 20 6.09675C20 6.23225 19.9772 6.36192 19.9315 6.48575C19.8858 6.60942 19.8132 6.7225 19.7135 6.825L6.51925 20H4ZM16.2375 7.7625L15.698 7.20375L16.7962 8.302L16.2375 7.7625Z"
                  fill="#1F1F1F"
                />
              </svg>
            </li>
            <li title={`Attach media`}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M5.6155 20C5.15517 20 4.77083 19.8458 4.4625 19.5375C4.15417 19.2292 4 18.8448 4 18.3845V5.6155C4 5.15517 4.15417 4.77083 4.4625 4.4625C4.77083 4.15417 5.15517 4 5.6155 4H18.3845C18.8448 4 19.2292 4.15417 19.5375 4.4625C19.8458 4.77083 20 5.15517 20 5.6155V18.3845C20 18.8448 19.8458 19.2292 19.5375 19.5375C19.2292 19.8458 18.8448 20 18.3845 20H5.6155ZM5.6155 19H18.3845C18.5385 19 18.6796 18.9359 18.8077 18.8077C18.9359 18.6796 19 18.5385 19 18.3845V5.6155C19 5.4615 18.9359 5.32042 18.8077 5.19225C18.6796 5.06408 18.5385 5 18.3845 5H5.6155C5.4615 5 5.32042 5.06408 5.19225 5.19225C5.06408 5.32042 5 5.4615 5 5.6155V18.3845C5 18.5385 5.06408 18.6796 5.19225 18.8077C5.32042 18.9359 5.4615 19 5.6155 19ZM7.5 16.5H16.6538L13.827 12.7308L11.2115 16.0385L9.4615 13.923L7.5 16.5Z" />
              </svg>
            </li>
            <li title={`Add a gif`}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M5.6155 20C5.15517 20 4.77083 19.8458 4.4625 19.5375C4.15417 19.2292 4 18.8448 4 18.3845V5.6155C4 5.15517 4.15417 4.77083 4.4625 4.4625C4.77083 4.15417 5.15517 4 5.6155 4H18.3845C18.8448 4 19.2292 4.15417 19.5375 4.4625C19.8458 4.77083 20 5.15517 20 5.6155V18.3845C20 18.8448 19.8458 19.2292 19.5375 19.5375C19.2292 19.8458 18.8448 20 18.3845 20H5.6155ZM5.6155 19H18.3845C18.5385 19 18.6796 18.9359 18.8077 18.8077C18.9359 18.6796 19 18.5385 19 18.3845V5.6155C19 5.4615 18.9359 5.32042 18.8077 5.19225C18.6796 5.06408 18.5385 5 18.3845 5H5.6155C5.4615 5 5.32042 5.06408 5.19225 5.19225C5.06408 5.32042 5 5.4615 5 5.6155V18.3845C5 18.5385 5.06408 18.6796 5.19225 18.8077C5.32042 18.9359 5.4615 19 5.6155 19Z" />
                <path d="M11.3333 14V10H12.3333V14H11.3333ZM7.66667 14C7.46667 14 7.30556 13.9306 7.18333 13.7917C7.06111 13.6528 7 13.5 7 13.3333V10.6667C7 10.5 7.06111 10.3472 7.18333 10.2083C7.30556 10.0694 7.46667 10 7.66667 10H9.66667C9.86667 10 10.0278 10.0694 10.15 10.2083C10.2722 10.3472 10.3333 10.5 10.3333 10.6667V11H8V13H9.33333V12H10.3333V13.3333C10.3333 13.5 10.2722 13.6528 10.15 13.7917C10.0278 13.9306 9.86667 14 9.66667 14H7.66667ZM13.3333 14V10H16.3333V11H14.3333V11.6667H15.6667V12.6667H14.3333V14H13.3333Z" />
              </svg>
            </li>
            <li title={`Add a poll`} onClick={() => setShowForm(`poll`)}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M12 10H16.6155V9H12V10ZM12 15H16.6155V14H12V15ZM9 10.7307C9.34483 10.7307 9.63617 10.6118 9.874 10.374C10.1118 10.1362 10.2308 9.84483 10.2308 9.5C10.2308 9.15517 10.1118 8.86383 9.874 8.626C9.63617 8.38817 9.34483 8.26925 9 8.26925C8.65517 8.26925 8.36383 8.38817 8.126 8.626C7.88817 8.86383 7.76925 9.15517 7.76925 9.5C7.76925 9.84483 7.88817 10.1362 8.126 10.374C8.36383 10.6118 8.65517 10.7307 9 10.7307ZM9 15.7308C9.34483 15.7308 9.63617 15.6118 9.874 15.374C10.1118 15.1362 10.2308 14.8448 10.2308 14.5C10.2308 14.1552 10.1118 13.8638 9.874 13.626C9.63617 13.3882 9.34483 13.2692 9 13.2692C8.65517 13.2692 8.36383 13.3882 8.126 13.626C7.88817 13.8638 7.76925 14.1552 7.76925 14.5C7.76925 14.8448 7.88817 15.1362 8.126 15.374C8.36383 15.6118 8.65517 15.7308 9 15.7308ZM5.6155 20C5.15517 20 4.77083 19.8458 4.4625 19.5375C4.15417 19.2292 4 18.8448 4 18.3845V5.6155C4 5.15517 4.15417 4.77083 4.4625 4.4625C4.77083 4.15417 5.15517 4 5.6155 4H18.3845C18.8448 4 19.2292 4.15417 19.5375 4.4625C19.8458 4.77083 20 5.15517 20 5.6155V18.3845C20 18.8448 19.8458 19.2292 19.5375 19.5375C19.2292 19.8458 18.8448 20 18.3845 20H5.6155ZM5.6155 19H18.3845C18.5385 19 18.6796 18.9359 18.8077 18.8077C18.9359 18.6796 19 18.5385 19 18.3845V5.6155C19 5.4615 18.9359 5.32042 18.8077 5.19225C18.6796 5.06408 18.5385 5 18.3845 5H5.6155C5.4615 5 5.32042 5.06408 5.19225 5.19225C5.06408 5.32042 5 5.4615 5 5.6155V18.3845C5 18.5385 5.06408 18.6796 5.19225 18.8077C5.32042 18.9359 5.4615 19 5.6155 19Z" />
              </svg>
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}
