import Link from 'next/link'
import { ConnectWallet } from '@/components/ConnectWallet'
import styles from './Header.module.scss'

export default function Header() {
  return (
    <header className={`${styles.header}`}>
      <ul className={`flex align-items-center justify-content-between`}>
        <li className={`flex align-items-end`}>
          <Link href={`/`} className={`${styles.logo}`}>
            <svg width="32" height="18" viewBox="0 0 32 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.5599 3.92203V9.62683L19.9799 6.88946V3.92203H17.5599Z" fill="black" />
              <path d="M0 14.0549V0H2.38566V4.43961C5.94121 2.85238 8.90036 5.18722 9.19856 8.18914V14.0549H6.76702V8.18914C6.36325 5.72192 3.00293 5.71444 2.38566 8.18914V14.0549H0Z" fill="black" />
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M21.4251 10.0536V18H23.8795V13.2194C24.711 13.7832 25.7135 14.1124 26.7929 14.1124C29.6686 14.1124 32 11.7746 32 8.89073C32 6.00685 29.6686 3.66899 26.7929 3.66899C26.5813 3.67582 26.3804 3.68747 26.1893 3.70369C24.104 3.94503 22.7259 5.05659 21.5627 6.26835C18.4877 9.78374 15.8706 13.1705 13.8835 10.9693C13.3389 10.366 13.2014 9.51312 13.2014 8.69935V3.92203H10.8158V9.93736C10.8846 12.7783 13.9699 14.354 16.0459 14.0549C18.0012 13.7062 19.2509 12.5474 21.4251 10.0536ZM26.7699 11.7086C28.3409 11.7086 29.6144 10.4315 29.6144 8.85621C29.6144 7.28088 28.3409 6.00383 26.7699 6.00383C25.199 6.00383 23.9254 7.28088 23.9254 8.85621C23.9254 10.4315 25.199 11.7086 26.7699 11.7086Z"
                fill="black"
              />
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
