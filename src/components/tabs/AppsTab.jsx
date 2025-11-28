'use client'

import { useState, useEffect } from 'react' // ⬅️ IMPORT HOOKS
import { getApps } from '@/util/api'
import { getActiveChain } from '@/util/communication'
import NoData from '../NoData'
import * as Loading from '@/components/Loading'
import styles from './AppsTab.module.scss'

export default function AppsTab() {
  const [apps, setApps] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const activeChainResult = getActiveChain()

  useEffect(() => {
    async function fetchApps() {
      try {
        const activeChainId = activeChainResult[0]?.id
        if (activeChainId) {
          const fetchedApps = await getApps(activeChainId)
          setApps(fetchedApps)
        } else {
          // Handle case where no chain is active
          setApps([])
        }
      } catch (error) {
        console.error('Error fetching applications:', error)
        // Set apps to an empty array on error to show NoData or handle error state
        setApps([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchApps()
  }, []) // Runs once on mount

  if (isLoading || apps === null) {
    return (
      <div className={styles.tabContent} style={{ padding: '2rem', textAlign: 'center' }}>
        <Loading.Spinner size={24} color={activeChainResult[0]?.primaryColor} />
      </div>
    )
  }

  if (apps[1].length === 0) {
    return (
      <div className={styles.tabContent}>
        <div className={`__container`} data-width={`medium`}>
          <NoData name="apps" />
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.tab} relative`}>
      <div className={`__container ${styles.tab__container}`} data-width={`medium`}>
        <div className={``} style={{ '--data-width': `100px` }} role="list">
          {/* {apps[0].map((item) => (
            <CategoryItem key={item.id || item.name} category={item} styles={styles} />
          ))} */}
          <select name="" id="">
            <option value="">Filter</option>
            {apps[0].map((item) => (
              <option key={item.id || item.name}>{item.name} (0)</option>
            ))}
          </select>
        </div>

        <div className={`grid grid--fill gap-1 mt-10`} style={{ '--data-width': `200px` }} role="list">
          {apps[1].map((item) => (
            <AppItem key={item.id || item.name} app={item} styles={styles} />
          ))}
        </div>
      </div>
    </div>
  )
}

function CategoryItem({ category, styles }) {
  return (
    <div className={`${styles.category} d-f-c gap-050`} role="listitem">
      <small>{category.name}</small>
      <span className={`lable lable-dark`}>0</span>
    </div>
  )
}

function AppItem({ app, styles }) {
  const altText = `${app.name} icon`

  return (
    <div className={styles.app} role="listitem">
      <div className={`${styles.app__body} d-f-c flex-row justify-content-between gap-025`}>
        <div className={`flex flex-row align-items-center justify-content-start gap-050 flex-1`}>
          <div className={styles.app__icon}>
            <img src={`${app.logo}`} alt={altText} />
          </div>
          <small>{app.name}</small>
        </div>

        <a target="_blank" rel="noopener noreferrer" href={`${app.url}`} className={styles.app__link}>
          View
        </a>
      </div>
    </div>
  )
}
