import Link from 'next/link'
import Image from 'next/image'
import clsx from 'clsx'
import { Rise } from 'cube-motion/react'
import {
  ArrowRightIcon,
  CoinsIcon,
  FireIcon,
  HandCoinsIcon,
  LockKeyIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  SparkleIcon,
  StackIcon,
  UsersThreeIcon,
  VaultIcon,
} from '@phosphor-icons/react/dist/ssr'
import PageTitle from '@/components/PageTitle'
import { HUP_ALLOCATION, HUP_LAUNCH_TARGETS, HUP_PUBLIC_SALE, HUP_TOKEN } from '@/config/token'
import { ACHIEVEMENT_BONUSES, ACHIEVEMENT_GRANTED_CAP, achievementBonusLabel } from '@/config/points'
import { readAchievementCatalog } from '@/lib/achievementCatalog'
import { LAUNCH_CHAINS } from '@/config/launchpadChains'
import TokenNavigation from './_components/TokenNavigation'
import styles from './page.module.scss'

export const metadata = {
  title: '$HUP',
  description: 'The Hup platform token: fixed supply, no VC round, bought back with launchpad revenue.',
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const supply = compact.format(HUP_TOKEN.totalSupply)
const communityShare = HUP_ALLOCATION.filter((item) => item.community).reduce((sum, item) => sum + item.share, 0)
const airdropShare = HUP_ALLOCATION.find((item) => item.bucket === 'Airdrops')?.share ?? 0
const saleShare = HUP_ALLOCATION.find((item) => item.bucket === 'Public sale')?.share ?? 0
const sale = HUP_PUBLIC_SALE
// The achievements that add airdrop points, biggest bonus first (config/points.js)
// A sale term set in config/token.js, or the promise that it is announced first
const saleTerm = (value) => value ?? 'Announced before the sale'
const buybackPercent = `${HUP_TOKEN.buybackShare * 100}%`

const UTILITY = [
  { icon: FireIcon, title: 'Bought back with revenue', text: `${buybackPercent} of the launchpad's protocol fees buy $HUP and burn it.` },
  { icon: StackIcon, title: 'Staking', text: 'Stake $HUP in Hup staking vaults and earn from the community rewards pool.' },
  { icon: RocketLaunchIcon, title: 'A launchpad pair', text: 'Coins can launch paired against $HUP, so every launch and trade buys it.' },
]

const SAFEGUARDS = [
  'Team and advisor tokens are locked behind cliffs, in vesting contracts anyone can inspect.',
  'The treasury is held in a multisig, not a single wallet.',
  'The buyback half of every fee can only reach a buyback vault: the team cannot withdraw it.',
  'A legal entity is formed before any public sale.',
  'One official contract address, published here only.',
]

const PRINCIPLES = [
  { icon: CoinsIcon, title: `${supply} fixed supply`, text: 'Minted once at launch. Nobody can mint more, ever.' },
  {
    icon: UsersThreeIcon,
    title: 'No VC round',
    text: 'No investors buy in before you. The first chance to buy is a public sale at launch.',
  },
  {
    icon: HandCoinsIcon,
    title: 'Community first',
    text: 'Most of the supply goes to the people who use Hup: the airdrop, rewards and the public sale.',
  },
  { icon: FireIcon, title: 'Real buybacks', text: 'Launchpad fees buy $HUP back and burn it, enforced by contract rather than promised.' },
]

const FLOW = [
  { icon: RocketLaunchIcon, title: 'Coins trade', text: 'Every trade on the Hup launchpad pays a fee.' },
  {
    icon: VaultIcon,
    title: 'The splitter takes the protocol share',
    text: 'Half goes to the treasury, half is locked for buybacks. Nobody, the team included, can withdraw it.',
  },
  { icon: LockKeyIcon, title: 'Locked until $HUP exists', text: 'The buyback half waits onchain, where anyone can watch it grow.' },
  {
    icon: FireIcon,
    title: 'Bought and burned',
    text: 'After launch, a buyback vault spends it on $HUP and burns what it buys. Anyone can trigger a run.',
  },
]

const ROADMAP = [
  { title: 'Bootstrap', when: 'Now', text: 'Self-funded, no VC round.' },
  { title: 'Launchpad', when: 'Next', text: 'Mainnet live, fees start building the buyback.' },
  { title: 'Points season', when: 'Live', text: 'Your activity on Hup earns points toward the airdrop.', live: true },
  {
    title: 'Token launch',
    when: 'When the targets are met',
    text: 'Public sale, airdrop and buybacks start, on one or two chains depending on where demand is.',
  },
  { title: 'Expansion', when: 'After launch', text: 'More chains, and $HUP as a launchpad pair.' },
]

const FAQ = [
  {
    q: 'When does $HUP launch?',
    a: 'When the targets above are met, not on a fixed date. Season 1 runs until then, and its snapshot date is announced 2 weeks ahead.',
  },
  {
    q: 'Which chain will $HUP be on?',
    a: 'One or two chains at launch, chosen by where Hup’s users and demand are, with more added later. The supply stays the same 1B however many chains it moves across.',
  },
  {
    q: 'How do I get an airdrop?',
    a: 'Use Hup: post, get likes and tips, follow and launch coins. Your season points decide your share. Trading earns no points.',
  },
  {
    q: 'Can I buy $HUP now?',
    a: 'No. Any $HUP trading today is not ours. The official contract address will be published on this page only.',
  },
  {
    q: 'Is there a private sale or whitelist?',
    a: 'No. There is no private round and no discounted allocation: the public sale is the first time anyone can buy, at one price for all.',
  },
  {
    q: 'What if the sale is oversubscribed?',
    a: 'Everyone who committed gets the same share of what they asked for, and the USDC that was not used is refunded.',
  },
  {
    q: 'How firm are these numbers?',
    a: 'This is the plan as it stands. Allocations and vesting can still change until launch; the final numbers are published here before the sale.',
  },
]

// $HUP's public story before its TGE. The working numbers stay in the private plan until final.
export default async function TokenPage() {
  const catalog = await readAchievementCatalog()
  const achievementBoosts = Object.entries(ACHIEVEMENT_BONUSES)
    .filter(([id]) => catalog.some((item) => item.id === id && item.listed))
    .map(([id, rule]) => ({
      id,
      name: catalog.find((item) => item.id === id)?.name ?? id,
      points: rule.points,
      label: achievementBonusLabel(id),
      granted: rule.granted,
    }))
    .sort((a, b) => b.points - a.points)

  const splitters = Object.entries(HUP_TOKEN.feeSplitters).filter(([key]) => LAUNCH_CHAINS[key])

  return (
    <>
      <PageTitle name="$HUP" />
      <div className={styles.token}>
        <div className={clsx('__container', styles.token__container)} data-width="xlarge">
          <TokenNavigation />
          <div className={styles.token__content}>
            <header id="token-overview" className={styles.hero}>
              <div className={styles.hero__copy}>
                <span className={styles.hero__eyebrow}>
                  <SparkleIcon size={16} weight="fill" aria-hidden="true" />
                  The Hup platform token / coming soon
                  <span className={styles.hero__beta}>Beta</span>
                </span>
                <h1 className={styles.hero__title}>
                  Built together.
                  <br />
                  Powered by <span>{HUP_TOKEN.symbol}.</span>
                </h1>
                <p className={styles.hero__lede}>
                  You create. You connect. You build Hup. A platform token designed to bring that value back to the community.
                </p>
                <div className={styles.hero__actions}>
                  <Link href="/leaderboard?period=season" className={clsx(styles.hero__button, styles['hero__button--primary'])}>
                    Earn points <ArrowRightIcon size={16} aria-hidden="true" />
                  </Link>
                </div>
                <p className={styles.hero__note}>Fixed supply. No VC round. Revenue-funded buybacks.</p>
              </div>
              <div className={styles.hero__visual} aria-hidden="true">
                <Image
                  src="/token/hup-chrome.png"
                  alt=""
                  width={1254}
                  height={1254}
                  sizes="(max-width: 760px) 85vw, 440px"
                  className={styles.hero__artwork}
                />
              </div>
            </header>

            <aside className={styles.beta} aria-label="Beta notice">
              <span className={styles.beta__tag}>Beta</span>
              <p className={styles.beta__text}>
                We&apos;re still updating this page and the plan behind it. Numbers, rules and dates can change before launch; anything
                final is announced on Hup first.
              </p>
            </aside>

            <dl className={styles.metrics} aria-label="$HUP at a glance">
              <div className={styles.metrics__item}>
                <dt>Total supply</dt>
                <dd>
                  {supply}
                  <span>$HUP</span>
                </dd>
              </div>
              <div className={styles.metrics__item}>
                <dt>For the community</dt>
                <dd>
                  {communityShare}
                  <span>% of supply</span>
                </dd>
              </div>
              <div className={styles.metrics__item}>
                <dt>Protocol fees to buybacks</dt>
                <dd>
                  {HUP_TOKEN.buybackShare * 100}
                  <span>%</span>
                </dd>
              </div>
            </dl>

            <section className={styles.principles} aria-label="Principles">
              {PRINCIPLES.map(({ icon: Icon, title, text }) => (
                <Rise key={title} className={styles.principles__item}>
                  <Icon size={24} className={styles.principles__icon} aria-hidden="true" />
                  <h2 className={styles.principles__title}>{title}</h2>
                  <p className={styles.principles__text}>{text}</p>
                </Rise>
              ))}
            </section>

            <section className={styles.section} aria-labelledby="token-utility">
              <h2 id="token-utility" className={styles.section__title}>
                What $HUP does
              </h2>
              <div className={clsx(styles.principles, styles['principles--three'])}>
                {UTILITY.map(({ icon: Icon, title, text }) => (
                  <div key={title} className={styles.principles__item}>
                    <Icon size={24} className={styles.principles__icon} aria-hidden="true" />
                    <h3 className={styles.principles__title}>{title}</h3>
                    <p className={styles.principles__text}>{text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="token-buybacks">
              <h2 id="token-buybacks" className={styles.section__title}>
                How buybacks work
              </h2>
              <ol className={styles.flow}>
                {FLOW.map(({ icon: Icon, title, text }, index) => (
                  <li key={title} className={styles.flow__step}>
                    <span className={styles.flow__number}>{index + 1}</span>
                    <Icon size={22} className={styles.flow__icon} aria-hidden="true" />
                    <h3 className={styles.flow__title}>{title}</h3>
                    <p className={styles.flow__text}>{text}</p>
                  </li>
                ))}
              </ol>
              <div className={styles.contracts}>
                <h3 className={styles.contracts__title}>Fee splitter contracts</h3>
                {splitters.length ? (
                  <ul className={styles.contracts__list}>
                    {splitters.map(([key, address]) => (
                      <li key={key}>
                        <span>{LAUNCH_CHAINS[key].name}</span>
                        <a href={`${LAUNCH_CHAINS[key].explorer}/address/${address}`} target="_blank" rel="noopener noreferrer">
                          <code>{address}</code>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.contracts__empty}>
                    Published here when the launchpad goes live on mainnet, so anyone can verify the buyback funds.
                  </p>
                )}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="token-tokenomics">
              <h2 id="token-tokenomics" className={styles.section__title}>
                Tokenomics
              </h2>
              <p className={styles.section__lede}>
                {supply} $HUP, {communityShare}% of it for the community. No investor allocation. Numbers can still change until launch.
              </p>
              <div
                className={styles.allocation__bar}
                role="img"
                aria-label={HUP_ALLOCATION.map((item) => `${item.bucket} ${item.share}%`).join(', ')}
              >
                {HUP_ALLOCATION.map((item, index) => (
                  <span key={item.bucket} className={styles.allocation__segment} data-index={index} style={{ flexGrow: item.share }} />
                ))}
              </div>
              <ul className={styles.allocation}>
                {HUP_ALLOCATION.map((item, index) => (
                  <li key={item.bucket} className={styles.allocation__row}>
                    <span className={styles.allocation__swatch} data-index={index} aria-hidden="true" />
                    <span className={styles.allocation__bucket}>{item.bucket}</span>
                    <span className={styles.allocation__unlock}>{item.unlock}</span>
                    <span className={styles.allocation__share}>
                      <strong>{item.share}%</strong>
                      <small>{compact.format((HUP_TOKEN.totalSupply * item.share) / 100)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section} aria-labelledby="token-airdrops">
              <h2 id="token-airdrops" className={styles.section__title}>
                Airdrops
              </h2>
              <div className={styles.airdrop}>
                <div className={styles.airdrop__stat}>
                  <strong>{airdropShare}%</strong>
                  <span>of the supply, given away in seasons</span>
                </div>
                <ol className={styles.airdrop__seasons}>
                  <li className={clsx(styles.airdrop__season, styles['airdrop__season--live'])}>
                    <h3>Season 1 · live</h3>
                    <p>Runs until the token launch. The snapshot date is announced 2 weeks ahead, and Season 1 is paid at launch.</p>
                  </li>
                  <li className={styles.airdrop__season}>
                    <h3>Later seasons</h3>
                    <p>More rounds after launch, so new members can still earn.</p>
                  </li>
                </ol>
                <p className={styles.airdrop__rules}>
                  Points come from your Hup activity and the coins you launch, never from trading, and count once your profile is 7 days
                  old. <Link href="/leaderboard?period=season">See your points</Link>
                </p>
                <div className={styles.boosts}>
                  <h3 className={styles.boosts__title}>Achievements boost your points</h3>
                  <ul className={styles.boosts__list}>
                    {achievementBoosts.map((boost) => (
                      <li key={boost.id}>
                        <span>{boost.name}</span>
                        <strong>{boost.label}</strong>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.boosts__note}>
                    Bonuses only top up wallets active in the season. Team-granted achievements add at most {ACHIEVEMENT_GRANTED_CAP} points
                    a season together. <Link href="/achievements">All achievements</Link>
                  </p>
                </div>
              </div>
            </section>

            <section className={styles.section} aria-labelledby="token-sale">
              <h2 id="token-sale" className={styles.section__title}>
                Public sale
              </h2>
              <p className={styles.section__lede}>
                {saleShare}% of the supply ({compact.format((HUP_TOKEN.totalSupply * saleShare) / 100)} $HUP) is sold at launch on{' '}
                {sale.platform}, {sale.platformNote}. Everyone pays the same price: there is no private round in front of you.
              </p>
              <ol className={styles.sale}>
                {sale.steps.map((step, index) => (
                  <li key={step.title} className={styles.sale__step}>
                    <span className={styles.sale__number}>{index + 1}</span>
                    <h3 className={styles.sale__title}>{step.title}</h3>
                    <p className={styles.sale__text}>{step.text}</p>
                  </li>
                ))}
              </ol>
              <dl className={styles.terms}>
                <div>
                  <dt>Paid in</dt>
                  <dd>{sale.currency}</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>{saleTerm(sale.price)}</dd>
                </div>
                <div>
                  <dt>Opens</dt>
                  <dd>{saleTerm(sale.opensAt)}</dd>
                </div>
                <div>
                  <dt>Per-person cap</dt>
                  <dd>{saleTerm(sale.perPersonCap)}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.section} aria-labelledby="token-targets">
              <h2 id="token-targets" className={styles.section__title}>
                Targets before launch
              </h2>
              <p className={styles.section__lede}>$HUP launches when Hup reaches these, not on a date picked in advance.</p>
              <ul className={styles.targets}>
                {HUP_LAUNCH_TARGETS.map((target) => (
                  <li key={target.label} className={styles.targets__item}>
                    <strong className={styles.targets__value}>{target.value}</strong>
                    <span className={styles.targets__label}>{target.label}</span>
                    <p className={styles.targets__text}>{target.text}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section} aria-labelledby="token-roadmap">
              <h2 id="token-roadmap" className={styles.section__title}>
                Roadmap
              </h2>
              <ol className={styles.roadmap}>
                {ROADMAP.map((phase) => (
                  <li key={phase.title} className={clsx(styles.roadmap__phase, phase.live && styles['roadmap__phase--live'])}>
                    <span className={styles.roadmap__when}>{phase.when}</span>
                    <h3 className={styles.roadmap__title}>{phase.title}</h3>
                    <p className={styles.roadmap__text}>{phase.text}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section className={styles.section} aria-labelledby="token-safeguards">
              <h2 id="token-safeguards" className={styles.section__title}>
                Safeguards
              </h2>
              <ul className={styles.safeguards}>
                {SAFEGUARDS.map((line) => (
                  <li key={line}>
                    <ShieldCheckIcon size={18} className={styles.safeguards__icon} aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section} aria-labelledby="token-faq">
              <h2 id="token-faq" className={styles.section__title}>
                Questions
              </h2>
              <div className={styles.faq}>
                {FAQ.map(({ q, a }, index) => (
                  <details key={q} className={styles.faq__item} open={index === 0}>
                    <summary>
                      {q}
                      <span aria-hidden="true">+</span>
                    </summary>
                    <p>{a}</p>
                  </details>
                ))}
              </div>
            </section>

            <footer className={styles.closing}>
              <span className={styles.closing__eyebrow}>Your part starts here</span>
              <h2 className={styles.closing__title}>Be part of what comes next.</h2>
              <p>Season 1 is live. Put your activity on Hup toward the first $HUP airdrop.</p>
              <Link href="/leaderboard?period=season" className={clsx(styles.hero__button, styles['hero__button--primary'])}>
                Explore the points season <ArrowRightIcon size={16} aria-hidden="true" />
              </Link>
            </footer>
          </div>
        </div>
      </div>
    </>
  )
}
