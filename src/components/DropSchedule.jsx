'use client'

import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { formatUnits, zeroAddress } from 'viem'
import clsx from 'clsx'
import { PHASE_STATUS, formatPhaseTime, gateLabel, phaseStatus } from '@/lib/drops'
import styles from './DropSchedule.module.scss'

const countFormat = new Intl.NumberFormat('en')

// LSP7 answers decimals() but keeps its symbol in ERC725Y, so a missing symbol read is normal
const PHASE_TOKEN_ABI = [
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
]

/**
 * Drop Schedule
 * Every phase of a drop, so a collector can see a presale they missed and one still coming.
 * A phase priced in a token quotes in that token's decimals and symbol, not the native coin's.
 * @param {Object} props
 * @param {number} props.chainId Chain the drop lives on.
 * @param {Object} [props.chainInfo] appChains entry, for the native currency.
 * @param {Array} props.phases Phase structs from the engine's phasesOf.
 * @param {string} [props.heading='Mint schedule']
 * @param {string} [props.className] Layout class from the consumer's module.
 */
export default function DropSchedule({ chainId, chainInfo, phases = [], heading = 'Mint schedule', className }) {
  const phaseTokens = useMemo(
    () => [...new Set(phases.filter((phase) => phase.token && phase.token !== zeroAddress).map((phase) => phase.token.toLowerCase()))],
    [phases],
  )
  const { data: phaseTokenReads } = useReadContracts({
    contracts: phaseTokens.flatMap((token) => [
      { address: token, abi: PHASE_TOKEN_ABI, functionName: 'decimals', chainId },
      { address: token, abi: PHASE_TOKEN_ABI, functionName: 'symbol', chainId },
    ]),
    query: { enabled: phaseTokens.length > 0 },
  })
  const phaseTokenMeta = useMemo(
    () =>
      Object.fromEntries(
        phaseTokens.map((token, index) => [
          token,
          { decimals: Number(phaseTokenReads?.[index * 2]?.result ?? 18), symbol: phaseTokenReads?.[index * 2 + 1]?.result || 'tokens' },
        ]),
      ),
    [phaseTokens, phaseTokenReads],
  )

  if (phases.length === 0) return null

  const nativeDecimals = chainInfo?.nativeCurrency?.decimals ?? 18
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? ''

  return (
    <section className={clsx(styles.schedule, className)}>
      <h2>{heading}</h2>
      <ol>
        {phases.map((phase, index) => {
          const status = phaseStatus(phase)
          const priced = phase.price > 0n
          const tokenMeta = phase.token && phase.token !== zeroAddress ? phaseTokenMeta[phase.token.toLowerCase()] : null
          const reserved = Number(phase.allocation ?? 0)
          return (
            <li key={index} className={clsx(status === PHASE_STATUS.LIVE && styles['schedule__stage--live'])}>
              <div className={styles.schedule__stageHead}>
                <strong>{phase.name?.trim() || `Phase ${index + 1}`}</strong>
                {status === PHASE_STATUS.LIVE && <em>Live</em>}
              </div>
              <small>
                {priced ? `${formatUnits(phase.price, tokenMeta?.decimals ?? nativeDecimals)} ${tokenMeta ? tokenMeta.symbol : nativeSymbol}` : 'Free'}
                {' · '}
                {Number(phase.perWallet) === 0 ? 'Unlimited per wallet' : `${countFormat.format(Number(phase.perWallet))} per wallet`}
                {' · '}
                {gateLabel(Number(phase.gate))}
                {reserved > 0 ? ` · ${countFormat.format(reserved)} reserved` : ''}
              </small>
              <small className={styles.schedule__stageWhen}>
                {status === PHASE_STATUS.ENDED
                  ? `Ended ${formatPhaseTime(phase.endTime)}`
                  : status === PHASE_STATUS.PAUSED
                    ? 'Paused by the creator'
                    : status === PHASE_STATUS.UPCOMING
                      ? `Starts ${formatPhaseTime(phase.startTime)}`
                      : phase.endTime && Number(phase.endTime) > 0
                        ? `Open until ${formatPhaseTime(phase.endTime)}`
                        : 'Open — no end date'}
              </small>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
