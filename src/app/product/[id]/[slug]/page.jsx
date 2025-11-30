import Link from 'next/link'
import styles from './page.module.scss'

export default async function Page({ params, searchParams }) {
  const slug = (await params).slug
  const id = (await params).id

  return (
    <div className={`${styles.page} ms-motion-slideDownIn`}>
      <div className={`__container`} data-width={`small`}>
        <br />
        <br />
        <br />
        <br />
        <br />
        <br />
        <br />
        <br />
        <br />
        <br />
        <p>{slug}</p>
        <p>{id}</p>
        <p>
          <Link href={`../`}>go back</Link>
        </p>
      </div>
    </div>
  )
}
