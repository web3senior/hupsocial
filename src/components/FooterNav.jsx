'use client'
import { useRouter } from 'next/navigation'
import styles from './FooterNav.module.scss'

export default function FooterNav({ link }) {
  const router = useRouter();

  const goTo = (e) =>  router.push(`${e.target.value}`)

  return (
    <select onChange={(e) => goTo(e)}>
      {link.map((item, i) => {
        return (
          <option key={i} value={`/${item.path}`}>
            {item.name}
          </option>
        )
      })}
    </select>
  )
}
