'use client'

import clsx from 'clsx'
import { CalendarBlankIcon, ClockIcon, HandTapIcon, LightningIcon, WarningIcon } from '@phosphor-icons/react'
import {
  DROP_END_MODES,
  DROP_START_MODES,
  DURATION_PRESETS,
  DURATION_UNITS,
  emptySchedule,
  formatDuration,
  formatPhaseTime,
  resolveSchedule,
  scheduleErrorMessage,
} from '@/lib/drops'
import styles from './DropWhenPicker.module.scss'

const DurationInput = ({ label, amount, unit, onChange, disabled }) => (
  <span className={styles.whenPicker__duration}>
    <input
      type="number"
      min="1"
      step="1"
      inputMode="numeric"
      value={amount}
      placeholder="0"
      aria-label={`${label}, how many`}
      style={{ '--duration-len': String(amount || '').length || 1 }}
      onChange={(event) => onChange({ amount: event.target.value })}
      disabled={disabled}
    />
    <select value={unit} aria-label={`${label}, unit`} onChange={(event) => onChange({ unit: event.target.value })} disabled={disabled}>
      {DURATION_UNITS.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.label}
        </option>
      ))}
    </select>
  </span>
)

/**
 * Drop When Picker
 * The one "when does this phase run" control — the create form and the manage panel's add-phase
 * form both render it, so the two can never drift apart.
 *
 * Creators answer in the units they think in (right away, in 2 hours, runs 7 days); the resolved
 * clock time is echoed under each row so nothing about the schedule stays implicit.
 *
 * @param {Object} props.value Form schedule, from `emptySchedule()`.
 * @param {Function} props.onChange Receives the whole next schedule.
 */
