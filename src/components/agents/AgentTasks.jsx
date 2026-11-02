'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { PlayIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import ToggleSwitch from '@/components/ui/ToggleSwitch'
import { ContentSpinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { createAgentTask, deleteAgentTask, fetchTasks, runAgentTask, updateAgentTask } from '@/lib/agentWallet'
import styles from './AgentTasks.module.scss'

const SCHEDULES = [
  { value: 'manual', label: 'When I run it' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
]

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "in 3 hours" / "5 minutes ago", through Intl so it reads in the owner's language. */
const whenText = (iso) => {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60000)
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute')
  if (Math.abs(minutes) < 60 * 36) return relativeTime.format(Math.round(minutes / 60), 'hour')
  return relativeTime.format(Math.round(minutes / 1440), 'day')
}

/**
 * The tasks an owner gives one agent: standing instructions run on demand or on a schedule. Each
 * run is charged to the agent's credits; its report and drafts land in the agent's chat.
 */
export default function AgentTasks({ token, agent, onRan }) {
  const [tasks, setTasks] = useState(null)
  const [isAdding, setIsAdding] = useState(false)
  const [runningId, setRunningId] = useState(null)

  useEffect(() => {
    let live = true
    fetchTasks(token, agent.address)
      .then((list) => live && setTasks(list))
      .catch((error) => {
        if (!live) return
        setTasks([])
        toast(error.message, 'error')
      })
    return () => {
      live = false
    }
  }, [token, agent.address])

  const replace = (task) => setTasks((current) => current.map((item) => (item.id === task.id ? task : item)))

  const toggle = async (task) => {
    try {
      replace(await updateAgentTask(token, agent.address, task.id, { enabled: !task.enabled }))
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  const remove = async (task) => {
    try {
      await deleteAgentTask(token, agent.address, task.id)
      setTasks((current) => current.filter((item) => item.id !== task.id))
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  const run = async (task) => {
    setRunningId(task.id)
    try {
      const result = await runAgentTask(token, agent.address, task.id)
      toast(result.proposals ? `${task.title}: done, with ${result.proposals} draft${result.proposals === 1 ? '' : 's'} to approve in chat` : `${task.title}: done, see the chat`, 'success')
      // Opens the run in chat, where its report and drafts are
      onRan?.(result.sessionId)
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setRunningId(null)
    }
  }

  if (tasks === null) return <ContentSpinner />

  return (
    <div className={styles.tasks}>
      {tasks.length === 0 && !isAdding && (
        <p className={styles.tasks__empty}>
          Give {agent.name} a job, like &ldquo;each morning, draft a short recap of what&rsquo;s trending&rdquo;. It runs on its own credits and
          leaves drafts in chat for you to approve.
        </p>
      )}

      {tasks.length > 0 && (
        <ul className={styles.tasks__list}>
          {tasks.map((task) => (
            <li key={task.id} className={clsx(styles.task, !task.enabled && styles['task--off'])}>
              <div className={styles.task__head}>
                <strong className={styles.task__title}>{task.title}</strong>
                <ToggleSwitch checked={task.enabled} onChange={() => toggle(task)} aria-label={`${task.title} on`} />
              </div>
              <p className={styles.task__instructions}>{task.instructions}</p>
              <div className={styles.task__foot}>
                <span className={styles.task__meta}>
                  {SCHEDULES.find((item) => item.value === task.schedule)?.label}
                  {task.enabled && task.nextRunAt && ` · next ${whenText(task.nextRunAt)}`}
                  {task.lastRunAt && ` · last ${whenText(task.lastRunAt)}`}
                </span>
                <div className={styles.task__actions}>
                  <button type="button" className={styles.task__icon} onClick={() => remove(task)} disabled={runningId === task.id} aria-label={`Delete ${task.title}`}>
                    <TrashIcon size={14} />
                  </button>
                  <button type="button" className={styles.task__run} onClick={() => run(task)} disabled={runningId !== null || agent.paused}>
                    {runningId === task.id ? <ContentSpinner size={14} /> : <PlayIcon size={14} />} Run now
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {isAdding ? (
        <TaskForm
          token={token}
          agent={agent}
          onCancel={() => setIsAdding(false)}
          onCreated={(task) => {
            setTasks((current) => [...current, task])
            setIsAdding(false)
          }}
        />
      ) : (
        <button type="button" className={styles.tasks__add} onClick={() => setIsAdding(true)}>
          <PlusIcon size={14} /> New task
        </button>
      )}
    </div>
  )
}

function TaskForm({ token, agent, onCancel, onCreated }) {
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [schedule, setSchedule] = useState('daily')
  const [isSaving, setIsSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    try {
      onCreated(await createAgentTask(token, agent.address, { title: title.trim(), instructions: instructions.trim(), schedule }))
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <input className={styles.form__input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Morning recap" required disabled={isSaving} />
      <textarea
        className={styles.form__input}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Read what's trending on Hup and draft one short post about the most interesting thing."
        required
        disabled={isSaving}
      />
      <div className={styles.form__row}>
        <select className={styles.form__input} value={schedule} onChange={(e) => setSchedule(e.target.value)} disabled={isSaving} aria-label="Schedule">
          {SCHEDULES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <button type="button" className={styles.form__cancel} onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
        <button type="submit" className={styles.form__save} disabled={isSaving || !title.trim() || !instructions.trim()}>
          {isSaving ? 'Saving…' : 'Save task'}
        </button>
      </div>
    </form>
  )
}
