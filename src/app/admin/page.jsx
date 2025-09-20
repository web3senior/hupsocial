'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import ABI from '@/abi/hup.json'
import ABILSP7 from '@/abi/lsp7.json'
import Web3 from 'web3'
import { initContract, getEmoji, getReaction } from '@/util/communication'
import styles from './page.module.scss'

export default function Page() {
  const [isLoading, setIsLoading] = useState(false)
  const [isInitialized, setIsInitialized] = useState()
  const [maxSupply, setMaxSupply] = useState()
  const [supplyCap, setSupplyCap] = useState()
  const [tokenIdCounter, setTokenIdCounter] = useState()
  const [PPT, setPPT] = useState()
  const [version, setVersion] = useState()
  const [activePhase, setActivePhase] = useState()
  const [phases, setPhases] = useState()
  const [FISH, setFISH] = useState()
  const [MEMBER_CARD, setMEMBER_CARD] = useState()
  const [RICH, setRICH] = useState()
  const [FISHCAN, setFISHCAN] = useState()
  const [ARATTALABS, setARATTALABS] = useState()
  const [LUKSEALS, setLUKSEALS] = useState()
  const [MADSKI, setMADSKI] = useState()
  const [DACHRIZ, setDACHRIZ] = useState()
  const [ARFI, setARFI] = useState()
  const [FOLLOWING, setFOLLOWING] = useState()
  const [levelPrice, setLevelPrice] = useState()
  const [LYXBalance, setLYXBalance] = useState()
  const [fishBalance, setFishBalance] = useState()
  const [selectedPhase, setSelectedPhase] = useState()
  const [walletBalance, setWalletBalance] = useState(0)
  const [walletFishBalance, setWalletFishBalance] = useState(0)
  const [LYX, setLYX] = useState(0)
  const [level, setlevel] = useState()
  const auth = useUpProvider()
  const { contractReadonly } = initContract()

  const web3 = new Web3(auth.provider)
  const contract = new web3.eth.Contract(ABI, process.env.NEXT_PUBLIC_CONTRACT)
  const contractFish = new web3.eth.Contract(ABILSP7, process.env.NEXT_PUBLIC_CONTRACT_FISH)
  const _ = web3.utils

  const fetchData = async (dataURL) => {
    let requestOptions = {
      method: 'GET',
      redirect: 'follow',
    }
    const response = await fetch(`${dataURL}`, requestOptions)
    if (!response.ok) throw new Response('Failed to get data', { status: 500 })
    return response.json()
  }

  // function numberToBytes32(number) {
  //   const hex = web3.utils.toHex(number);
  //   return web3.utils.padLeft(hex, 64);
  // }

  const getChillwhaleData = async (addresses) => {
    const myHeaders = new Headers()
    myHeaders.append('Content-Type', `application/json`)
    myHeaders.append('Accept', `application/json`)

    const requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: JSON.stringify({
        query: `query MyQuery {
  Asset(
    limit: 30
    where: {isLSP7: {_eq: false}, id: {_eq: "0x86e817172b5c07f7036bf8aa46e2db9063743a83"}}
  ) {
    id
    isLSP7
    lsp4TokenName
    lsp4TokenSymbol
    lsp4TokenType
    name
    totalSupply
    owner_id
    tokens(where: {formattedTokenId: {_in: ${JSON.stringify(addresses)}}}) {
      id
      formattedTokenId
      name
      images(limit: 1) {
        src
      }
      holders {
        profile_id
        profile {
          fullName
          profileImages(limit: 1) {
            src
          }
        }
      }
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
    return data
  }

  const getProfiles = async (addresses) => {
    const myHeaders = new Headers()
    myHeaders.append('Content-Type', `application/json`)
    myHeaders.append('Accept', `application/json`)

    const requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: JSON.stringify({
        query: `query MyQuery {
  Profile(where: {id: {_in: ${JSON.stringify(addresses)}}}) {
    name
    tags
    description
    fullName
    id
    isEOA
    isContract
    src
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
    return data
  }

  const getLSP7Price = async (token) => {
    let requestOptions = {
      method: 'GET',
      redirect: 'follow',
    }

    const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/lukso/tokens/${token}`, requestOptions)
    if (!response.ok) throw new Response('Failed to get data', { status: 500 })
    return response.json()
  }

  const getLYXPrice = async () => {
    let requestOptions = {
      method: 'GET',
      redirect: 'follow',
    }

    const response = await fetch(`https://api.diadata.org/v1/assetQuotation/Lukso/0x0000000000000000000000000000000000000000`, requestOptions)
    if (!response.ok) throw new Response('Failed to get data', { status: 500 })
    return response.json()
  }

  const toUsDollar = (price) => {
    console.log(web3.utils.toNumber(price))
    if (!LYX) return 0
    const amount = LYX * web3.utils.fromWei(web3.utils.toNumber(price), `ether`)
    return amount.toPrecision(4)
  }

  const updatePrice = async (e) => {
    e.preventDefault()

    setIsLoading(true)

    const t = toast.loading(`Waiting for transaction's confirmation`)

    const formData = new FormData(e.target)
    const price = formData.get('price')

    try {
      window.lukso.request({ method: 'eth_requestAccounts' }).then((accounts) => {
        contract.methods
          .updateMintPrice(_.toWei(price, `ether`))
          .send({
            from: accounts[0],
          })
          .then((res) => {
            console.log(res) //res.events.tokenId

            setIsLoading(true)

            toast.success(`Done`)

            toast.dismiss(t)
          })
          .catch((error) => {
            toast.dismiss(t)
          })
      })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  const handleTransfer = async (e) => {
    const t = toast.loading(`Waiting for transaction's confirmation`)
    e.target.innerText = `Waiting...`
    if (typeof window.lukso === 'undefined') window.open('https://chromewebstore.google.com/detail/universal-profiles/abpickdkkbnbcoepogfhkhennhfhehfn?hl=en-US&utm_source=candyzap.com', '_blank')

    try {
      window.lukso
        .request({ method: 'eth_requestAccounts' })
        .then((accounts) => {
          const account = accounts[0]
          console.log(account)
          // walletID.innerHTML = `Wallet connected: ${account}`;

          web3.eth.defaultAccount = account
          contract.methods
            .transferOwnership(document.querySelector(`#newOwner`).value)
            .send({
              from: account,
            })
            .then((res) => {
              console.log(res) //res.events.tokenId

              // Run partyjs
              party.confetti(document.querySelector(`.__container`), {
                count: party.variation.range(20, 40),
                shapes: ['egg', 'coin'],
              })

              toast.success(`Done`)

              e.target.innerText = `Transfer`
              toast.dismiss(t)
            })
            .catch((error) => {
              e.target.innerText = `Transfer`
              toast.dismiss(t)
            })
          // Stop loader when connected
          //connectButton.classList.remove("loadingButton");
        })
        .catch((error) => {
          e.target.innerText = `Transfer`
          // Handle error
          console.log(error, error.code)
          toast.dismiss(t)
          // Stop loader if error occured

          // 4001 - The request was rejected by the user
          // -32602 - The parameters were invalid
          // -32603- Internal error
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
      e.target.innerText = `Transfer`
    }
  }

  const handleForm = async (e) => {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.target)
    const phone = formData.get('phone')
    const password = formData.get('password')
    const errors = {}

    // validate the fields
    if (phone.length < 11) {
      errors.phone = 'err'
      toast(errors.phone, 'error')
    }

    if (typeof password !== 'string' || password.length < 4) {
      errors.password = 'err'
      toast(errors.password, 'error')
    }
    // // return data if we have errors
    // if (Object.keys(errors).length) {
    //   return errors
    // }

    const post = {
      phone: phone,
      password: password,
    }

    try {
      const res = await signUp(post)
      console.log(res)
      if (res.result) {
        localStorage.setItem('token', JSON.stringify(res.token))
        toast(`signed in successfuly`, `success`)
        router.push('/user/dashboard')
      } else {
        toast(`${res.message}`, `error`)
        setIsLoading(false)
      }
    } catch (error) {
      console.log(error)
      setIsLoading(false)
    }
    return null
  }

  // ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■
  const updateActivePhase = async (e) => {
    e.preventDefault()
    const t = toast.loading(`Waiting for transaction's confirmation`)

    const formData = new FormData(e.target)
    const phaseName = web3.utils.keccak256(formData.get('_phaseName'))

    console.log(phaseName)

    try {
      contract.methods
        .updateActivePhase(phaseName)
        .send({
          from: auth.accounts[0],
        })
        .then((res) => {
          console.log(res)
          toast.success(`Done`)
          toast.dismiss(t)
        })
        .catch((error) => {
          console.log(error)
          toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  const updateAddresses = async (e) => {
    e.preventDefault()
    const t = toast.loading(`Waiting for transaction's confirmation`)

    const formData = new FormData(e.target)
    const newAddresses = formData.get('_newAddresses')

    console.log(newAddresses.split(','))

    try {
      contract.methods
        .updateAddresses(newAddresses.split(','))
        .send({
          from: auth.accounts[0],
        })
        .then((res) => {
          console.log(res) //res.events.tokenId

          toast.success(`Done`)
          toast.dismiss(t)
        })
        .catch((error) => {
          console.log(error)
          toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  const updatePPT = async (e) => {
    e.preventDefault()
    const t = toast.loading(`Waiting for transaction's confirmation`)

    const formData = new FormData(e.target)
    const newValue = formData.get('_newValue')

    try {
      contract.methods
        .updatePPT(newValue)
        .send({
          from: auth.accounts[0],
        })
        .then((res) => {
          console.log(res) //res.events.tokenId

          toast.success(`Done`)
          toast.dismiss(t)
        })
        .catch((error) => {
          console.log(error)
          toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  const updateWhitelist = async (e) => {
    e.preventDefault()
    const t = toast.loading(`Waiting for transaction's confirmation`)

    const formData = new FormData(e.target)
    const addr = formData.get('address').split(',')
    const count = formData.get('count')

    try {
      contract.methods
        .updateWhitelist(addr, count)
        .send({
          from: auth.accounts[0],
        })
        .then((res) => {
          console.log(res) //res.events.tokenId

          toast.success(`Done`)
          toast.dismiss(t)
        })
        .catch((error) => {
          console.log(error)
          toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  const checkWhitelist = async (e) => {
    const t = toast.loading(`Waiting for transaction's confirmation`)
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.target)
    const address = formData.get('address')

    try {
      contract.methods
        .whitelist(address)
        .call()
        .then((res) => {
          console.log(res) //res.events.tokenId

          toast.success(`${web3.utils.toNumber(res)}`)
          toast.dismiss(t)
        })
        .catch((error) => {
          console.log(error)
          toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  const updatePoint = async (e) => {
    const t = toast.loading(`Waiting for transaction's confirmation`)
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.target)
    const tokenId = formData.get('_tokenId')
    const point = formData.get('_point')
    const level = formData.get('_level')

    try {
      contract.methods
        .updatePoint(tokenId, point, level)
        .send({
          from: auth.accounts[0],
        })
        .then((res) => {
          console.log(res) //res.events.tokenId

          toast.success(`Done`)
          toast.dismiss(t)
        })
        .catch((error) => {
          console.log(error)
          toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  const updatePhase = async (e) => {
    const t = toast.loading(`Waiting for transaction's confirmation`)
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.target)
    const phaseName = formData.get('_phaseName')
    const background = formData.get('_background')
    const maxMintPerWallet = formData.get('_maxMintPerWallet')
    const price = formData.get('_price')
    const tokenAddress = formData.get('_tokenAddress')

    try {
      contract.methods
        .updatePhase(phaseName, background, maxMintPerWallet, price, tokenAddress)
        .send({
          from: auth.accounts[0],
        })
        .then((res) => {
          console.log(res) //res.events.tokenId

          toast.success(`Done`)
          toast.dismiss(t)
        })
        .catch((error) => {
          console.log(error)
          toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
    }
  }

  const initialize = async (e) => {
    const t = toast.loading(`Waiting for transaction's confirmation`)
    e.target.innerText = `Waiting...`

    try {
      contract.methods
        .initialize()
        .send({
          from: auth.accounts[0],
        })
        .then((res) => {
          console.log(res) //res.events.tokenId

          toast.success(`Done`)

          e.target.innerText = `Initialize`
          toast.dismiss(t)
        })
        .catch((error) => {
          console.log(error)
          e.target.innerText = `Initialize`
          toast.dismiss(t)
        })
    } catch (error) {
      console.log(error)
      toast.dismiss(t)
      e.target.innerText = `Initialize`
    }
  }

  const getLevel = async (e, tokenId) => {
    const levelData = await contract.methods.level(tokenId).call()
    console.log(levelData)
    setlevel(levelData)
  }

  const getIsInitialized = async () => await contract.methods.initialized().call()
  const getWhitelist = async (addr) => await contract.methods.getWhitelist(addr).call()
  const getMaxSupply = async () => await contract.methods.MAX_SUPPLY().call()
  const getSupplyCap = async () => await contract.methods.PHASE_ONE_TWO_SUPPLY_CAP().call()
  const getTokenIdCounter = async () => await contract.methods.tokenIdCounter().call()
  const getPPT = async () => await contract.methods.PPT().call()
  const getVersion = async () => await contract.methods.VERSION().call()

  const getActivePhase = async () => {
    const result = await contract.methods.activePhase().call()
    switch (result) {
      case web3.utils.keccak256('phase1'):
        return 'phase1'
      case web3.utils.keccak256('phase2'):
        return 'phase2'
      case web3.utils.keccak256('phase3'):
        return 'phase3'
      case web3.utils.keccak256('phase4'):
        return 'phase4'

      default:
        return 'Wrong Phase'
        break
    }
  }

  const getLevelPrice = async () => {
    const _ = web3.utils

    const lvl1 = _.toNumber(await contract.methods.levelPrice(1).call())
    const lvl2 = _.toNumber(await contract.methods.levelPrice(2).call())
    const lvl3 = _.toNumber(await contract.methods.levelPrice(3).call())
    const lvl4 = _.toNumber(await contract.methods.levelPrice(4).call())
    const lvl5 = _.toNumber(await contract.methods.levelPrice(5).call())
    const lvl6 = _.toNumber(await contract.methods.levelPrice(6).call())
    const lvl7 = _.toNumber(await contract.methods.levelPrice(7).call())
    const lvl8 = _.toNumber(await contract.methods.levelPrice(8).call())
    const lvl9 = _.toNumber(await contract.methods.levelPrice(9).call())
    const lvl10 = _.toNumber(await contract.methods.levelPrice(10).call())

    return [lvl1, lvl2, lvl3, lvl4, lvl5, lvl6, lvl7, lvl8, lvl9, lvl10]
  }

  const getPhase = async () => {
    const _ = web3.utils

    const ph1 = await contract.methods.phases(_.keccak256('phase1')).call()
    const ph2 = await contract.methods.phases(_.keccak256('phase2')).call()
    const ph3 = await contract.methods.phases(_.keccak256('phase3')).call()
    const ph4 = await contract.methods.phases(_.keccak256('phase4')).call()

    return [ph1, ph2, ph3, ph4]
  }

  const getFISH = async () => await contract.methods.FISH().call()
  const getMEMBER_CARD = async () => await contract.methods.MEMBER_CARD().call()
  const getRICH = async () => await contract.methods.RICH().call()
  const getFISHCAN = async () => await contract.methods.FISHCAN().call()
  const getARATTALABS = async () => await contract.methods.ARATTALABS().call()
  const getLUKSEALS = async () => await contract.methods.LUKSEALS().call()
  const getMADSKI = async () => await contract.methods.MADSKI().call()
  const getDACHRIZ = async () => await contract.methods.DACHRIZ().call()
  const getARFI = async () => await contract.methods.ARFI().call()
  const getFOLLOWING = async () => await contract.methods.FOLLOWING().call()
  const getFishBalance = async () => await contractFish.methods.balanceOf(process.env.NEXT_PUBLIC_CONTRACT).call()
  const getLYXBalance = async () => await web3.eth.getBalance(process.env.NEXT_PUBLIC_CONTRACT)

  useEffect(() => {
    getLYXPrice().then((res) => {
      console.log(parseFloat(res.Price))
      setLYX(parseFloat(res.Price))
    })

    getFishBalance().then((res) => {
      console.log(res)
      setFishBalance(web3.utils.fromWei(res, `ether`))
    })

    getLYXBalance().then((res) => {
      console.log(res)
      const balance = web3.utils.fromWei(res, `ether`)
      setLYXBalance(balance)
    })

    getMaxSupply().then((res) => {
      console.log(res)
      setMaxSupply(res)
    })

    getSupplyCap().then((res) => {
      console.log(res)
      setSupplyCap(res)
    })

    getTokenIdCounter().then((res) => {
      console.log(res)
      setTokenIdCounter(res)
    })

    getPPT().then((res) => {
      console.log(res)
      setPPT(res)
    })

    getVersion().then((res) => {
      console.log(res)
      setVersion(res)
    })

    getIsInitialized().then(setIsInitialized)
    getActivePhase().then(setActivePhase)
    getFISH().then(setFISH)
    getMEMBER_CARD().then(setMEMBER_CARD)
    getRICH().then(setRICH)
    getFISHCAN().then(setFISHCAN)
    getARATTALABS().then(setARATTALABS)
    getLUKSEALS().then(setLUKSEALS)
    getMADSKI().then(setMADSKI)
    getDACHRIZ().then(setDACHRIZ)
    getARFI().then(setARFI)
    getFOLLOWING().then(setFOLLOWING)

    getLevelPrice().then((res) => {
      console.log(res)
      setLevelPrice(res)
    })

    getPhase().then((res) => {
      console.log(res)
      setPhases(res)
    })

    // getReaction(auth.contextAccounts[0]).then(async (reactionData) => {
    // console.log(reactionData)
    // if (reactionData.length < 1) return
    // setReaction(reactionData)

    // let senders = []
    // reactionData.forEach((item) => senders.push(item.sender.toLowerCase()))
    // console.log(senders)

    // getProfiles(senders).then((res) => {
    //   console.log(res)
    //   let users = []
    //   reactionData.forEach((react) => {
    //     users.push(Object.assign(react, res.data.Profile.filter((profile) => profile.id.toLowerCase() === react.sender.toLowerCase())[0]))
    //   })
    //   setUser(users)
    // })

    // getLYXPrice().then((res) => {
    //   console.log(parseFloat(res.Price))
    //   setLYX(parseFloat(res.Price))
    // })

    // let responses_with_profile = []
    // await Promise.all(
    //   res.map(async (response, i) => {
    //     return getProfile(response.sender).then((profile) => {
    //       responses_with_profile.push(Object.assign(profile, response))
    //     })
    //   })
    // )
    //})
  }, [])

  // {reaction && reaction.sort((a, b) => web3.utils.toNumber(b.dt) - web3.utils.toNumber(a.dt)).map((item, i) => {
  return (
    <div className={`${styles.page} ms-motion-slideDownIn`}>
      <div className={`__container`} data-width={`xlarge`}>
        <div className={`grid grid--fit grid--gap-1 w-100`} style={{ '--data-width': `150px` }}>
          {auth.walletConnected && (
            <>
              <div className="card">
                <div className={`card__body d-f-c flex-column`}>
                  <WalletBalance />
                  <small>Wallet LYX Balance</small>
                </div>
              </div>

              <div className="card">
                <div className={`card__body d-f-c flex-column`}>
                  <WalletFishBalance />
                  <small>Wallet Fish Balance</small>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card" data-shadow={'none'}>
          <button disabled={isInitialized} onClick={(e) => initialize(e)} className="btn" style={{ width: `100%` }}>
            {isInitialized ? 'Already initialized' : 'Initialize'}
          </button>
        </div>

        <div className={`grid grid--fill grid--gap-1 w-100`} style={{ '--data-width': `150px` }}>
          <div className="card" data-readonly={true}>
            <div className={`card__body d-f-c flex-column`}>
              <b>{maxSupply && new Intl.NumberFormat().format(maxSupply)}</b>
              <small>Max Supply</small>
            </div>
          </div>

          <div className="card" data-readonly={true}>
            <div className={`card__body d-f-c flex-column`}>
              <b>{supplyCap && new Intl.NumberFormat().format(supplyCap)}</b>
              <small>Supply Cap (Ph1 + Ph2)</small>
            </div>
          </div>

          <div className="card" data-readonly={true}>
            <div className={`card__body d-f-c flex-column`}>
              <b>{version && web3.utils.hexToAscii(version)}</b>
              <small>Version</small>
            </div>
          </div>

          <div className="card">
            <div className={`card__body d-f-c flex-column`}>
              <b>{tokenIdCounter && new Intl.NumberFormat().format(tokenIdCounter)}</b>
              <small>Minted</small>
            </div>
          </div>

          <div className="card">
            <div className={`card__body d-f-c flex-column`}>
              <b>{PPT && PPT}</b>
              <small>Point Per Tap</small>
            </div>
          </div>

          <div className="card">
            <div className={`card__body d-f-c flex-column`}>
              <b>{(activePhase && activePhase !== `0x0000000000000000000000000000000000000000000000000000000000000000` && activePhase) || `-`}</b>
              <small>Active Phase</small>
            </div>
          </div>

          <div className="card">
            <div className={`card__body d-f-c flex-column`}>
              <b>{LYXBalance && `${LYXBalance} LYX`}</b>
              <small>LYX Balance</small>
            </div>
          </div>

          <div className="card">
            <div className={`card__body d-f-c flex-column`}>
              <b>{fishBalance && new Intl.NumberFormat().format(fishBalance)} FISH</b>
              <small>FISH Balance</small>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__header">Level Prices</div>
          <div className={`card__body`}>
            <ul>
              {levelPrice &&
                levelPrice.map((item, i) => (
                  <li key={i} className={`d-flex align-items-center gap-1`}>
                    <small style={{ width: `40px` }}>LVL {++i}:</small>
                    <code>{new Intl.NumberFormat().format(web3.utils.fromWei(item, `ether`))} FISH</code>
                  </li>
                ))}
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card__header">Update Active Phase</div>
          <div className={`card__body`}>
            <form onSubmit={(e) => updateActivePhase(e)} className={`form d-flex flex-column`} style={{ rowGap: '1rem' }}>
              <div>
                <label htmlFor="">Active Phase</label>
                <input type="text" name="_phaseName" defaultValue={``} placeholder="" required />
                <small>phase1, phase2, phase3, phase4</small>
              </div>

              <button className="mt-20 btn" type="submit">
                Update
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card__header">Contract Addresses</div>
          <div className={`card__body`}>
            <ul>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>Fish:</small>
                <a target="_blank" href={`https://explorer.execution.testnet.lukso.network/address/${FISH}`}>
                  <code>{FISH}</code>
                </a>
              </li>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>Member card:</small>
                <a target="_blank" href={`https://explorer.execution.testnet.lukso.network/address/${MEMBER_CARD}`}>
                  <code>{MEMBER_CARD}</code>
                </a>
              </li>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>Rich:</small>

                <a target="_blank" href={`https://explorer.execution.testnet.lukso.network/address/${RICH}`}>
                  <code>{RICH}</code>
                </a>
              </li>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>Fishcan:</small>
                <a target="_blank" href={`https://explorer.execution.testnet.lukso.network/address/${FISHCAN}`}>
                  <code>{FISHCAN}</code>
                </a>
              </li>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>Arattalabs:</small>
                <code>{ARATTALABS}</code>
              </li>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>Lukseals:</small>
                <code>{LUKSEALS}</code>
              </li>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>Madski:</small>
                <code>{MADSKI}</code>
              </li>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>Dachriz:</small>
                <code>{DACHRIZ}</code>
              </li>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>ARF-I:</small>
                <code>{ARFI}</code>
              </li>
              <li className={`d-flex align-items-center gap-1`}>
                <small style={{ width: `100px` }}>Following:</small>
                <a target="_blank" href={`https://explorer.execution.testnet.lukso.network/address/${FOLLOWING}`}>
                  <code>{FOLLOWING}</code>
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card__header">Update Contract Addresses</div>
          <div className={`card__body`}>
            {/* {errors?.email && <span>{errors.email}</span>} */}
            <form onSubmit={(e) => updateAddresses(e)} className={`form d-flex flex-column`} style={{ rowGap: '1rem' }}>
              <div>
                <label htmlFor="">Addresses[]</label>
                <input type="text" name="_newAddresses" defaultValue={``} placeholder="0x0, 0x1, ..., 0x10" required />
              </div>

              <button className="mt-20 btn" type="submit">
                Update
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card__header">Phases</div>
          <div className={`card__body d-flex align-items-center`}>
            <ul>
              {phases &&
                phases.map((item, i) => (
                  <li key={i} className={`d-flex flex-row align-items-center gap-1 mt-10 ${activePhase === `phase${i + 1}` && 'animate__animated animate__flash animate__slower animate__infinite'}`}>
                    <span className="text-danger">phase {i + 1}</span>
                    <small>
                      Background: <b>{item.background}</b>
                    </small>
                    <small title="Max Mint Per Wallet">
                      MMPW: <b>{web3.utils.toNumber(item.maxMintPerWallet)} seals</b>
                    </small>
                    <small>
                      Price:
                      <b className="ml-10 badge badge-danger">
                        {new Intl.NumberFormat().format(web3.utils.fromWei(web3.utils.toNumber(item.price), `ether`))}
                        {item.tokenAddress == `0x0000000000000000000000000000000000000000` ? ` LYX` : ` FISH`}
                      </b>
                    </small>
                    <small title={item.tokenAddress}>Token Address</small>
                  </li>
                ))}
            </ul>
          </div>
        </div>

        <div className={`grid grid--fit grid--gap-1 w-100`} style={{ '--data-width': `400px` }}>
          <div className="card">
            <div className="card__header">Update Phases</div>
            <div className={`card__body`}>
              <form onSubmit={(e) => updatePhase(e)} className={`form d-flex flex-column`} style={{ rowGap: '1rem' }}>
                <select name="" id="" onChange={(e) => setSelectedPhase(e.target.value)}>
                  <option value="">Select phase</option>
                  {phases &&
                    phases.map((item, i) => (
                      <option key={i} value={i + 1}>
                        phase{i + 1}
                      </option>
                    ))}
                </select>

                {selectedPhase && (
                  <div className="border border--dark" style={{ background: `var(--black-050)`, padding: `10px` }}>
                    <div>
                      <label htmlFor="">Name</label>
                      <input type="text" name="_phaseName" defaultValue={web3.utils.keccak256(`phase${selectedPhase}`)} required />
                      <input type="hidden" name="_phaseNameHidden" defaultValue={``} />
                    </div>
                    <div>
                      <label htmlFor="">Background</label>
                      <input type="text" name="_background" defaultValue={phases[selectedPhase - 1].background} required />
                    </div>
                    <div>
                      <label htmlFor="">Max Mint Per Wallet</label>
                      <input type="text" name="_maxMintPerWallet" defaultValue={web3.utils.toNumber(phases[selectedPhase - 1].maxMintPerWallet)} required />
                    </div>
                    <div>
                      <label htmlFor="">Price</label>
                      <input type="text" name="_price" defaultValue={web3.utils.fromWei(web3.utils.toNumber(phases[selectedPhase - 1].price), `ether`)} required />
                    </div>
                    <div>
                      <label htmlFor="">Token Address</label>
                      <input type="text" name="_tokenAddress" defaultValue={phases[selectedPhase - 1].tokenAddress} required />
                    </div>
                  </div>
                )}
                <button className="mt-20 btn" type="submit">
                  Update
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card__header">Update Point & Level</div>
            <div className={`card__body`}>
              <form onSubmit={(e) => updatePoint(e)} className={`form d-flex flex-column`} style={{ rowGap: '1rem' }}>
                <div>
                  <label htmlFor="">Token Id</label>
                  <input type="text" name="_tokenId" id={`_tokenId`} required />
                  <small>
                    e.g. <code>0x0000000000000000000000000000000000000000000000000000000000000001</code>
                  </small>
                </div>

                <output>
                  {level && (
                    <>
                      <code>
                        Level: {web3.utils.toNumber(level.level)}
                        <br />
                        XP: {web3.utils.toNumber(level.xp)}
                      </code>
                    </>
                  )}
                </output>

                <div>
                  <label htmlFor="">Point</label>
                  <input type="number" name="_point" required defaultValue={level && level.xp} disabled={!level} />
                </div>

                <div>
                  <label htmlFor="">Level</label>
                  <input type="number" name="_level" min={0} max={10} defaultValue={level && level.level} required disabled={!level} />
                  <small>Level can be 0-10</small>
                </div>

                <button className="mt-20 btn" type="button" onClick={(e) => getLevel(e, document.querySelector(`#_tokenId`).value)}>
                  Get level
                </button>
                <button className="mt-20 btn" type="submit" disabled={!level}>
                  Update
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card__header">Update PPT</div>
            <div className={`card__body`}>
              {/* {errors?.email && <span>{errors.email}</span>} */}
              <form onSubmit={(e) => updatePPT(e)} className={`form d-flex flex-column`} style={{ rowGap: '1rem' }}>
                <div>
                  <input type="number" name="_newValue" placeholder="0" required />
                </div>

                <button className="mt-20 btn" type="submit">
                  Update
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card__header">Check Whitelist</div>
            <div className={`card__body`}>
              {/* {errors?.email && <span>{errors.email}</span>} */}
              <form onSubmit={(e) => checkWhitelist(e)} className={`form d-flex flex-column`} style={{ rowGap: '1rem' }}>
                <div>
                  <input type="text" name="address" placeholder="0x0" required />
                </div>

                <button className="mt-20 btn" type="submit">
                  Check
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card__header">Update Whitelist</div>
            <div className={`card__body`}>
              {/* {errors?.email && <span>{errors.email}</span>} */}
              <form onSubmit={(e) => updateWhitelist(e)} className={`form d-flex flex-column`} style={{ rowGap: '1rem' }}>
                <div>
                  <label htmlFor="">Addresses[]</label>
                  <input type="text" name="address" placeholder={`0x0, 0x1, 0xn`} required />
                </div>

                <div>
                  <input type="number" name="count" defaultValue={1} required />
                  <small>If greater than 0, the wallet address will be whitelisted.</small>
                </div>

                <button className="mt-20 btn" type="submit">
                  Update
                </button>
              </form>
            </div>
          </div>

          <div className={`card mt-10`}>
            <div className={`card__header`}>Transfer ownership</div>
            <div className={`card__body form`}>
              <div>
                <input className="input" type="text" id="newOwner" />
              </div>

              <button className="mt-10 btn" onClick={(e) => handleTransfer(e)}>
                Transfer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const WalletBalance = () => {
  const [balance, setBalance] = useState()
  const auth = useUpProvider()
  const web3 = new Web3(auth.provider)
  const contract = new web3.eth.Contract(ABI, process.env.NEXT_PUBLIC_CONTRACT)
  const contractFish = new web3.eth.Contract(ABILSP7, process.env.NEXT_PUBLIC_CONTRACT_FISH)
  const _ = web3.utils

  const getWalletBalance = async (wallet) => {
    const balance = await web3.eth.getBalance(wallet)
    return parseFloat(web3.utils.fromWei(balance, `ether`)).toFixed(2)
  }

  useEffect(() => {
    getWalletBalance(auth.accounts[0]).then((result) => {
      setBalance(result)
    })
  }, [])

  if (!balance) return <>0</>
  return <b>{new Intl.NumberFormat().format(balance)}</b>
}

const WalletFishBalance = () => {
  const [balance, setBalance] = useState()
  const auth = useUpProvider()
  const web3 = new Web3(auth.provider)
  const contract = new web3.eth.Contract(ABI, process.env.NEXT_PUBLIC_CONTRACT)
  const contractFish = new web3.eth.Contract(ABILSP7, process.env.NEXT_PUBLIC_CONTRACT_FISH)
  const _ = web3.utils

  const getWalletFishBalance = async (wallet) => {
    const balance = await contractFish.methods.balanceOf(wallet).call()
    return parseFloat(web3.utils.fromWei(balance, `ether`)).toFixed(2)
  }

  useEffect(() => {
    getWalletFishBalance(auth.accounts[0]).then((result) => {
      setBalance(result)
    })
  }, [])

  if (!balance) return <>0</>
  return <b>{new Intl.NumberFormat().format(balance)}</b>
}
