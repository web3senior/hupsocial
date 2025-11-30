import Link from 'next/link'
import PageTitle from '@/components/PageTitle'
import { config } from '@/config/wagmi'
import {slugify} from '@/lib/utils'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`networks`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          <div className={`flex flex-column gap-1`}>
            {config.chains &&
              config.chains.map((item, i) => {
                return (
                  <Link key={i} href={`./networks/${item.id}/${slugify(item.name)}`} className={styles.button}>
                    <div className={`${styles.network}`} title={`View details`}>
                      <div className={`${styles.network__body} d-f-c flex-row justify-content-between gap-025`}>
                        <div className={`flex flex-row align-items-center justify-content-start gap-050 flex-1`}>
                          <div className={`${styles.network__icon}`} dangerouslySetInnerHTML={{ __html: item.icon }} />
                          <span>{item.name}</span>
                        </div>
                        <small>View</small>
                      </div>
                    </div>
                  </Link>
                )
              })}
          </div>
        </div>
      </div>
    </>
  )
}