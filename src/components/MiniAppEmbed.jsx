'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useConnection, usePublicClient, useSendTransaction, useSignMessage, useSignTypedData, useSwitchChain } from 'wagmi'
import { config } from '@/config/wagmi'
import { appChains, SESSION_CALL_ALLOWLIST } from '@/config/contracts'
import { createMiniAppBridge, pushSessionUpdate } from '@/lib/miniAppBridge'
import { createUpProviderBridge } from '@/lib/upProviderBridge'
import { sendRawWithBurnerSession, unlockBurnerWithMaster } from '@/lib/burnerSession'
import { clearMasterSecret, unlockMaster } from '@/lib/securityVault'
import { ArrowClockwiseIcon, ArrowSquareOutIcon, CornersInIcon, CornersOutIcon, PlayIcon, PuzzlePieceIcon, WarningIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import MiniAppTxDialog from './MiniAppTxDialog'
import MiniAppSessionDialog from './MiniAppSessionDialog'
import MiniAppVaultUnlockDialog from './MiniAppVaultUnlockDialog'
import styles from './MiniAppEmbed.module.scss'

const STORAGE_PREFIX = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''

// hup_sessionCall budget per embed: enough for aggressive gameplay, useless for spam.
const SESSION_CALL_WINDOW_MS = 60_000
const SESSION_CALL_MAX_PER_WINDOW = 10

const fetcher = async (url) => {
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || 'App unavailable')
  return json.data
}

/**
 * Renders a registered mini app inside a post.
 *
 * The frame is sandboxed WITHOUT allow-same-origin, so it gets an opaque origin and cannot reach
 * Hup's cookies, storage, or DOM. That also means no wallet extension will inject into it — which
 * is the point: the app talks to the viewer's wallet only through the host bridge, where every
 * signature is confirmed in Hup's own UI.
 *
 * Nothing loads until the viewer presses play. A post should not silently run third-party code
 * (or leak the viewer's IP to it) just by scrolling past.
 *
 * The frame is served two wallet protocols at once: the Hup SDK bridge (which also carries the
 * Farcaster-compatible surface) and the LUKSO up-provider protocol, so Grid mini apps built for
 * universaleverything.io run unmodified. `contextAddress` is the post author's wallet — Grid
 * semantics for "the profile hosting this widget".
 */
