import Link from 'next/link'
// import { config } from '@/config/wagmi'
import PageTitle from '@/components/PageTitle'
import Shimmer from '@/components/ui/Shimmer'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <PageTitle name={`networks`} />
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`} data-width={`medium`}>
          <div className={`flex flex-column gap-1`}>
            {/* {config.chains &&
              config.chains.map((item, i) => {
                return (
                  <Link key={i} href={`./networks/${item.id}`} className={styles.button}>
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
              })} */}
                      <Link href={`./networks/1/`}>another page</Link>
          </div>
        </div>
      </div>
    </>
  )
}

const NetworksFallback = () => {
  return (
    <>
      {Array.from({ length: 4 }, (_, i) => (
        <ShimmerCard key={i} />
      ))}
    </>
  )
}

const ShimmerCard = () => {
  return (
    <div className={`${styles.shimmer} flex align-items-center justify-content-between`}>
      <div className={`flex align-items-center justify-content-between gap-050`}>
        <Shimmer style={{ borderRadius: `0`, width: `24px`, height: `24px` }} />
        <Shimmer style={{ borderRadius: `20px`, width: `70px`, height: `12px` }} />
      </div>
      <Shimmer style={{ borderRadius: `20px`, width: `90px`, height: `27px` }} />
    </div>
  )
}
