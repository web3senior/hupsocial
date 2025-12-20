import { ConnectWallet } from '@/components/ConnectWallet'
import styles from './Header.module.scss'

export default function Header() {
  return (
    <header className={`${styles.header}`}>
      <ul className={`flex align-items-center justify-content-end`}>
        <li className={`flex justify-content-end align-items-center gap-050`}>
          <ConnectWallet />
        </li>
      </ul>
    </header>
  )
}
