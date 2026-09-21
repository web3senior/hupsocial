'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { CalendarDotsIcon, CaretDownIcon, ClockIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import { SCHEDULE_MAX_AHEAD_S, SCHEDULE_MIN_LEAD_S } from '@/lib/scheduleSignature'
import { formatWillSend, localTimeZone, timeZoneLongName } from '@/lib/scheduledPosts'
import styles from './SchedulePostDialog.module.scss'

const MONTHS = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2026, month, 1)),
)
const HOURS = Array.from({ length: 12 }, (_, index) => index + 1)
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute)
const pad2 = (value) => String(value).padStart(2, '0')
const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()

const fieldsFromDate = (date) => ({
  year: date.getFullYear(),
  month: date.getMonth(),
  day: date.getDate(),
  hour: ((date.getHours() + 11) % 12) + 1,
  minute: date.getMinutes(),
  meridiem: date.getHours() >= 12 ? 'PM' : 'AM',
})

const dateFromFields = ({ year, month, day, hour, minute, meridiem }) => {
  const hours24 = meridiem === 'PM' ? (hour % 12) + 12 : hour % 12
  return new Date(year, month, Math.min(day, daysInMonth(year, month)), hours24, minute, 0, 0)
}

// An hour from now, rounded up to the next five minutes — a time that is always valid and
// usually close to what the author meant
const defaultFields = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setSeconds(0, 0)
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5)
  return fieldsFromDate(date)
}

const Field = ({ label, value, onChange, options, className }) => (
  <label className={clsx(styles.field, className)}>
    <span className={styles.field__label}>{label}</span>
    <select className={styles.field__select} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    <CaretDownIcon size={18} className={styles.field__caret} />
  </label>
)

/**
 * Schedule Post Dialog
 * Picks when a post goes out: a date, a time, and the zone both are read in — the viewer's
 * own, named so there is no doubt which "2:01 AM" was meant. The composer keeps the result
 * as unix seconds and shows it in its header; Confirm here never publishes anything.
 * @param {Object} props
 * @param {number|null} props.value The current schedule as unix seconds, or null.
 * @param {(unixSeconds: number, timeZone: string) => void} props.onConfirm
 * @param {() => void} [props.onClear] Drops the schedule so the post goes out on Post.
 */
const SchedulePostDialog = forwardRef(function SchedulePostDialog({ value = null, onConfirm, onClear }, ref) {
  const dialogRef = useRef(null)
  const [fields, setFields] = useState(defaultFields)
  const zone = useMemo(localTimeZone, [])
  const zoneName = useMemo(() => timeZoneLongName(zone), [zone])

  useImperativeHandle(ref, () => ({
    open: () => {
      setFields(value ? fieldsFromDate(new Date(value * 1000)) : defaultFields())
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const unix = Math.floor(dateFromFields(fields).getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)
  const tooSoon = unix < now + SCHEDULE_MIN_LEAD_S
  const tooFar = unix > now + SCHEDULE_MAX_AHEAD_S
  const invalid = tooSoon || tooFar

  const set = (key) => (raw) => setFields((current) => ({ ...current, [key]: key === 'meridiem' ? raw : Number(raw) }))

  const thisYear = new Date().getFullYear()
  const years = [thisYear, thisYear + 1]
  const days = Array.from({ length: daysInMonth(fields.year, fields.month) }, (_, index) => index + 1)

  const confirm = () => {
    if (invalid) return
    onConfirm?.(unix, zone)
    dialogRef.current?.close()
  }

  const clear = () => {
    onClear?.()
    dialogRef.current?.close()
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.schedule}
      aria-label="Schedule post"
      lightDismiss
      onClick={(e) => e.stopPropagation()}
      // Nested inside the composer's own dialog — React re-dispatches close/cancel up the
      // component tree, so both must stop here or closing this also closes the composer
      onClose={(e) => e.stopPropagation()}
      onCancel={(e) => e.stopPropagation()}
    >
      <div className={styles.schedule__body}>
        <header className={styles.schedule__header}>
          <button type="button" className={styles.schedule__close} onClick={() => dialogRef.current?.close()} aria-label="Close">
            <XIcon size={20} />
          </button>
          <h3>Schedule</h3>
          <button type="button" className={styles.schedule__confirm} onClick={confirm} disabled={invalid}>
            Confirm
          </button>
        </header>

        <p className={clsx(styles.schedule__summary, { [styles['schedule__summary--invalid']]: invalid })} aria-live="polite">
          <CalendarDotsIcon size={18} />
          <span>{tooSoon ? 'Pick a time at least a minute from now' : tooFar ? 'Posts can be scheduled up to a year ahead' : `Will send on ${formatWillSend(unix)}`}</span>
        </p>

        <section>
          <h4 className={styles.schedule__label}>Date</h4>
          <div className={styles.schedule__row}>
            <Field
              label="Month"
              className={styles['field--wide']}
              value={fields.month}
              onChange={set('month')}
              options={MONTHS.map((name, month) => ({ value: month, label: name }))}
            />
            <Field label="Day" value={Math.min(fields.day, days.length)} onChange={set('day')} options={days.map((day) => ({ value: day, label: day }))} />
            <Field label="Year" value={fields.year} onChange={set('year')} options={years.map((year) => ({ value: year, label: year }))} />
            <CalendarDotsIcon size={22} className={styles.schedule__glyph} aria-hidden="true" />
          </div>
        </section>

        <section>
          <h4 className={styles.schedule__label}>Time</h4>
          <div className={styles.schedule__row}>
            <Field label="Hour" value={fields.hour} onChange={set('hour')} options={HOURS.map((hour) => ({ value: hour, label: hour }))} />
            <Field label="Minute" value={fields.minute} onChange={set('minute')} options={MINUTES.map((minute) => ({ value: minute, label: pad2(minute) }))} />
            <Field
              label="AM/PM"
              value={fields.meridiem}
              onChange={set('meridiem')}
              options={[
                { value: 'AM', label: 'AM' },
                { value: 'PM', label: 'PM' },
              ]}
            />
            <ClockIcon size={22} className={styles.schedule__glyph} aria-hidden="true" />
          </div>
        </section>

        <section>
          <h4 className={styles.schedule__label}>Time zone</h4>
          <p className={styles.schedule__zone}>{zoneName}</p>
        </section>

        <footer className={styles.schedule__footer}>
          <Link href="/scheduled" onClick={() => dialogRef.current?.close()}>
            Scheduled posts
          </Link>
          {value && (
            <button type="button" className={styles.schedule__clear} onClick={clear}>
              Remove schedule
            </button>
          )}
        </footer>
      </div>
    </NativeDialog>
  )
})

export default SchedulePostDialog