export default function DropWhenPicker({ value, onChange, disabled, className }) {
  const schedule = { ...emptySchedule(), ...(value ?? {}) }
  const patch = (next) => onChange({ ...schedule, ...next })
  const { startTime, endTime, error, errorField } = resolveSchedule(schedule)

  const warning = (field) =>
    error && errorField === field ? (
      <small className={clsx(styles.whenPicker__caption, styles['whenPicker__caption--warn'])}>
        <WarningIcon size={13} weight="fill" />
        {scheduleErrorMessage(error)}
      </small>
    ) : null

  const isPresetLength = (preset) =>
    schedule.endMode === DROP_END_MODES.AFTER && schedule.runFor === preset.amount && schedule.runForUnit === preset.unit
  const isCustomLength = schedule.endMode === DROP_END_MODES.AFTER && !DURATION_PRESETS.some(isPresetLength)

  const startCaption =
    schedule.startMode === DROP_START_MODES.MANUAL
      ? 'Sits paused until you press Start on the manage panel.'
      : schedule.startMode === DROP_START_MODES.NOW
        ? 'The moment the drop is created.'
        : formatPhaseTime(startTime)
          ? `Opens ${formatPhaseTime(startTime)}`
          : null

  const endCaption =
    schedule.endMode === DROP_END_MODES.NEVER
      ? 'Runs until the supply is gone.'
      : formatPhaseTime(endTime)
        ? `Ends ${formatPhaseTime(endTime)}${
            schedule.endMode === DROP_END_MODES.AFTER && schedule.startMode === DROP_START_MODES.MANUAL ? ' — the length counts from creation' : ''
          }`
        : null

  return (
    <div className={clsx(styles.whenPicker, className)}>
      <div className={styles.whenPicker__row}>
        <span className={styles.whenPicker__label}>Opens</span>
        <div className={styles.whenPicker__grid}>
          <button
            type="button"
            className={clsx(styles.whenPicker__option, schedule.startMode === DROP_START_MODES.NOW && styles['whenPicker__option--active'])}
            onClick={() => patch({ startMode: DROP_START_MODES.NOW })}
            disabled={disabled}
          >
            <LightningIcon size={13} />
            Right away
          </button>
          <button
            type="button"
            className={clsx(styles.whenPicker__option, schedule.startMode === DROP_START_MODES.IN && styles['whenPicker__option--active'])}
            onClick={() => patch({ startMode: DROP_START_MODES.IN })}
            disabled={disabled}
          >
            <ClockIcon size={13} />
            In…
          </button>
          <button
            type="button"
            className={clsx(styles.whenPicker__option, schedule.startMode === DROP_START_MODES.AT && styles['whenPicker__option--active'])}
            onClick={() => patch({ startMode: DROP_START_MODES.AT })}
            disabled={disabled}
          >
            <CalendarBlankIcon size={13} />
            On a date
          </button>
          <button
            type="button"
            className={clsx(styles.whenPicker__option, schedule.startMode === DROP_START_MODES.MANUAL && styles['whenPicker__option--active'])}
            onClick={() => patch({ startMode: DROP_START_MODES.MANUAL })}
            disabled={disabled}
          >
            <HandTapIcon size={13} />
            Manually
          </button>
        </div>

        {schedule.startMode === DROP_START_MODES.IN && (
          <div className={styles.whenPicker__detail}>
            <DurationInput
              label="Opens in"
              amount={schedule.startIn}
              unit={schedule.startInUnit}
              disabled={disabled}
              onChange={({ amount, unit }) => patch({ startIn: amount ?? schedule.startIn, startInUnit: unit ?? schedule.startInUnit })}
            />
            <span className={styles.whenPicker__from}>from now</span>
          </div>
        )}

        {schedule.startMode === DROP_START_MODES.AT && (
          <div className={styles.whenPicker__detail}>
            <input
              type="datetime-local"
              className={styles.whenPicker__date}
              value={schedule.startAt}
              aria-label="Opens on"
              onChange={(event) => patch({ startAt: event.target.value })}
              disabled={disabled}
            />
          </div>
        )}

        {warning('start') ?? (startCaption && <small className={styles.whenPicker__caption}>{startCaption}</small>)}
      </div>

      <div className={styles.whenPicker__row}>
        <span className={styles.whenPicker__label}>Runs for</span>
        <div className={styles.whenPicker__grid}>
          <button
            type="button"
            className={clsx(styles.whenPicker__option, schedule.endMode === DROP_END_MODES.NEVER && styles['whenPicker__option--active'])}
            onClick={() => patch({ endMode: DROP_END_MODES.NEVER })}
            disabled={disabled}
          >
            No end
          </button>
          {DURATION_PRESETS.map((preset) => (
            <button
              key={`${preset.amount}${preset.unit}`}
              type="button"
              className={clsx(styles.whenPicker__option, isPresetLength(preset) && styles['whenPicker__option--active'])}
              onClick={() => patch({ endMode: DROP_END_MODES.AFTER, runFor: preset.amount, runForUnit: preset.unit })}
              disabled={disabled}
            >
              {formatDuration(preset.amount, preset.unit)}
            </button>
          ))}
          <button
            type="button"
            className={clsx(styles.whenPicker__option, isCustomLength && styles['whenPicker__option--active'])}
            onClick={() => patch({ endMode: DROP_END_MODES.AFTER, runFor: '', runForUnit: 'days' })}
            disabled={disabled}
          >
            Custom
          </button>
          <button
            type="button"
            className={clsx(styles.whenPicker__option, schedule.endMode === DROP_END_MODES.AT && styles['whenPicker__option--active'])}
            onClick={() => patch({ endMode: DROP_END_MODES.AT })}
            disabled={disabled}
          >
            Until a date
          </button>
        </div>

        {isCustomLength && (
          <div className={styles.whenPicker__detail}>
            <DurationInput
              label="Runs for"
              amount={schedule.runFor}
              unit={schedule.runForUnit}
              disabled={disabled}
              onChange={({ amount, unit }) => patch({ runFor: amount ?? schedule.runFor, runForUnit: unit ?? schedule.runForUnit })}
            />
          </div>
        )}

        {schedule.endMode === DROP_END_MODES.AT && (
          <div className={styles.whenPicker__detail}>
            <input
              type="datetime-local"
              className={styles.whenPicker__date}
              value={schedule.endAt}
              aria-label="Closes on"
              onChange={(event) => patch({ endAt: event.target.value })}
              disabled={disabled}
            />
          </div>
        )}

        {warning('end') ?? (!error && endCaption && <small className={styles.whenPicker__caption}>{endCaption}</small>)}
      </div>
    </div>
  )
}
