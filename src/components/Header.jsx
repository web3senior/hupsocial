import Link from 'next/link'
import { ConnectWallet } from '@/components/ConnectWallet'
import styles from './Header.module.scss'

export default function Header() {
  return (
    <header className={`${styles.header}`}>
      <ul className={`flex align-items-center justify-content-between`}>
        <li className={`flex align-items-end`}>
          <Link href={`/`} className={`${styles.logo}`}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="40" height="40" rx="20" fill="black" />
              <path fillRule="evenodd" clipRule="evenodd" d="M13.7541 28.2442C17.1945 22.1137 25.2621 23.9693 26.5435 30H29.5C27.5791 23.3766 22.5435 20.6087 16.2826 22.5217L13.7541 28.2442Z" fill="white" />
              <path d="M19 10L10 30H12.9783C13.198 29.3544 13.459 28.7699 13.7541 28.2442L16.2826 22.5217L21.6739 10H19Z" fill="white" />
            </svg>
          </Link>
        </li>
        <li className={`flex justify-content-end align-items-center gap-050`}>
          <ConnectWallet />
        </li>
      </ul>
    </header>
  )
}
