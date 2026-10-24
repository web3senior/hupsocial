import Link from 'next/link'
import PageTitle from '@/components/PageTitle'
import styles from '@/styles/LegalPage.module.scss'

export const metadata = { title: 'Cookies', description: 'How Hup uses cookies and browser storage.' }

export default function CookiesPage() {
  return (
    <>
      <PageTitle name="Cookies" />
      <article className={`__container ${styles.legal__container}`} data-width="small">
        <h1>Cookies and browser storage</h1>
        <p className={styles.legal__updated}>Last updated: October 24, 2026</p>
        <p>Hup uses browser storage for sign-in, preferences, and features such as queued likes. Cookies and local storage are different technologies; both can keep information on your device.</p>

        <h2>Email sign-in cookie</h2>
        <p>When you sign in by email, Hup sets <code>hup_email_session</code> to authorize access to the account keystore. It expires after 30 days unless replaced or cleared. It is HttpOnly, uses SameSite=Lax, and is marked Secure in production.</p>

        <h2>Local and session storage</h2>
        <p>The app stores preferences, queued interactions, and wallet-related state in your browser. Local storage can remain after you close the browser. Session storage is normally limited to the current tab session. In-app wallet features also use browser storage for encrypted key material and, while unlocked, session signing data.</p>

        <h2>Connected services</h2>
        <p>Wallet providers and third-party apps or media opened within Hup may use their own cookies or storage. Their behavior depends on the provider and your browser settings.</p>

        <h2>Managing storage</h2>
        <p>You can inspect, block, or clear cookies and site storage through your browser settings. Blocking storage can prevent sign-in or other features from working. Clearing storage can remove queued likes, drafts, preferences, and locally stored wallet information. Make sure you have the recovery information you need before clearing it.</p>
        <p>Clearing browser storage does not revoke an onchain session or remove public blockchain records. Revoke an active session through the app before clearing storage if you want to stop its authorization.</p>
        <p>For more information, read the <Link href="/privacy-policy">Privacy Policy</Link> and <Link href="/terms">Terms of use</Link>.</p>
      </article>
    </>
  )
}
