'use client'

import { useEffect, useState } from 'react'
import { setPostStoragePreference, usePostStoragePreference } from '@/hooks/usePostStoragePreference'
import styles from './StoragePreference.module.scss'

export default function StoragePreference() {
  const mode = usePostStoragePreference()
  const [available, setAvailable] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/post-storage', { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Unavailable')))
      .then((data) => setAvailable(data.hosted))
      .catch(() => { if (!controller.signal.aborted) setAvailable(false) })
    return () => controller.abort()
  }, [])

  return (
    <section className={styles.storage} aria-labelledby="post-storage-title">
      <header>
        <h4 id="post-storage-title" className={styles.storage__title}>Post storage</h4>
        <p className={styles.storage__hint}>Choose where new posts and new attachments are stored on this browser. Existing posts and uploaded attachments keep their current storage.</p>
      </header>
      <fieldset className={styles.storage__options}>
        <legend className={styles.storage__legend}>Storage mode</legend>
        {[
          { value: 'ipfs', label: 'IPFS', description: 'Public content stored through Filebase on IPFS. Deleting a post unpins our copy; copies kept by other IPFS nodes may remain.' },
          { value: 'hosted', label: 'Hup storage — not on IPFS', description: 'Public content hosted by Hup in conventional storage, outside the IPFS network. Hup can remove its stored copy when you delete a post. Availability depends on Hup’s hosting.' },
        ].map((option) => (
          <label className={styles.storage__option} key={option.value}>
            <input type="radio" name="post-storage" value={option.value} checked={mode === option.value}
              disabled={option.value === 'hosted' && available !== true}
              onChange={() => {
                try { setPostStoragePreference(option.value); setError('') }
                catch { setError('Your browser could not save this preference.') }
              }} />
            <span><strong>{option.label}</strong><span className={styles.storage__hint}>{option.description}</span></span>
          </label>
        ))}
      </fieldset>
      {available === false && <p className={styles.storage__hint}>Hup storage is not available on this deployment yet.</p>}
      <p className={styles.storage__hint}>Both modes publish a reference onchain. Historical references and copies saved by others may remain after deletion. Neither mode makes a public post private.</p>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
