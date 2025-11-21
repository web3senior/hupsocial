import { WalletOptions } from '@/components/ConnectWallet'
import styles from './page.module.scss'

export default function Page() {
  return (
    <div className={`${styles.page} ms-motion-slideDownIn`}>
      <h3 className={`page-title`}>Privacy policy</h3>

      <div className={`__container ${styles.page__container} flex flex-column align-items-start justify-content-start`} data-width={`medium`} style={{ padding: `1rem` }}>
        <header className="mb-8 border-b pb-4">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-[#0B2F56] mb-2">Hup Protocol Privacy Policy</h1>
          <p className="text-lg text-gray-600 font-medium">
            Effective Date: <span className="text-indigo-600">October 26, 2025</span>
          </p>
        </header>

        <div className="mb-10 text-gray-700 policy-content">
          <p className="text-xl italic border-l-4 border-indigo-500 pl-4 py-2 bg-indigo-50 rounded-r-lg">
            Welcome to Hup, a decentralized social and coordination protocol built on the Monad Testnet (the "Protocol" or "Hup"). Hup is designed to provide immutable content storage and uncoerced, privacy-preserving
            governance through Zero-Knowledge Proofs (ZKPs).
          </p>
          <p className="mt-4">
            This Privacy Policy describes how data is collected, used, and processed within the Hup Protocol. By using the Protocol, you understand and agree to the terms of this policy, particularly concerning the
            public nature of data stored on the blockchain.
          </p>
        </div>

        <div className="policy-content">
          <h2 id="section-1">1. Core Principle: On-Chain Data is Public and Permanent</h2>
          <p>Unlike traditional centralized services, the Hup Protocol’s core functionality involves storing data directly on a public, immutable blockchain (Monad EVM).</p>
          <p className="p-3 bg-red-50 border-l-4 border-red-500 rounded-lg text-red-800 font-semibold mt-4">
            Any information you post, comment, or transact on the Protocol is <span className="highlight">public, permanent, and cryptographically verifiable</span> by anyone with access to the blockchain.
          </p>
          [Image of Blockchain Transaction Structure]
          <h3>1.1 Data Considered Public (On-Chain Data)</h3>
          <p>The following data is recorded as transactional data on the blockchain via Hup smart contracts and **cannot be removed or altered**:</p>
          <ul className="list-disc ml-6 space-y-2">
            <li>
              <span className="highlight">Wallet Addresses:</span> The public addresses (EOA or Smart Contract Wallets) that interact with the Protocol, including the address associated with your `HupIdentityManager`.
            </li>
            <li>
              <span className="highlight">Content:</span> All posts, comments, replies, and edits (including the timestamp and associated transaction hash) are stored immutably.
            </li>
            <li>
              <span className="highlight">Social Interactions:</span> Records of actions such as tipping, liking, and claiming tokens are permanent public transactions.
            </li>
            <li>
              <span className="highlight">Governance Eligibility:</span> While your specific vote is private (see Section 3), the fact that your wallet address was eligible to vote and participated in a specific
              governance action is a public record.
            </li>
          </ul>
          <h3>1.2 Association of Public Data with Your Identity</h3>
          <p>When you create a profile using the `HupIdentityManager`, you associate your public wallet address(es) with a chosen, human-readable username.</p>
          <ul className="list-disc ml-6 space-y-2">
            <li>If your wallet addresses can be linked back to a real-world identity through other public means, your on-chain activity is potentially linkable to you.</li>
            <li>Hup encourages users to utilize its Multi-Owner Identity feature and best practices for on-chain privacy to manage this risk.</li>
          </ul>
          <h2 id="section-2">2. Data Stored Privately (Off-Chain Data)</h2>
          <p>The Hup Protocol strives to minimize the collection of personal data stored off-chain.</p>
          <h3>2.1 Protocol and Interface Data</h3>
          <p>Hup itself is a set of smart contracts. The user interfaces (front-ends) connecting to Hup are often open-source and typically do not collect centralized user data.</p>
          <ul className="list-disc ml-6 space-y-2">
            <li>
              <span className="highlight">Client-Side Cache:</span> Interfaces may temporarily store non-critical information locally in your browser (e.g., local storage or cookies) for performance purposes, such as UI
              preferences or current login session status. This data is not transmitted to Hup or any centralized server.
            </li>
            <li>
              <span className="highlight">Analytics (Optional):</span> If Hup implements optional, non-identifying analytics (e.g., to track contract usage or site traffic patterns), it will be done using privacy-focused
              tools that do not record IP addresses or other personally identifiable information.
            </li>
          </ul>
          <h3>2.2 Private Keys</h3>
          <p className="p-3 bg-yellow-50 border-l-4 border-yellow-500 rounded-lg text-yellow-800 font-semibold">
            <span className="highlight">Hup never collects, stores, or transmits your private keys or seed phrases.</span> Your keys are solely controlled by you and are necessary only for signing transactions on the
            blockchain.
          </p>
          <h2 id="section-3">3. Privacy-Preserving Governance (Zero-Knowledge Proofs)</h2>
          <p>Hup utilizes Zero-Knowledge Proof technology to ensure the privacy of your governance decisions.</p>
          <ul className="list-disc ml-6 space-y-2">
            <li>
              <span className="highlight">Vote Privacy:</span> When you participate in a governance vote, the Hup smart contract verifies your eligibility using a ZKP. This cryptographic proof confirms that you are
              authorized to vote, <span className="font-bold">without revealing your identity, your specific vote, or the wallet address you used to cast it.</span>
            </li>
            <li>
              <span className="highlight">Verifiability:</span> The ZKP ensures that the vote is valid and that no double-spending of votes occurred, maintaining the integrity of the process while protecting voter
              privacy.
            </li>
          </ul>
          [Image of Zero Knowledge Proof Workflow]
          <h2 id="section-4">4. Children’s Privacy</h2>
          <p>
            The Hup Protocol is not directed at children under the age of 13. By using the Protocol, you represent that you are at least 13 years old. If we become aware that we have inadvertently collected personal
            information from a child under 13, we will take steps to delete that information.
          </p>
          <h2 id="section-5">5. Third-Party Data Sharing and Links</h2>
          <ul className="list-disc ml-6 space-y-2">
            <li>
              <span className="highlight">No Sale of Data:</span> Hup is a protocol, not a data broker. We do not sell any of the minimal off-chain data we may collect.
            </li>
            <li>
              <span className="highlight">External Links:</span> The Protocol may contain links to external websites (e.g., news articles, external dApps). This Privacy Policy does not cover the privacy practices of
              those external sites.
            </li>
          </ul>
          <h2 id="section-6">6. Contact Information</h2>
          <p>
            If you have any questions about this Privacy Policy or Hup’s data practices, please refer to the official Hup documentation and community channels for support. As the Protocol is decentralized, support is
            typically provided via community channels managed by the DAO or core contributors.
          </p>
          <hr className="my-8 border-gray-300" />
          <footer className="text-sm text-center text-gray-500">
            This Privacy Policy may be updated to reflect changes in the Protocol’s operations or technology. Changes will be announced through official Hup channels.
          </footer>
        </div>
      </div>
    </div>
  )
}
