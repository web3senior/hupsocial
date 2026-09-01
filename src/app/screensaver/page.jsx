import PageTitle from '@/components/PageTitle'
import ScreensaverGallery from './_components/ScreensaverGallery'
import styles from './page.module.scss'

export const metadata = {
  title: 'Screensaver',
  description: 'Ambient galaxy scenes — pick one and go fullscreen.',
}

export default function ScreensaverPage() {
  return (
    <>
      <PageTitle name="Screensaver" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          <ScreensaverGallery />
        </div>
      </div>
    </>
  )
}
