'use client'

import { useState, useCallback } from 'react'
import { 
  HelpCircle, 
  ChevronDown, 
  MessageSquare, 
  Send, 
  LucideLoader2, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle as GuestIcon
} from 'lucide-react'
import { useConnection } from 'wagmi'
import { getViewerId } from '@/lib/viewer'
import styles from './HelpCenter.module.scss'

const FAQ_DATA = [
  {
    id: 'faq-1',
    question: 'What is hup.social?',
    answer: 'hup is a fully decentralized social protocol built on top of secure smart contract primitives. It gives users complete ownership over their content, identity graphs, and profiles across multiple EVM ecosystems.',
  },
  {
    id: 'faq-2',
    question: 'How do Universal Profiles work here?',
    answer: 'hup interfaces directly with modular smart contract identities (like LUKSO Standard Proposals). This allows your identity metadata, data keys, and contract relations to be entirely dynamic and client-agnostic.',
  },
  {
    id: 'faq-3',
    question: 'Why am I not seeing my latest actions updated instantly?',
    answer: 'While transaction state updates on-chain with block finality, indexing nodes extract and normalize data into our application database layer. Highly congested network status can occasionally experience brief replication delays.',
  },
  {
    id: 'faq-4',
    question: 'Are there gas fees for posting or interacting?',
    answer: 'Yes, because actions (such as posts, comments, or profile updates) live securely on-chain, transactions require network execution fees. However, ecosystem transaction relayers may subsidize execution metrics for compatible profiles.',
  }
]

export default function HelpCenter() {
  const { address, isConnected } = useConnection()
  const [openFaqId, setOpenFaqId] = useState(null)
  
  const [category, setCategory] = useState('general')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')

  const toggleFaq = useCallback((id) => {
    setOpenFaqId((current) => (current === id ? null : id))
  }, [])

  const handleSubmitTicket = async (e) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitStatus(null)
    setErrorMessage('')

    try {
      /* Resolve the user identity string using your viewer helper logic */
      const resolvedIdentifier = getViewerId(isConnected ? address : null)

      const response = await fetch('/api/v1/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: isConnected ? address : null,
          identifier: resolvedIdentifier,
          category,
          subject,
          message,
          email: email || null,
        }),
      })

      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to submit your support ticket.')
      }

      setSubmitStatus('success')
      setSubject('')
      setMessage('')
      setEmail('')
    } catch (err) {
      console.error('Support ticket handling failure:', err)
      setSubmitStatus('error')
      setErrorMessage(err.message || 'An unexpected error occurred.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h4>Help & Support Center</h4>
        <p>Find answers to common technical protocol questions or file a support request.</p>
      </header>

      <section className={styles.section}>
        <h2>
          <HelpCircle size={22} />
          Frequently Asked Questions
        </h2>
        <div className={styles.faqList}>
          {FAQ_DATA.map((faq) => {
            const isOpen = openFaqId === faq.id
            return (
              <div key={faq.id} className={styles.faqItem}>
                <button
                  type="button"
                  className={styles.faqQuestion}
                  onClick={() => toggleFaq(faq.id)}
                  aria-expanded={isOpen}
                  aria-controls={faq.id}
                >
                  <span>{faq.question}</span>
                  <ChevronDown size={18} />
                </button>
                {isOpen && (
                  <div id={faq.id} className={styles.faqAnswer}>
                    {faq.answer}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2>
          <MessageSquare size={22} />
          Submit a Support Ticket
        </h2>
        
        <form onSubmit={handleSubmitTicket} className={styles.ticketForm}>
          {isConnected ? (
            <div className={styles.walletHint}>
              Connected wallet <strong>{address.slice(0, 6)}...{address.slice(-4)}</strong> will be automatically attached to this support profile payload.
            </div>
          ) : (
            <div className={styles.walletHint}>
              <GuestIcon size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
              You are currently browsing as a guest. A secure visitor identity token will be assigned to track this ticket request.
            </div>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="category">Inquiry Type</label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={isSubmitting}
            >
              <option value="general">General Protocol Question</option>
              <option value="indexing">Profile Sync / Indexing Issue</option>
              <option value="transaction">On-Chain Transaction Problem</option>
              <option value="bug">Bug Report / App Error</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="email">Email Address (Optional)</label>
            <input
              type="email"
              id="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="subject">Subject</label>
            <input
              type="text"
              id="subject"
              placeholder="Brief description of the issue"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="message">Message Description</label>
            <textarea
              id="message"
              placeholder="Provide explicit operational details regarding your issue..."
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {submitStatus === 'success' && (
            <div className={`${styles.statusMessage} ${styles.success}`}>
              <CheckCircle2 size={18} />
              <span>Ticket successfully received. The team will analyze the telemetry.</span>
            </div>
          )}

          {submitStatus === 'error' && (
            <div className={`${styles.statusMessage} ${styles.error}`}>
              <AlertCircle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            className={styles.submitButton}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <LucideLoader2 className={styles.spin} size={18} />
                Submitting Ticket...
              </>
            ) : (
              <>
                <Send size={16} />
                Send Ticket
              </>
            )}
          </button>
        </form>
      </section>
    </div>
  )
}