import Link from 'next/link'
import { ConnectWallet } from '@/components/ConnectWallet'
import styles from './Header.module.scss'

export default function Header() {
  return (
    <header className={`${styles.header}`}>
      <ul className={`flex align-items-center justify-content-between`}>
        <li className={`flex align-items-end`}>
          <Link href={`/`} className={`relative`}>
            <figure className={`${styles.logo} d-flex flex-row align-items-center`}>
              <img alt={`${process.env.NEXT_PUBLIC_NAME} Logo`} src={`/hup.svg`} />
            </figure>
          </Link>
        </li>
        <li className={`flex justify-content-end align-items-center gap-050`}>
          <ConnectWallet />
        </li>
      </ul>
    </header>
  )
}
