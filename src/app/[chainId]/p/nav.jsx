'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './Nav.module.scss'

export default function Nav() {
  const router = useRouter()
  const link = [
    {
      name: `Lobby`,
      path: `dashboard`,
    },
    {
      name: `Profile`,
      path: `profile`,
    },
    {
      name: `Orders`,
      path: `orders`,
    },
  ]
  useEffect(() => {
    //if (localStorage.getItem('token') === null) router.push('/')
  }, [])

  return (
    <div className={`${styles.nav}`}>
      <div className={`${styles.miniNav}`}>
        {link.map((item, i) => (
          <Link key={i} href={`${item.path}`}>
            {item.name}
          </Link>
        ))}
        <Link
          href={`#`}
          onClick={() => {
            localStorage.removeItem(`token`)
            router.push('/')
          }}
        >
          Log out
        </Link>
      </div>

      <ul className={`${styles.mainNav} d-flex flex-column`}>
        {link.map((item, i) => (
          <li key={i}>
            <Link href={`${item.path}`}>{item.name}</Link>
          </li>
        ))}
        <li>
          <Link
            href={`#`}
            onClick={() => {
              localStorage.removeItem(`token`)
              router.push('/')
            }}
          >
            Log out
          </Link>
        </li>
      </ul>
    </div>
  )
}
