import Link from 'next/link'
import Image from 'next/image'
import { ConnectWallet } from '@/components/ConnectWallet'
import logo from '@/../public/hup.svg'
import styles from './Header.module.scss'

export default function Header() {
  return (
    <header className={`${styles.header}`}>
      <ul className={`flex align-items-center justify-content-between`}>
        <li className={`flex align-items-end`}>
          <Link href={`/`} className={`${styles.logo}`}>
            <Image src={logo} alt={`${process.env.NEXT_PUBLIC_NAME} Logo`} width={32} height={32} />
          </Link>
        </li>
        <li className={`flex justify-content-end align-items-center gap-050`}>
          <ConnectWallet />
        </li>
      </ul>
    </header>
  )
}