export default function MiniAppEmbed({ reference, contextAddress }) {
  const appId = Number(reference?.appId)
  const chainId = Number(reference?.chainId)

  const iframeRef = useRef(null)
  const upBridgeRef = useRef(null)
  const txDialogRef = useRef(null)
  const sessionDialogRef = useRef(null)
  const vaultDialogRef = useRef(null)
  const sessionCallTimesRef = useRef([])
  const containerRef = useRef(null)
  const [isRunning, setIsRunning] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const { address, isConnected, chain: walletChain } = useConnection()
  const publicClient = usePublicClient({ chainId })
  const switchChain = useSwitchChain({ config })
  const { sendTransactionAsync } = useSendTransaction()
  const { signMessageAsync } = useSignMessage()
  const { signTypedDataAsync } = useSignTypedData()

  const valid = Number.isSafeInteger(appId) && Number.isSafeInteger(chainId) && appId > 0 && chainId > 0

  // The endpoint only returns apps that are embeddable, unhidden, and not delisted — a revoked
  // app 404s here and the embed degrades to the unavailable state on the next load.
  const { data: app, error, isLoading } = useSWR(valid ? `/api/v1/apps/${chainId}/${appId}` : null, fetcher)

  const chainInfo = useMemo(() => appChains.find((c) => c.id === chainId), [chainId])

  const session = useRef({ address, chainId: walletChain?.id, isConnected })
  session.current = { address, chainId: walletChain?.id ?? chainId, isConnected }

  const handleSignatureRequest = useCallback(
    async ({ method, params, app: requestingApp }) =>
      txDialogRef.current.confirm({
        method,
        params,
        app: requestingApp,
        address,
        chainId,
        networkName: chainInfo?.name,
        currencySymbol: chainInfo?.nativeCurrency?.symbol,
        // Executed only after the user approves in the dialog
        execute: async () => {
          if (method === 'eth_sendTransaction') {
            const tx = params[0] || {}
            return sendTransactionAsync({
              to: tx.to,
              data: tx.data,
              value: tx.value ? BigInt(tx.value) : undefined,
              gas: tx.gas ? BigInt(tx.gas) : undefined,
              chainId,
            })
          }
          if (method === 'personal_sign') {
            const raw = params[0]
            return signMessageAsync({ message: { raw } })
          }
          const typed = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]
          return signTypedDataAsync(typed)
        },
      }),
    [address, chainId, chainInfo, sendTransactionAsync, signMessageAsync, signTypedDataAsync],
  )

  const handleRead = useCallback(
    async ({ method, params }) => {
      if (!publicClient) throw new Error('No RPC client for this network')
      return publicClient.request({ method, params })
    },
    [publicClient],
  )

  const handleSwitchChain = useCallback(async (target) => switchChain.mutateAsync({ chainId: target }), [switchChain])

  /**
   * hup_sessionCall policy enforcement — the four lines the bridge trusts this handler to hold:
   * host-owned target allowlist, zero value, one-time per-app consent, rate limit. Signing uses
   * the viewer's burner session key and never prompts; a locked vault or missing key surfaces as
   * a coded error the app is expected to handle (see the bridge's SESSION_CALL_METHOD notes).
   */
  const handleSessionCall = useCallback(
    async ({ params }) => {
      const call = params?.[0] || {}
      const to = typeof call.to === 'string' ? call.to.toLowerCase() : ''
      const allowed = (SESSION_CALL_ALLOWLIST[chainId]?.[appId] || []).filter(Boolean).map((a) => String(a).toLowerCase())

      if (!to || !allowed.includes(to)) {
        const err = new Error('This app is not allowed to session-call that contract')
        err.code = 'NOT_ALLOWED'
        throw err
      }

      if (call.value && BigInt(call.value) !== 0n) {
        const err = new Error('Session calls can never carry value')
        err.code = 'NOT_ALLOWED'
        throw err
      }

      if (typeof call.data !== 'string' || !call.data.startsWith('0x')) {
        const err = new Error('Invalid calldata')
        err.code = -32602
        throw err
      }

      const now = Date.now()
      sessionCallTimesRef.current = sessionCallTimesRef.current.filter((t) => now - t < SESSION_CALL_WINDOW_MS)
      if (sessionCallTimesRef.current.length >= SESSION_CALL_MAX_PER_WINDOW) {
        const err = new Error('Too many session calls — try again in a minute')
        err.code = -32005
        throw err
      }

      const consentKey = `${STORAGE_PREFIX}miniapp_session_consent_${chainId}_${appId}`
      if (localStorage.getItem(consentKey) !== 'granted') {
        // Rejects with code 4001 on decline, which aborts the call before anything signs
        await sessionDialogRef.current.confirm({ app, to: call.to })
        localStorage.setItem(consentKey, 'granted')
      }

      sessionCallTimesRef.current.push(now)

      const sendCall = () => sendRawWithBurnerSession({ chain: chainInfo, to: call.to, data: call.data })

      try {
        return await sendCall()
      } catch (err) {
        if (err?.code !== 'VAULT_LOCKED') throw err

        // The vault PIN is never asked on a frame's behalf silently — but the host may ask in
        // its own UI. One PIN + one signature here unlocks the whole tab, then retry once.
        await vaultDialogRef.current.unlock({
          app,
          execute: async (pin) => {
            if (!address) throw new Error('Connect your wallet first')
            const masterHex = await unlockMaster(address, pin, signMessageAsync)
            try {
              await unlockBurnerWithMaster(masterHex)
            } catch (unlockErr) {
              // A wrong PIN yields a wrong master — drop it from the cache or every later
              // vault feature in this tab would silently use the bad one
              if (unlockErr?.code === 'WRONG_PIN') clearMasterSecret()
              throw unlockErr
            }
          },
        })

        return sendCall()
      }
    },
    [app, appId, chainId, chainInfo, address, signMessageAsync],
  )

  // Attach both bridges for as long as the frame is mounted — same iframe, same policy handlers,
  // two wire protocols (messages are discriminated by shape, so they never collide)
  useEffect(() => {
    if (!isRunning || !app || !iframeRef.current) return

    const shared = {
      iframe: iframeRef.current,
      app,
      getSession: () => session.current,
      onSignatureRequest: handleSignatureRequest,
      onRead: handleRead,
      onSwitchChain: handleSwitchChain,
      onSessionCall: handleSessionCall,
    }

    const detachHup = createMiniAppBridge(shared)
    const upBridge = createUpProviderBridge({
      ...shared,
      chainId,
      rpcUrls: [...(chainInfo?.rpcUrls?.default?.http ?? [])],
      contextAccounts: contextAddress ? [contextAddress] : [],
    })
    upBridgeRef.current = upBridge

    return () => {
      detachHup()
      upBridge.detach()
      upBridgeRef.current = null
    }
  }, [isRunning, app, reloadKey, chainId, chainInfo, contextAddress, handleSignatureRequest, handleRead, handleSwitchChain, handleSessionCall])

  // Let a running app react to the viewer connecting or switching networks
  useEffect(() => {
    if (!isRunning || !iframeRef.current) return
    pushSessionUpdate(iframeRef.current, session.current)
    upBridgeRef.current?.pushSession(session.current)
  }, [isRunning, address, isConnected, walletChain?.id])

  // Track fullscreen from the document, not from the click — Esc and the browser's own controls
  // exit without telling us, and the button label would otherwise go stale
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // iPhone Safari implements the Fullscreen API for <video> only, so requestFullscreen is absent
  // on ordinary elements. Without this the button renders and silently does nothing.
  const [canFullscreen, setCanFullscreen] = useState(false)
  useEffect(() => {
    setCanFullscreen(typeof document !== 'undefined' && document.fullscreenEnabled === true)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
      return
    }
    // The whole card goes fullscreen, not just the frame, so the exit control stays reachable
    containerRef.current?.requestFullscreen?.().catch(() => {
      /* denied or unsupported — the inline embed keeps working */
    })
  }

  if (!valid) return null

  const [ratioW, ratioH] = (app?.aspectRatio || '1:1').split(':').map(Number)
  const aspectRatio = ratioW > 0 && ratioH > 0 ? `${ratioW} / ${ratioH}` : '1 / 1'

  if (isLoading) return <div className={clsx(styles.embed, styles['embed--skeleton'])} />

  if (error || !app) {
    return (
      <div className={clsx(styles.embed, styles['embed--unavailable'])}>
        <WarningIcon size={16} />
        <span>This mini app is no longer available.</span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={styles.embed} onClick={(e) => e.stopPropagation()}>
      <header className={styles.embed__header}>
        {app.logo ? (
          <img className={styles.embed__logo} src={app.logo} alt="" loading="lazy" />
        ) : (
          <span className={styles.embed__logoFallback} aria-hidden="true">
            <PuzzlePieceIcon size={14} weight="fill" />
          </span>
        )}
        <div className={styles.embed__meta}>
          <strong>{app.name}</strong>
          <small>{app.origin || app.network}</small>
        </div>
        <div className={styles.embed__controls}>
          {isRunning && (
            <>
              <button
                type="button"
                className={styles.embed__control}
                onClick={() => setReloadKey((k) => k + 1)}
                aria-label="Reload mini app"
                title="Reload"
              >
                <ArrowClockwiseIcon size={14} />
              </button>

              {canFullscreen && (
                <button
                  type="button"
                  className={styles.embed__control}
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? <CornersInIcon size={14} /> : <CornersOutIcon size={14} />}
                </button>
              )}
            </>
          )}

          {/* Opening standalone drops the bridge with it, so the app has no wallet out there —
              this is for inspecting the app, not for transacting with it */}
          <a
            className={styles.embed__control}
            href={app.frameUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open mini app in a new tab"
            title="Open in new tab (no wallet connection outside Hup)"
          >
            <ArrowSquareOutIcon size={14} />
          </a>
        </div>
      </header>

      {/* max-width mirrors the stage's max-height through the same ratio, so tall shapes narrow
          instead of getting squashed square by the height cap */}
      <div className={styles.embed__stage} style={{ aspectRatio, maxWidth: `calc(var(--stage-max-h) * ${ratioW} / ${ratioH})` }}>
        {isRunning ? (
          <iframe
            key={reloadKey}
            ref={iframeRef}
            src={app.frameUrl}
            title={app.name}
            className={styles.embed__frame}
            /* allow-same-origin gives the app its OWN origin — not Hup's. Without it the frame
               has an opaque origin, where localStorage/IndexedDB/cookies throw SecurityError and
               crypto.subtle is undefined, which breaks essentially every real dapp. Cross-origin
               policy still keeps it out of Hup's DOM and storage; the resolver refuses any frame
               URL on Hup's own origin, which is the only case this flag would be dangerous. */
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            /* Deny every powerful feature by default — a post embed needs none of them */
            allow="accelerometer 'none'; camera 'none'; geolocation 'none'; gyroscope 'none'; microphone 'none'; payment 'none'; usb 'none'"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <button type="button" className={styles.embed__launch} onClick={() => setIsRunning(true)}>
            <PlayIcon size={20} weight="fill" />
            <span>Launch {app.name}</span>
            <small>Runs third-party code in a sandbox. It cannot act without your approval.</small>
          </button>
        )}
      </div>

      <MiniAppTxDialog ref={txDialogRef} />
      <MiniAppSessionDialog ref={sessionDialogRef} />
      <MiniAppVaultUnlockDialog ref={vaultDialogRef} />
    </div>
  )
}
