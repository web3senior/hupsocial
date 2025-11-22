import { WalletOptions } from '@/components/ConnectWallet'
import styles from './page.module.scss'

export default function Page() {
  return (
    <>
      <h3 className={`page-title`}>Privacy policy</h3>
      <div className={`${styles.page} ms-motion-slideDownIn`}>
        <div className={`__container ${styles.page__container}`}
         data-width={`medium`}>
          <h1>
            <strong>Hup social Privacy Policy</strong>
          </h1>

          <p>
            <strong>Effective Date: 11/22/2025</strong>
          </p>

          <h2>
            <strong>⚠️ Important: Understanding What&#39;s Public on Hup</strong>
          </h2>

          <p>
            Hup is a fully on-chain social protocol where <strong>most of your activity is public and visible on the blockchain</strong>. However, the actual content of your posts is stored on IPFS, which means
            you&#39;ll eventually be able to delete it.
          </p>

          <p>
            <strong>Before you use Hup, understand the difference:</strong>
          </p>

          <h3>
            <strong>What&#39;s on the Blockchain (Permanent &amp; Public):</strong>
          </h3>

          <ul>
            <li>Your wallet address and all transactions</li>
            <li>Your profile information (username, bio, profile picture)</li>
            <li>Records that you posted, commented, liked, tipped, etc.</li>
            <li>Transaction hashes and timestamps</li>
            <li>
              <strong>Cannot be deleted or hidden</strong>
            </li>
          </ul>

          <h3>
            <strong>What&#39;s on IPFS (Can Be Deleted):</strong>
          </h3>

          <ul>
            <li>The actual text/content of your posts and comments</li>
            <li>Images and media you upload to posts</li>
            <li>
              <strong>Can be unpinned and made unavailable</strong>
            </li>
          </ul>

          <p>&nbsp;</p>

          <h2>
            <strong>1. How Hup Stores Your Data</strong>
          </h2>

          <p>Hup uses a hybrid storage model:</p>

          <p>
            <strong>Blockchain - Permanent Records</strong> The blockchain stores:
          </p>

          <ul>
            <li>Your wallet address</li>
            <li>
              <strong>Your complete profile information</strong> (username, bio, profile picture, any profile fields)
            </li>
            <li>Transaction records of your actions (posted, commented, liked, tipped)</li>
            <li>Content hashes (IPFS CIDs) that point to your post content</li>
            <li>Timestamps and transaction metadata</li>
            <li>Social graph data (who you interact with)</li>
          </ul>

          <p>
            <strong>IPFS - Content Storage</strong> IPFS stores:
          </p>

          <ul>
            <li>The actual text of your posts and comments</li>
            <li>Images, videos, and other media within posts</li>
          </ul>

          <h2>
            <strong>2. What &quot;Delete&quot; Actually Means on Hup</strong>
          </h2>

          <p>
            <strong>When you delete a post:</strong>
          </p>

          <p>
            ✅ <strong>What Gets Removed:</strong>
          </p>

          <ul>
            <li>The content is unpinned from Hup&#39;s IPFS nodes</li>
            <li>It disappears from the Hup interface</li>
            <li>After some time, if no one else pinned it, the content becomes unavailable</li>
          </ul>

          <p>
            ❌ <strong>What Remains Forever:</strong>
          </p>

          <ul>
            <li>The blockchain still shows your wallet posted something at that time</li>
            <li>The transaction hash and timestamp remain</li>
            <li>The IPFS content hash (CID) remains on-chain</li>
            <li>Anyone who pinned your content can still access it</li>
            <li>
              <strong>Your profile information remains unchanged</strong>
            </li>
          </ul>

          <p>
            <strong>Think of it like this:</strong> Deleting removes the content from Hup&#39;s servers, but the &quot;receipt&quot; that you posted something is permanent.
          </p>

          <h2>
            <strong>3. Your Profile Lives on the Blockchain</strong>
          </h2>

          <p>
            <strong>Your profile is permanently stored on-chain.</strong> This includes:
          </p>

          <ul>
            <li>Username</li>
            <li>Bio/description</li>
            <li>Profile picture</li>
            <li>Any additional profile fields you fill out</li>
            <li>The wallet address associated with your profile</li>
          </ul>

          <p>
            <strong>This means:</strong>
          </p>

          <ul>
            <li>Your profile information cannot be deleted, only updated</li>
            <li>Changes to your profile create new transactions (the history is visible)</li>
            <li>Your username is permanently linked to your wallet address</li>
            <li>Profile data is as public and permanent as blockchain transactions</li>
          </ul>

          <p>
            <strong>Choose your profile information carefully.</strong> It&#39;s the face you present to the on-chain world, and it&#39;s immutable in the blockchain&#39;s history.
          </p>

          <h2>
            <strong>4. A Note on Responsibility and Value</strong>
          </h2>

          <p>
            Hup exists because we believe social media has lost something essential: <strong>meaningful human connection and thoughtful discourse</strong>.
          </p>

          <p>Traditional social media optimized for engagement over value, for outrage over understanding, for quantity over quality. The dopamine-driven feed has made us forget how to communicate with intention.</p>

          <p>
            <strong>On Hup, permanence demands responsibility.</strong>
          </p>

          <p>Because your actions create permanent records, we ask you to approach communication differently:</p>

          <ul>
            <li>
              <strong>Post with intention</strong> - Will this add value to the conversation?
            </li>
            <li>
              <strong>Comment thoughtfully</strong> - Does this contribute understanding or just noise?
            </li>
            <li>
              <strong>Engage authentically</strong> - Are you here to connect or just to react?
            </li>
            <li>
              <strong>Respect permanence</strong> - Would you want this on the blockchain forever?
            </li>
          </ul>

          <p>The immutability of blockchain isn&#39;t a bug&mdash;it&#39;s a feature that encourages us to think before we speak, to mean what we say, and to stand behind our words.</p>

          <p>
            <strong>We&#39;re not asking for perfection.</strong> We&#39;re asking for presence. For the kind of communication that brings back what social media has eroded: genuine human connection, thoughtful dialogue,
            and contributions that matter.
          </p>

          <p>Your wallet address is your reputation. Your posts are your legacy. Make them count.</p>

          <h2>
            <strong>5. The IPFS Reality Check</strong>
          </h2>

          <p>
            <strong>IPFS is a distributed network.</strong> Even after you delete:
          </p>

          <ul>
            <li>
              <strong>Other people may have pinned your content</strong> - If someone found your post interesting and pinned it to their own IPFS node, it persists regardless of what you do
            </li>
            <li>
              <strong>Content may be cached</strong> - IPFS nodes temporarily cache content they retrieve, so deleted content might remain accessible for a period
            </li>
            <li>
              <strong>Public gateways</strong> - If someone accessed your content through an IPFS gateway, it might be cached there
            </li>
            <li>
              <strong>Archives</strong> - Services that archive IPFS content might have copies
            </li>
          </ul>

          <p>
            <strong>Bottom line:</strong> Treat &quot;delete&quot; as &quot;making it harder to find&quot; rather than &quot;permanent removal.&quot;
          </p>

          <h2>
            <strong>6. What&#39;s Permanently Public (On-Chain Data)</strong>
          </h2>

          <p>
            The following information is recorded on the blockchain and <strong>cannot be deleted</strong>:
          </p>

          <p>
            <strong>Your Wallet Address</strong>
          </p>

          <ul>
            <li>Visible in every transaction you make</li>
            <li>Permanently linked to all your Hup activity</li>
            <li>Can be traced across other blockchain applications</li>
          </ul>

          <p>
            <strong>Your Profile</strong>
          </p>

          <ul>
            <li>Username, bio, profile picture</li>
            <li>All profile updates and their history</li>
            <li>The association between your wallet and your identity</li>
          </ul>

          <p>
            <strong>Transaction Records</strong>
          </p>

          <ul>
            <li>Every post, comment, like, repost, and tip creates a permanent blockchain transaction</li>
            <li>Timestamps showing when you were active</li>
            <li>Transaction hashes that prove authenticity</li>
            <li>IPFS content hashes (even if the content itself is deleted)</li>
          </ul>

          <p>
            <strong>Social Interactions</strong>
          </p>

          <ul>
            <li>Records of accounts you interacted with</li>
            <li>Tip amounts you sent or received</li>
            <li>Frequency and patterns of your activity</li>
          </ul>

          <h2>
            <strong>7. Privacy Risks You Should Know About</strong>
          </h2>

          <p>
            <strong>Wallet Linkability</strong> If your wallet is connected to your real identity anywhere else (KYC exchanges, ENS domains, other dapps), your Hup activity can be linked to you personally.
          </p>

          <p>
            <strong>Content May Persist Despite Deletion</strong> Anyone monitoring the blockchain can save content hashes and pin content themselves before you delete it.
          </p>

          <p>
            <strong>Activity Patterns</strong> Even without content, your transaction history reveals:
          </p>

          <ul>
            <li>When you&#39;re active online</li>
            <li>Who you interact with most</li>
            <li>Your interests based on what you like/repost</li>
          </ul>

          <p>
            <strong>Profile Information is Forever</strong> Think carefully before adding personal information to your profile. It cannot be truly deleted, only updated.
          </p>

          <p>
            <strong>Screenshots and External Copies</strong> Like any social media, people can screenshot or copy your content before you delete it.
          </p>

          <p>
            <strong>Cross-Chain Visibility</strong> Depending on which blockchain Hup is deployed on, your activity may be visible across multiple blockchain explorers and analytics platforms.
          </p>

          <h2>
            <strong>8. Current Privacy Limitations</strong>
          </h2>

          <p>
            <strong>We don&#39;t have these features yet:</strong>
          </p>

          <ul>
            <li>❌ Private or encrypted messaging</li>
            <li>❌ Anonymous posting</li>
            <li>❌ Privacy-preserving interactions</li>
            <li>❌ Guaranteed content deletion from the entire IPFS network</li>
            <li>❌ Wallet address masking</li>
            <li>❌ Profile deletion</li>
          </ul>

          <p>
            <strong>Everything is public by default.</strong> We may add privacy features in the future, but right now, assume anyone can see your activity.
          </p>

          <h2>
            <strong>9. What We DON&#39;T Collect</strong>
          </h2>

          <p>
            <strong>Private Keys</strong> We never see, store, or have access to your private keys or seed phrases. Only you control these.
          </p>

          <p>
            <strong>Off-Chain Personal Data</strong> We don&#39;t maintain a centralized database of personal information.
          </p>

          <p>
            <strong>Tracking Data</strong>
          </p>

          <ul>
            <li>No IP address logging</li>
            <li>No analytics that identify individual users</li>
            <li>No cookies for tracking</li>
          </ul>

          <p>
            <strong>Local Browser Storage Only</strong> The Hup interface may temporarily store preferences in your browser (UI settings, session state). This stays on your device and isn&#39;t sent to any server.
          </p>

          <h2>
            <strong>10. Best Practices for Privacy on Hup</strong>
          </h2>

          <p>
            <strong>Use a Fresh Wallet</strong> Create a new wallet specifically for Hup that isn&#39;t linked to your identity.
          </p>

          <p>
            <strong>Choose Your Profile Carefully</strong>
          </p>

          <ul>
            <li>Don&#39;t use your real name unless you want it public forever</li>
            <li>Avoid profile pictures that reveal your identity</li>
            <li>Keep your bio generic if you want privacy</li>
          </ul>

          <p>
            <strong>Be Careful What You Post</strong>
          </p>

          <ul>
            <li>Don&#39;t share personal information (real name, location, phone number)</li>
            <li>Assume deleted content might persist somewhere</li>
            <li>Only post what you&#39;re comfortable being public</li>
          </ul>

          <p>
            <strong>Understand You&#39;re Traceable</strong>
          </p>

          <ul>
            <li>Your wallet address is your identity on Hup</li>
            <li>All your actions are linkable through this address</li>
            <li>Consider using different wallets for different activities</li>
          </ul>

          <p>
            <strong>Don&#39;t Link to Your Real Identity</strong>
          </p>

          <ul>
            <li>Don&#39;t connect this wallet to KYC services</li>
            <li>Use a pseudonymous username</li>
            <li>Be aware of metadata that might identify you</li>
          </ul>

          <h2>
            <strong>11. Third Parties and External Services</strong>
          </h2>

          <p>
            <strong>We Don&#39;t Sell Data</strong> There&#39;s no centralized data to sell. Blockchain data is already public.
          </p>

          <p>
            <strong>IPFS Network</strong> Your content is distributed across the IPFS network. We don&#39;t control other IPFS nodes.
          </p>

          <p>
            <strong>Blockchain Explorers</strong> Your on-chain activity is visible on public blockchain explorers and can be analyzed by anyone.
          </p>

          <p>
            <strong>External Links</strong> Hup may link to other websites or dapps. We&#39;re not responsible for their privacy practices.
          </p>

          <h2>
            <strong>12. Children&#39;s Privacy</strong>
          </h2>

          <p>Hup is not intended for anyone under 18 years old. Do not use Hup if you are under 18.</p>

          <h2>
            <strong>13. Future Privacy Features</strong>
          </h2>

          <p>We&#39;re working on adding privacy options, including:</p>

          <ul>
            <li>Encrypted direct messaging</li>
            <li>Optional anonymous posting</li>
            <li>Better content deletion mechanisms</li>
            <li>Privacy-preserving social interactions</li>
          </ul>

          <p>But these don&#39;t exist yet. Check our roadmap for updates.</p>

          <h2>
            <strong>14. Updates to This Policy</strong>
          </h2>

          <p>We&#39;ll update this policy when we add new features or change how data is handled. Updates will be announced through official Hup channels.</p>

          <h2>
            <strong>15. Contact &amp; Support</strong>
          </h2>

          <p>Questions about privacy on Hup? Reach out via:</p>

          <ul>
            <li>
              <b>
                Discord: <a href="http://discord.gg/dWBT7UuvEM">discord.gg/dWBT7UuvEM</a>
              </b>
            </li>
            <li>
              <b>
                GitHub: <a href="https://github.com/web3senior/hupsocial">github.com/web3senior/hupsocial</a>
              </b>
            </li>
          </ul>

          <p>&nbsp;</p>

          <hr />
          <p>
            <strong>Summary:</strong> Hup gives you more control than traditional social media&mdash;you can delete your post content from IPFS. But your profile and all blockchain transaction records are permanent, and
            deleted content might persist if others pinned it. Use Hup knowing that wallet-level activity and profile information are always public, and that content deletion isn&#39;t guaranteed.
          </p>

          <p>
            <strong>The permanence of blockchain asks something of us:</strong> to be thoughtful, to add value, and to remember what it means to communicate with intention. Welcome to social media that matters.
          </p>

          <p>&nbsp;</p>
        </div>
      </div>
    </>
  )
}
