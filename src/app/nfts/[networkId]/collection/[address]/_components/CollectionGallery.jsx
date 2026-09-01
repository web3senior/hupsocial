'use client'

/**
 * @file CollectionGallery.jsx
 * @description The collection as a building you walk through. The first rooms hold what is up
 * for sale on Hup — the same rows the "For sale" grid shows, 24 to a room — and the doorway
 * after the last of them leads on into the whole collection, every token 24 to a room, listed
 * or not. Each doorway is the previous or next page of whichever feed the wing is showing.
 *
 * The 3D scene (lib/galleryScene) is imported on mount and only on mount, so three.js never
 * reaches a visitor who stays on the grid.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { CornersInIcon, CornersOutIcon } from '@phosphor-icons/react'
import { CHAIN_ICONS } from '@/config/chainIcons'
import { getNftListings } from '@/lib/api'
import { loadNftMetadata } from '@/lib/nftMetadataBatch'
import { networkColorStyle } from '@/lib/networkColors'
import { displayTokenId } from '@/lib/walletNfts'
import { formatStake } from '@/hooks/useStakeToken'
import { resolveNftImageUrl } from '@/hooks/useNftMetadata'
import useCollectionTokens from '@/hooks/useCollectionTokens'
import { toast } from '@/components/NextToast'
import { Spinner } from '@/components/Loading'
import NftQuickBuy from '@/components/NftQuickBuy'
import styles from './CollectionGallery.module.scss'

const count = new Intl.NumberFormat()

// Matches the scene's hanging slots — and both feeds' page size, so one page is one room
const PER_ROOM = 24
const JOY_RADIUS = 44
const TEXTURE_WIDTH = 512

let scenePromise = null
const loadScene = () => {
  if (!scenePromise) scenePromise = import('@/lib/galleryScene')
  return scenePromise
}

const listingHref = (chainId, listingId) => `/nfts/${chainId}/${listingId}`
const tokenHref = (chainId, collection, tokenId) => `/nfts/${chainId}/collection/${collection}/${encodeURIComponent(tokenId)}`

// A texture can only be built from bytes this origin served: proxied and inline artwork
// already qualify, while a collection hosting its images on its own domain comes through
// the token image route instead of straight from that host
const textureUrl = (image, { chainId, collection, tokenId, isLsp8 }) => {
  if (!image) return null
  if (image.startsWith('/') || image.startsWith('data:')) return image
  const params = new URLSearchParams({ chainId: String(chainId), collection, tokenId: String(tokenId), w: String(TEXTURE_WIDTH), still: '1', sameOrigin: '1' })
  if (isLsp8) params.set('isLsp8', '1')
  return `/api/nft/image?${params.toString()}`
}

// Touch decides the whole control scheme, so it is read as a store rather than guessed on
// the server: the first paint agrees with the HTML, then follows the device
const COARSE_POINTER = '(pointer: coarse)'
const subscribeCoarsePointer = (callback) => {
  const query = window.matchMedia(COARSE_POINTER)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}
const readCoarsePointer = () => window.matchMedia(COARSE_POINTER).matches
const readCoarsePointerOnServer = () => false

/**
 * @param {Object} props
 * @param {number} props.chainId Chain the collection lives on.
 * @param {string} props.collection Collection contract address, lowercased.
 * @param {string|null} props.collectionName For piece names while token metadata resolves.
 * @param {boolean|null} props.isLsp8 The collection's standard; null until it resolves. The
 * collection wing can't enumerate tokens without it.
 * @param {Object} [props.chainInfo] Entry from appChains — colours and native currency.
 */
