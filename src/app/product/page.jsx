import Link from 'next/link'
import styles from './page.module.scss'

export default async function Page({ params, searchParams }) {
  const filter = await searchParams
  const page = filter.page

  const slugify = (str) => {
    str = str.replace(/^\s+|\s+$/g, '') // trim leading/trailing white space
    str = str.toLowerCase() // convert string to lowercase
    str = str
      .replace(/\s+/g, '-') // replace spaces with hyphens
      .replace(/-+/g, '-') // remove consecutive hyphens
    return str
  }

  return (
    <div className={`${styles.page} ms-motion-slideDownIn`}>
      <div className={`__container d-f-c`} data-width={`small `}>
   <br />
   <br /><br /><br /><br /><br /><br /><br /><br /><br />
 <Link href={`./product/1/${slugify(`test`)}`}>
another page
</Link>
      </div>
    </div>
  )
}
