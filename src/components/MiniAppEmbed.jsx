'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useConnection, usePublicClient, useSendTransaction, useSignMessage, useSignTypedData, useSwitchChain } from 'wagmi'
import { config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { createMiniAppBridge, pushSessionUpdate } from '@/lib/miniAppBridge'
import { ArrowClockwiseIcon, ArrowSquareOutIcon, CornersInIcon, CornersOutIcon, PlayIcon, PuzzlePieceIcon, WarningIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import MiniAppTxDialog from './MiniAppTxDialog'
import styles from './MiniAppEmbed.module.scss'

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
 */
export default function MiniAppEmbed({ reference }) {
  const appId = Number(reference?.appId)
  const chainId = Number(reference?.chainId)

  const iframeRef = useRef(null)
  const txDialogRef = useRef(null)
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

  // Attach the bridge for as long as the frame is mounted
  useEffect(() => {
    if (!isRunning || !app || !iframeRef.current) return

    const detach = createMiniAppBridge({
      iframe: iframeRef.current,
      app,
      getSession: () => session.current,
      onSignatureRequest: handleSignatureRequest,
      onRead: handleRead,
      onSwitchChain: handleSwitchChain,
    })

    return detach
  }, [isRunning, app, reloadKey, handleSignatureRequest, handleRead, handleSwitchChain])

  // Let a running app react to the viewer connecting or switching networks
  useEffect(() => {
    if (!isRunning || !iframeRef.current) return
    pushSessionUpdate(iframeRef.current, session.current)
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
    </div>
  )
}
