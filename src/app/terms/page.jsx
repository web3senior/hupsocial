import Link from 'next/link'
import PageTitle from '@/components/PageTitle'
import styles from '@/styles/LegalPage.module.scss'

export const metadata = { title: 'Terms', description: 'Terms for using Hup and its connected features.' }

export default function TermsPage() {
  return (
    <>
      <PageTitle name="Terms" />
      <article className={`__container ${styles.legal__container}`} data-width="small">
        <h1>Terms of use</h1>
        <p className={styles.legal__updated}>Last updated: October 24, 2026</p>
        <p>These terms describe the conditions for using Hup. By using the app, you agree to follow them.</p>

        <h2>Your account and approvals</h2>
        <p>Keep your wallet credentials, recovery information, and security PIN private. Review requests before approving them. An authorized session key can perform supported actions without asking for a separate wallet approval each time. You can revoke that authorization through the app.</p>

        <h2>Content and conduct</h2>
        <p>You retain your rights to content you create. Only publish material you have permission to share. Publishing through Hup allows the app to store, distribute, and display that material as needed to provide the service.</p>
        <p>Do not use Hup for fraud, impersonation, harassment, malicious software, unauthorized access, or unlawful content. Content can be reported for review and may be hidden or removed from the interface.</p>

        <h2>Public activity and transactions</h2>
        <p>Onchain activity is public and may be permanent. Removing a post from the app does not erase its transaction history or copies held by others. Distributed storage can retain copies of published content.</p>
        <p>Check the network, recipient, amount, and transaction details before approving an action. Transactions can involve fees and may not be reversible. Relayer sponsorship depends on availability, funding, and usage limits.</p>

        <h2>Markets and connected services</h2>
        <p>Listings, offers, tips, fundraising, and other transactions have their own displayed conditions and smart contract rules. Review those conditions before participating. Third-party wallets, networks, storage providers, and embedded apps operate independently and may have separate terms.</p>

        <h2>Availability and updates</h2>
        <p>Features can change or become unavailable because of maintenance, network conditions, or external services. This page may be updated when the service changes; the date above identifies its latest revision.</p>
        <p>Read the <Link href="/privacy-policy">Privacy Policy</Link> and <Link href="/cookies">Cookies and browser storage information</Link> for details about data handling.</p>
      </article>
    </>
  )
}
