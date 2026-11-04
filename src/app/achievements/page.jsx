import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import AchievementCatalog from './_components/AchievementCatalog'
import styles from './page.module.scss'

export const metadata = {
  title: 'Achievements',
  description: 'Permanent marks earned through your activity and contributions to Hup. Explore every achievement and its rarity.',
  alternates: { canonical: '/achievements' },
}

export default function Page() {
  return (
    <>
      <PageTitle name="Achievements" />
      <div className={clsx(styles.page, 'animate fade')}>
        <div className={clsx('__container', styles.page__container)} data-width="medium">
          <AchievementCatalog />
        </div>
      </div>
    </>
  )
}
