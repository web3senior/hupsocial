'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useClientMounted } from '@/hooks/useClientMount'
import { getActiveChain } from '@/util/communication'
import { useAccount } from 'wagmi'
import styles from './Footer.module.scss'

export default function Footer() {
  const mounted = useClientMounted()
  const pathname = usePathname()
  const { address, isConnected } = useAccount()
  const params = useParams()
  const activeChain = getActiveChain()

  const pages = [
    {
      name: `Home`,
      path: '',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M240-200h133.85v-237.69h212.3V-200H720v-360L480-740.77 240-560v360Zm-60 60v-450l300-225.77L780-590v450H526.15v-237.69h-92.3V-140H180Zm300-330.38Z"/></svg>`,
      disabled: false,
    },
    {
      name: `Search`,
      path: 'inbox',
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M19.125 20.3992L13.15 14.4242C12.65 14.7909 12.1017 15.0784 11.5052 15.2867C10.9087 15.4951 10.2739 15.5992 9.60073 15.5992C7.93356 15.5992 6.51664 15.0159 5.34998 13.8492C4.18331 12.6826 3.59998 11.2659 3.59998 9.59922C3.59998 7.93255 4.18331 6.51589 5.34998 5.34922C6.51664 4.18255 7.93331 3.59922 9.59998 3.59922C10.0333 3.59922 10.4458 3.64089 10.8375 3.72422C11.2291 3.80755 11.6083 3.93255 11.975 4.09922L10.55 5.49922C10.3946 5.46589 10.2393 5.44089 10.084 5.42422C9.92864 5.40755 9.76731 5.39922 9.59998 5.39922C8.43331 5.39922 7.44164 5.80755 6.62498 6.62422C5.80831 7.44089 5.39998 8.43255 5.39998 9.59922C5.39998 10.7659 5.80831 11.7576 6.62498 12.5742C7.44164 13.3909 8.43331 13.7992 9.59998 13.7992C10.5666 13.7992 11.4166 13.5201 12.15 12.9617C12.8833 12.4034 13.375 11.6826 13.625 10.7992H15.475C15.3916 11.2326 15.2583 11.6451 15.075 12.0367C14.8916 12.4284 14.675 12.7992 14.425 13.1492L20.4 19.1242L19.125 20.3992ZM17.4 11.9992C17.4 10.4937 16.8763 9.21739 15.829 8.17022C14.7818 7.12289 13.5055 6.59922 12 6.59922C13.5055 6.59922 14.7818 6.07555 15.829 5.02822C16.8763 3.98105 17.4 2.70472 17.4 1.19922C17.4 2.70472 17.9236 3.98105 18.971 5.02822C20.0181 6.07555 21.2945 6.59922 22.8 6.59922C21.2945 6.59922 20.0181 7.12289 18.971 8.17022C17.9236 9.21739 17.4 10.4937 17.4 11.9992Z" fill="#1F1F1F"/>
</svg>
`,
      disabled: false,
    },
    {
      name: `New`,
      path: 'new',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M450-450H220v-60h230v-230h60v230h230v60H510v230h-60v-230Z"/></svg>`,
      disabled: false,
    },
    {
      name: `Likes`,
      path: 'likes',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="m480-146.93-44.15-39.69q-99.46-90.23-164.5-155.07-65.04-64.85-103.08-115.43-38.04-50.57-53.15-92.27Q100-591.08 100-634q0-85.15 57.42-142.58Q214.85-834 300-834q52.38 0 99 24.5t81 70.27q34.38-45.77 81-70.27 46.62-24.5 99-24.5 85.15 0 142.58 57.42Q860-719.15 860-634q0 42.92-15.12 84.61-15.11 41.7-53.15 92.27-38.04 50.58-102.89 115.43Q624-276.85 524.15-186.62L480-146.93Zm0-81.07q96-86.38 158-148.08 62-61.69 98-107.19t50-80.81q14-35.3 14-69.92 0-60-40-100t-100-40q-47.38 0-87.58 26.88-40.19 26.89-63.65 74.81h-57.54q-23.85-48.31-63.85-75Q347.38-774 300-774q-59.62 0-99.81 40Q160-694 160-634q0 34.62 14 69.92 14 35.31 50 80.81t98 107q62 61.5 158 148.27Zm0-273Z"/></svg>`,
      disabled: false,
    },
    {
      name: `Profile`,
      path: isConnected ? `u/${address}` : `connect`,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M480-492.31q-57.75 0-98.87-41.12Q340-574.56 340-632.31q0-57.75 41.13-98.87 41.12-41.13 98.87-41.13 57.75 0 98.87 41.13Q620-690.06 620-632.31q0 57.75-41.13 98.88-41.12 41.12-98.87 41.12ZM180-187.69v-88.93q0-29.38 15.96-54.42 15.96-25.04 42.66-38.5 59.3-29.07 119.65-43.61 60.35-14.54 121.73-14.54t121.73 14.54q60.35 14.54 119.65 43.61 26.7 13.46 42.66 38.5Q780-306 780-276.62v88.93H180Zm60-60h480v-28.93q0-12.15-7.04-22.5-7.04-10.34-19.11-16.88-51.7-25.46-105.42-38.58Q534.7-367.69 480-367.69q-54.7 0-108.43 13.11-53.72 13.12-105.42 38.58-12.07 6.54-19.11 16.88-7.04 10.35-7.04 22.5v28.93Zm240-304.62q33 0 56.5-23.5t23.5-56.5q0-33-23.5-56.5t-56.5-23.5q-33 0-56.5 23.5t-23.5 56.5q0 33 23.5 56.5t56.5 23.5Zm0-80Zm0 384.62Z"/></svg>`,
      disabled: false,
    },
  ]

  /**
   * Get the last visited page
   * @returns string
   */
  const getLastVisitedPage = async () => await JSON.parse(localStorage.getItem(`lastVisitedPage`))

  return !mounted ? null : (
    <footer className={`${styles.footer}`}>
      <ul className={`flex flex-row aling-items-center justify-content-between`}>
        {pages &&
          pages
            .filter((filterItem) => !filterItem.disabled)
            .map((link, i) => {
              return (
                <li key={i}>
                  <Link href={`/${link.path}`} data-active={pathname === `/${link.path}` ? true : false}>
                    <div className={`d-f-c`} dangerouslySetInnerHTML={{ __html: link.icon }} />
                  </Link>
                </li>
              )
            })}
      </ul>
    </footer>
  )
}