export default function CollectionGallery({ chainId, collection, collectionName, isLsp8, chainInfo }) {
  const router = useRouter()
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const mapRef = useRef(null)
  const joyRef = useRef(null)
  const joyKnobRef = useRef(null)
  const buyRef = useRef(null)
  const sceneRef = useRef(null)
  // The scene is created once; its callbacks read the latest handlers through this ref
  const handlersRef = useRef({})

  const isTouch = useSyncExternalStore(subscribeCoarsePointer, readCoarsePointer, readCoarsePointerOnServer)

  const [status, setStatus] = useState('loading')
  // Which wing and room is hung, and which door the visitor came through — null on the first
  // room, where the scene's own starting spot applies. 'sale' rooms page the listings; 'all'
  // rooms page the collection's tokens.
  const [entry, setEntry] = useState({ wing: 'sale', room: 0, side: null })
  const [pendingDoor, setPendingDoor] = useState(null)
  const { wing, room } = entry
  const [hovered, setHovered] = useState(-1)
  const [locked, setLocked] = useState(false)
  // 'intro' until the visitor enters, 'paused' after the mouse is released, null while walking
  const [overlay, setOverlay] = useState('intro')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [metaByToken, setMetaByToken] = useState({})

  // --- The live listings, one page per room of the first wing ---
  const [listings, setListings] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isFetchingMore, setIsFetchingMore] = useState(false)
  const filters = useMemo(() => ({ networkId: String(chainId), collection, status: '' }), [chainId, collection])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await getNftListings(1, PER_ROOM, filters)
        if (cancelled) return
        setListings(res.data || [])
        setHasMore(res.meta?.hasMore || false)
        setPage(1)
      } catch {
        if (!cancelled) {
          setListings([])
          setHasMore(false)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [filters])

  const loadMore = useCallback(async () => {
    if (isFetchingMore || isLoading || !hasMore) return
    setIsFetchingMore(true)
    const nextPage = page + 1
    try {
      const res = await getNftListings(nextPage, PER_ROOM, filters)
      setListings((prev) => [...prev, ...(res.data || [])])
      setHasMore(res.meta?.hasMore || false)
      setPage(nextPage)
    } catch {
      // The next door crossing tries again — same rule as every other load-more in the app
    } finally {
      setIsFetchingMore(false)
    }
  }, [isFetchingMore, isLoading, hasMore, page, filters])

  // --- The whole collection, fetched once the visitor heads for that wing ---
  const [wantTokens, setWantTokens] = useState(false)
  const collectionFeed = useCollectionTokens({ chainId, collection, isLsp8, enabled: wantTokens })
  const tokens = collectionFeed.tokens
  const collectionEnded = wantTokens && collectionFeed.mode !== null && !collectionFeed.isLoading && !collectionFeed.hasMore
  const collectionEmpty = collectionEnded && tokens.length === 0

  // Nothing for sale: the visit starts in the collection wing instead of an empty room
  if (!isLoading && listings.length === 0 && wing === 'sale' && !wantTokens) {
    setWantTokens(true)
    setEntry({ wing: 'all', room: 0, side: null })
  }

  // A door crossed before its page had loaded: walk through the moment the page lands, and
  // stand down quietly if the feed turned out to end here — the sign says so
  if (pendingDoor === 'next') {
    if (wing === 'sale') {
      if (listings.length > (room + 1) * PER_ROOM) {
        setPendingDoor(null)
        setEntry({ wing: 'sale', room: room + 1, side: 'west' })
      } else if (!isFetchingMore && !hasMore) {
        if (tokens.length > 0) {
          setPendingDoor(null)
          setEntry({ wing: 'all', room: 0, side: 'west' })
        } else if (collectionEnded) {
          setPendingDoor(null)
        }
      }
    } else if (tokens.length > (room + 1) * PER_ROOM) {
      setPendingDoor(null)
      setEntry({ wing: 'all', room: room + 1, side: 'west' })
    } else if (collectionEnded) {
      setPendingDoor(null)
    }
  }

  // Full listing rows by token, so a piece in the collection wing that happens to be for sale
  // carries its price and the same buy button the sale wing has
  const listingByToken = useMemo(() => new Map(listings.map((listing) => [String(listing.token_id), listing])), [listings])

  // One shape for both wings: `listing` is a full row the buy button can act on; `pricing`
  // is whatever can at least print a price (the tokens API joins a lighter listing)
  const pieces = useMemo(() => {
    const start = room * PER_ROOM
    if (wing === 'sale') {
      return listings.slice(start, start + PER_ROOM).map((listing) => ({
        key: `listing-${listing.listing_id}`,
        tokenId: listing.token_id,
        isLsp8: Boolean(Number(listing.is_lsp8)),
        listing,
        pricing: listing,
      }))
    }
    return tokens.slice(start, start + PER_ROOM).map((token) => {
      const listing = listingByToken.get(String(token.token_id)) || null
      return {
        key: `token-${token.token_id}`,
        tokenId: token.token_id,
        isLsp8: Boolean(token.is_lsp8),
        listing,
        pricing: listing || token.listing || null,
      }
    })
  }, [wing, room, listings, tokens, listingByToken])

  const feedLength = wing === 'sale' ? listings.length : tokens.length
  const nativeCurrency = chainInfo?.nativeCurrency

  // Native-coin listings come back with null symbol/decimals — the chain config fills both
  // in, the same rule every price in the app follows
  const priceOf = useCallback(
    (pricing) => {
      if (!pricing) return null
      const symbol = pricing.symbol || nativeCurrency?.symbol || ''
      const decimals = pricing.decimals ?? nativeCurrency?.decimals
      const amount = formatStake(pricing.price, decimals)
      return amount ? `${amount} ${symbol}`.trim() : null
    },
    [nativeCurrency],
  )

  const nameOf = useCallback(
    (tokenId) => {
      const label = displayTokenId(tokenId)
      return metaByToken[tokenId]?.name || (collectionName ? `${collectionName} #${label}` : `#${label}`)
    },
    [metaByToken, collectionName],
  )

  const hrefOf = useCallback((piece) => (piece.listing ? listingHref(chainId, piece.listing.listing_id) : tokenHref(chainId, collection, piece.tokenId)), [chainId, collection])

  // --- Renderer ---
  useEffect(() => {
    const coarse = readCoarsePointer()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let active = true

    loadScene()
      .then(({ createGalleryScene }) => {
        if (!active || !canvasRef.current) return
        sceneRef.current = createGalleryScene(canvasRef.current, {
          mapCanvas: mapRef.current,
          isTouch: coarse,
          reducedMotion,
          onAim: (index) => handlersRef.current.onAim?.(index),
          onOpen: (index) => handlersRef.current.onOpen?.(index),
          onDoor: (side) => handlersRef.current.onDoor?.(side),
        })
        setStatus('ready')
      })
      .catch((error) => {
        console.warn('[CollectionGallery] renderer failed to load:', error.message)
        if (active) setStatus('error')
      })

    return () => {
      active = false
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
  }, [])

  // The chain's own logo, floated above the doorways
  const primaryColor = chainInfo?.primaryColor
  useEffect(() => {
    if (status !== 'ready') return
    sceneRef.current?.setEmblem(CHAIN_ICONS[chainId], { color: primaryColor })
  }, [status, chainId, primaryColor])

  // --- Hang the room: placeholders at once, artwork as each token's metadata resolves ---
  const roomKey = pieces.map((piece) => piece.key).join('|')
  useEffect(() => {
    const scene = sceneRef.current
    if (status !== 'ready' || !scene) return
    let cancelled = false
    scene.clear()

    pieces.forEach((piece, index) => {
      const { tokenId, isLsp8: pieceIsLsp8 } = piece
      const subtitle = `#${displayTokenId(tokenId)}`
      const price = priceOf(piece.pricing)
      scene.hang(index, { title: nameOf(tokenId), subtitle, price })

      loadNftMetadata({ chainId, collection, tokenId: String(tokenId), isLsp8: pieceIsLsp8 })
        .then((data) => {
          if (cancelled) return
          const image = resolveNftImageUrl(data, { width: TEXTURE_WIDTH, still: true })
          const name = data?.name || null
          setMetaByToken((current) => (current[tokenId]?.name === name && current[tokenId]?.image === image ? current : { ...current, [tokenId]: { name, image } }))
          scene.hang(index, {
            imageUrl: textureUrl(image, { chainId, collection, tokenId, isLsp8: pieceIsLsp8 }),
            title: name || nameOf(tokenId),
            subtitle,
            price,
          })
        })
        .catch(() => {
          // The placeholder stays up with the token's number — the wall never has a hole
        })
    })

    return () => {
      cancelled = true
    }
    // roomKey stands in for pieces' identity; names re-hang through their own deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, roomKey, chainId, collection])

  // --- Door signs ---
  const collectionTotal = collectionFeed.total
  useEffect(() => {
    const scene = sceneRef.current
    if (status !== 'ready' || !scene) return
    const first = room * PER_ROOM + 1
    const nextFirst = first + PER_ROOM
    const lastSaleRoom = listings.length > 0 ? Math.floor((listings.length - 1) / PER_ROOM) : -1

    let east
    let west
    if (wing === 'sale') {
      const nextKnown = listings.length > room * PER_ROOM + PER_ROOM
      const nextLast = nextKnown && !hasMore ? listings.length : nextFirst + PER_ROOM - 1
      east = nextKnown || hasMore
        ? ['NEXT', `Room ${room + 2}`, `For sale ${count.format(nextFirst)}–${count.format(nextLast)}`, '→']
        : ['BEYOND THE SALE ROOMS', 'The whole collection', 'Every piece, listed or not', '→']
      west = room === 0
        ? ['ENTRANCE', collectionName || 'Collection', 'For sale on Hup', '·']
        : ['BACK TO', `Room ${room}`, `For sale ${count.format(first - PER_ROOM)}–${count.format(first - 1)}`, '←']
    } else {
      const nextKnown = tokens.length > room * PER_ROOM + PER_ROOM
      const nextLast = nextKnown && !collectionFeed.hasMore ? tokens.length : nextFirst + PER_ROOM - 1
      east = nextKnown || collectionFeed.hasMore
        ? ['NEXT', `Collection room ${room + 2}`, `Pieces ${count.format(nextFirst)}–${count.format(nextLast)}`, '→']
        : ['THAT IS THE WHOLE COLLECTION', `Collection room ${room + 1}`, collectionTotal ? `${count.format(collectionTotal)} pieces in all` : 'Every piece is hung', '·']
      west = room > 0
        ? ['BACK TO', `Collection room ${room}`, `Pieces ${count.format(first - PER_ROOM)}–${count.format(first - 1)}`, '←']
        : lastSaleRoom >= 0
          ? ['BACK TO', 'For sale', `Room ${lastSaleRoom + 1}`, '←']
          : ['ENTRANCE', collectionName || 'Collection', 'The whole collection', '·']
    }
    scene.setSigns({ east, west })
  }, [status, wing, room, listings.length, hasMore, tokens.length, collectionFeed.hasMore, collectionTotal, collectionName])

  // Walking into a room: the scene places the visitor just inside the door they came through
  useEffect(() => {
    const scene = sceneRef.current
    if (status !== 'ready' || !scene || !entry.side) return
    scene.enter(entry.side)
    const first = entry.room * PER_ROOM + 1
    const length = entry.wing === 'sale' ? listings.length : tokens.length
    const last = Math.min(entry.room * PER_ROOM + PER_ROOM, length)
    toast(entry.wing === 'sale' ? `Room ${entry.room + 1} · for sale ${count.format(first)}–${count.format(last)}` : `Collection room ${entry.room + 1} · pieces ${count.format(first)}–${count.format(last)}`)
    // The feed lengths only refine the toast; a later page landing must not re-enter the room
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, entry])

  const goRoom = useCallback((toWing, index, fromSide) => setEntry({ wing: toWing, room: index, side: fromSide }), [])

  // --- Scene callbacks, published to the scene whenever the data behind them changes ---
  const openPiece = useCallback(
    (index) => {
      const piece = pieces[index]
      if (piece) router.push(hrefOf(piece))
    },
    [pieces, router, hrefOf],
  )

  const crossDoor = useCallback(
    (side) => {
      const scene = sceneRef.current
      const waitForPage = (message) => {
        scene?.bounce(side === 'next' ? 'east' : 'west')
        setPendingDoor('next')
        toast(message)
      }

      if (side === 'next') {
        if (wing === 'sale') {
          if (listings.length > (room + 1) * PER_ROOM) {
            goRoom('sale', room + 1, 'west')
          } else if (hasMore) {
            waitForPage('Hanging the next room…')
            loadMore()
          } else if (tokens.length > 0) {
            goRoom('all', 0, 'west')
          } else if (collectionEmpty) {
            scene?.bounce('east')
            toast("Hup hasn't seen any other tokens from this collection yet")
          } else {
            setWantTokens(true)
            waitForPage('Hanging the collection…')
          }
        } else if (tokens.length > (room + 1) * PER_ROOM) {
          goRoom('all', room + 1, 'west')
        } else if (collectionFeed.hasMore) {
          waitForPage('Hanging the next room…')
          collectionFeed.loadMore()
        } else {
          scene?.bounce('east')
          toast('That is the whole collection')
        }
        return
      }

      if (room > 0) {
        goRoom(wing, room - 1, 'east')
      } else if (wing === 'all' && listings.length > 0) {
        goRoom('sale', Math.floor((listings.length - 1) / PER_ROOM), 'east')
      } else {
        scene?.bounce('west')
        toast('This is the entrance — the collection starts here')
      }
    },
    [wing, room, listings.length, hasMore, loadMore, tokens.length, collectionEmpty, collectionFeed, goRoom],
  )

  useEffect(() => {
    handlersRef.current = { onAim: setHovered, onOpen: openPiece, onDoor: crossDoor }
  }, [openPiece, crossDoor])

  // --- Pointer lock (desktop) and fullscreen ---
  useEffect(() => {
    const onLockChange = () => {
      const isLocked = document.pointerLockElement === canvasRef.current
      setLocked(isLocked)
      sceneRef.current?.setPaused(!isLocked && !isTouch)
      if (!isLocked && !isTouch) setOverlay((current) => (current === 'intro' ? 'intro' : 'paused'))
    }
    // A refused lock (some embeds, some browsers) still lets the visitor walk — the mouse
    // drags the view instead
    const onLockError = () => sceneRef.current?.setPaused(false)
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onLockError)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onLockError)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [isTouch])

  const enterRoom = () => {
    setOverlay(null)
    if (isTouch) {
      sceneRef.current?.setPaused(false)
      toast('Left side of the room: walk · right side: look · tap a piece to read it')
      return
    }
    const canvas = canvasRef.current
    if (!canvas?.requestPointerLock) {
      sceneRef.current?.setPaused(false)
      return
    }
    const request = canvas.requestPointerLock()
    if (request?.catch) request.catch(() => sceneRef.current?.setPaused(false))
  }

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    if (document.fullscreenElement === root) document.exitFullscreen?.()
    else root.requestFullscreen?.()
  }, [])

  // Buying from inside the room: the label carries the market's own quick-buy button. With
  // the mouse captured nothing can be clicked, so B lets go of it and presses that button —
  // the key press is the gesture the wallet needs
  const buyHovered = useCallback(() => {
    const button = buyRef.current?.querySelector('button')
    if (!button) return
    if (document.pointerLockElement === canvasRef.current) document.exitPointerLock?.()
    button.click()
  }, [])

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return
      if (event.code === 'KeyF') toggleFullscreen()
      if (event.code === 'KeyB' && !overlay) buyHovered()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlay, toggleFullscreen, buyHovered])

  // --- Mouse: click walks in, or opens what the crosshair is on; drag looks when unlocked ---
  const dragRef = useRef(null)
  const handleMouseDown = (event) => {
    if (isTouch || locked) return
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false }
  }
  const handleMouseMove = (event) => {
    if (isTouch || locked || !dragRef.current || event.buttons !== 1) return
    const drag = dragRef.current
    sceneRef.current?.look(event.clientX - drag.x, event.clientY - drag.y, 0.0045)
    drag.x = event.clientX
    drag.y = event.clientY
    drag.moved = true
  }
  const handleClick = () => {
    if (isTouch) return
    const scene = sceneRef.current
    if (locked) {
      if (scene && scene.hovered >= 0) handlersRef.current.onOpen(scene.hovered)
      return
    }
    const drag = dragRef.current
    dragRef.current = null
    if (overlay) return
    if (drag?.moved) return
    if (scene && scene.hovered >= 0) handlersRef.current.onOpen(scene.hovered)
    else enterRoom()
  }

  // --- Touch: left half is a joystick, right half looks, a still tap reads a piece ---
  const touchRef = useRef({ joy: null, look: null })
  const handlePointerDown = (event) => {
    if (event.pointerType !== 'touch' || overlay) return
    const touch = touchRef.current
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.clientX - rect.left < rect.width / 2 && touch.joy === null) {
      touch.joy = { id: event.pointerId, ox: event.clientX, oy: event.clientY }
      const joy = joyRef.current
      if (joy) {
        joy.hidden = false
        joy.style.left = `${event.clientX - rect.left}px`
        joy.style.top = `${event.clientY - rect.top}px`
      }
      if (joyKnobRef.current) joyKnobRef.current.style.transform = 'translate(0, 0)'
    } else if (touch.look === null) {
      touch.look = { id: event.pointerId, x: event.clientX, y: event.clientY, sx: event.clientX, sy: event.clientY, t: performance.now(), moved: false }
    }
  }
  const handlePointerMove = (event) => {
    if (event.pointerType !== 'touch') return
    const touch = touchRef.current
    if (touch.joy && event.pointerId === touch.joy.id) {
      let dx = event.clientX - touch.joy.ox
      let dy = event.clientY - touch.joy.oy
      const len = Math.hypot(dx, dy)
      if (len > JOY_RADIUS) {
        dx *= JOY_RADIUS / len
        dy *= JOY_RADIUS / len
      }
      if (joyKnobRef.current) joyKnobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
      sceneRef.current?.setJoystick(dx / JOY_RADIUS, -dy / JOY_RADIUS)
    } else if (touch.look && event.pointerId === touch.look.id) {
      sceneRef.current?.look(event.clientX - touch.look.x, event.clientY - touch.look.y)
      touch.look.x = event.clientX
      touch.look.y = event.clientY
      if (Math.hypot(event.clientX - touch.look.sx, event.clientY - touch.look.sy) > 10) touch.look.moved = true
    }
  }
  const handlePointerUp = (event) => {
    if (event.pointerType !== 'touch') return
    const touch = touchRef.current
    if (touch.joy && event.pointerId === touch.joy.id) {
      touch.joy = null
      sceneRef.current?.setJoystick(0, 0)
      if (joyRef.current) joyRef.current.hidden = true
    } else if (touch.look && event.pointerId === touch.look.id) {
      const look = touch.look
      touch.look = null
      if (!look.moved && performance.now() - look.t < 400) {
        const rect = event.currentTarget.getBoundingClientRect()
        const nx = ((look.sx - rect.left) / rect.width) * 2 - 1
        const ny = -((look.sy - rect.top) / rect.height) * 2 + 1
        const scene = sceneRef.current
        if (scene) scene.select(scene.pickAt(nx, ny, 9))
      }
    }
  }

  const hoveredPiece = hovered >= 0 ? pieces[hovered] : null
  const firstIndex = room * PER_ROOM + 1
  const lastIndex = Math.min(room * PER_ROOM + PER_ROOM, feedLength)
  const isEmpty = !isLoading && listings.length === 0 && collectionEmpty
  const isCovered = status === 'error' || isEmpty || Boolean(overlay)
  const counter = feedLength > 0
    ? wing === 'sale'
      ? `Room ${room + 1} · for sale ${count.format(firstIndex)}–${count.format(lastIndex)}`
      : `Collection room ${room + 1} · pieces ${count.format(firstIndex)}–${count.format(lastIndex)}${collectionTotal ? ` of ${count.format(collectionTotal)}` : ''}`
    : 'Hanging the room…'

  return (
    <div className={styles.gallery} style={networkColorStyle(chainInfo)}>
      <div ref={rootRef} className={clsx(styles.gallery__stage, isFullscreen && styles['gallery__stage--fullscreen'])}>
        <canvas
          ref={canvasRef}
          className={clsx(styles.gallery__canvas, isCovered && styles['gallery__canvas--dimmed'])}
          tabIndex={0}
          aria-label={`${collectionName || 'Collection'} as a gallery you can walk through`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        <div className={styles.gallery__hud}>
          <div className={styles.gallery__counter}>
            <strong>{collectionName || 'Collection'}</strong>
            <span>{counter}</span>
          </div>

          <button type="button" className={styles.gallery__fullscreen} onClick={toggleFullscreen} title="F">
            {isFullscreen ? <CornersInIcon size={16} /> : <CornersOutIcon size={16} />}
            <span>{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
          </button>

          {!isTouch && !overlay && <div className={clsx(styles.gallery__crosshair, hovered >= 0 && styles['gallery__crosshair--hot'])} />}

          {!isTouch && (
            <aside className={styles.gallery__legend}>
              <div>
                <span className={styles.gallery__keys}>
                  <kbd>W</kbd>
                  <kbd>A</kbd>
                  <kbd>S</kbd>
                  <kbd>D</kbd>
                </span>
                walk
              </div>
              <div>
                <span className={styles.gallery__keys}>
                  <kbd>Click</kbd>
                </span>
                open the piece you&apos;re looking at
              </div>
              <div>
                <span className={styles.gallery__keys}>
                  <kbd>B</kbd>
                </span>
                buy it
              </div>
              <div>
                <span className={styles.gallery__keys}>
                  <kbd>F</kbd>
                </span>
                full screen
              </div>
              <div>
                <span className={styles.gallery__keys}>
                  <kbd>Esc</kbd>
                </span>
                release the mouse
              </div>
            </aside>
          )}

          <canvas ref={mapRef} className={styles.gallery__map} width="336" height="216" aria-hidden="true" />

          {hoveredPiece && (
            <div className={styles.gallery__label}>
              <small>
                {hoveredPiece.pricing ? 'For sale' : 'Not listed'} · #{displayTokenId(hoveredPiece.tokenId)}
              </small>
              <strong>{nameOf(hoveredPiece.tokenId)}</strong>
              <span>{priceOf(hoveredPiece.pricing) || (hoveredPiece.pricing ? 'Listed' : 'Not listed')}</span>
              <div className={styles.gallery__labelActions}>
                {/* Keyed per piece so a walk from one to the next resets the buy's phase */}
                {hoveredPiece.listing && (
                  <div ref={buyRef} className={styles.gallery__buy}>
                    <NftQuickBuy key={hoveredPiece.key} listing={hoveredPiece.listing} variant="inline" />
                  </div>
                )}
                {!locked && (
                  <Link href={hrefOf(hoveredPiece)} className={styles.gallery__open}>
                    {hoveredPiece.listing ? 'Open listing' : 'View token'}
                  </Link>
                )}
              </div>
              {locked && <em>{hoveredPiece.listing ? 'Click to open the listing · B to buy' : 'Click to open the token'}</em>}
            </div>
          )}

          <div ref={joyRef} className={styles.gallery__joy} hidden>
            <div ref={joyKnobRef} className={styles.gallery__joyKnob} />
          </div>
        </div>

        {status === 'error' ? (
          <div className={styles.gallery__overlay}>
            <div className={styles.gallery__card}>
              <strong>The room couldn&apos;t open</strong>
              <p>The 3D renderer didn&apos;t load — check the connection and try again, or browse the grid instead.</p>
            </div>
          </div>
        ) : isEmpty ? (
          <div className={styles.gallery__overlay}>
            <div className={styles.gallery__card}>
              <strong>Nothing to hang yet</strong>
              <p>
                {collectionFeed.mode === 'cache'
                  ? "Nothing is for sale and Hup hasn't seen any tokens from this collection yet — the rooms fill as pieces are listed, traded or browsed."
                  : 'Nothing is for sale and this collection has no tokens yet.'}
              </p>
            </div>
          </div>
        ) : overlay ? (
          <div className={styles.gallery__overlay}>
            <div className={styles.gallery__card}>
              {status === 'loading' ? (
                <Spinner />
              ) : overlay === 'intro' ? (
                <>
                  <strong>Walk the collection</strong>
                  <p>
                    {isTouch
                      ? 'Drag on the left half of the room to walk and the right half to look around. Tap a piece to read its label and buy it. The first rooms hold what is for sale; the doorways beyond lead to the whole collection.'
                      : 'Walk with the keyboard, look with the mouse. Look at a piece to read its label, click to open it, press B to buy it. The first rooms hold what is for sale; the doorways beyond lead to the whole collection.'}
                  </p>
                  <div className={styles.gallery__actions}>
                    <button type="button" className={styles.gallery__enter} onClick={enterRoom}>
                      Enter the gallery
                    </button>
                    <button type="button" className={clsx(styles.gallery__enter, styles['gallery__enter--quiet'])} onClick={toggleFullscreen}>
                      {isFullscreen ? <CornersInIcon size={16} /> : <CornersOutIcon size={16} />}
                      {isFullscreen ? 'Exit full screen' : 'Full screen'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <strong>Paused</strong>
                  <p>The mouse is yours again. Step back in whenever you like.</p>
                  <div className={styles.gallery__actions}>
                    <button type="button" className={styles.gallery__enter} onClick={enterRoom}>
                      Keep walking
                    </button>
                    <button type="button" className={clsx(styles.gallery__enter, styles['gallery__enter--quiet'])} onClick={toggleFullscreen}>
                      {isFullscreen ? <CornersInIcon size={16} /> : <CornersOutIcon size={16} />}
                      {isFullscreen ? 'Exit full screen' : 'Full screen'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {!isLoading && !isEmpty && (
        <p className={styles.gallery__coverage}>
          {listings.length > 0
            ? `${count.format(listings.length)}${hasMore ? '+' : ''} for sale on Hup, ${PER_ROOM} to a room — the doorways beyond the sale rooms lead to the whole collection${collectionTotal ? ` (${count.format(collectionTotal)} pieces)` : ''}.`
            : `Nothing is for sale right now, so the rooms hold the whole collection${collectionTotal ? ` — ${count.format(collectionTotal)} pieces, ${PER_ROOM} to a room` : ''}.`}
        </p>
      )}
    </div>
  )
}
