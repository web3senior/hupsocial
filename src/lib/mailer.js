/**
 * @file lib/mailer.js
 * @description SMTP delivery for transactional email (OTP codes). Server-only.
 *
 * Provider-agnostic on purpose: any SMTP mailbox works (Gmail app password,
 * Resend, Brevo, ...) via the SMTP_* env vars, so swapping providers is an env
 * change, not a code change. With SMTP_HOST unset outside production the code
 * is logged to the server console instead — the login flow stays testable with
 * zero mail setup.
 */

import nodemailer from 'nodemailer'

const smtpConfigured = () => Boolean(process.env.SMTP_HOST)

// RFC 2606 reserved domains can never receive mail — attempting delivery just
// bounces back into our mailbox and burns the provider's hourly send quota
// (e2e suites address these constantly). Log instead of sending, everywhere.
const RESERVED_RECIPIENT = /@(example\.(com|net|org)|[^@]+\.(test|invalid|localhost))$/i

const deliverable = (to) => !RESERVED_RECIPIENT.test(String(to).trim())

// Cached on globalThis for the same reason as the DB pool: dev hot reloads
// must not stack up connection pools. Keyed on the SMTP config, because the
// dev server reloads .env in-process — a cache that ignores config would keep
// serving a transport built with superseded credentials.
const getTransport = () => {
  const port = parseInt(process.env.SMTP_PORT || '465')
  const fingerprint = [process.env.SMTP_HOST, port, process.env.SMTP_USER, process.env.SMTP_PASS].join(' ')

  const globalForMail = globalThis
  if (globalForMail.__hupMailTransport?.fingerprint === fingerprint) return globalForMail.__hupMailTransport.transport

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  if (process.env.NODE_ENV !== 'production') globalForMail.__hupMailTransport = { fingerprint, transport }
  return transport
}

const appName = () => process.env.NEXT_PUBLIC_NAME || 'Hup'

const sendCodeMail = async (to, code, { subject, heading }) => {
  if (!smtpConfigured() || !deliverable(to)) {
    if (!smtpConfigured() && process.env.NODE_ENV === 'production') throw new Error('SMTP is not configured')
    console.log(`[EMAIL_LOGIN] OTP for ${to}: ${code}`)
    return
  }

  await getTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text: `${heading}: ${code}. It expires in 10 minutes. If you didn't request it, ignore this email.`,
    html: `
      <div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px;">${heading}</h2>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 0 0 16px;">${code}</p>
        <p style="color: #666; margin: 0;">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
      </div>
    `,
  })
}

/**
 * Send a login code. Throws on delivery failure so the route can answer 502
 * rather than letting the user wait on a code that never left.
 * @param {string} to
 * @param {string} code six digits
 */
export const sendOtpEmail = (to, code) =>
  sendCodeMail(to, code, {
    subject: `${code} is your ${appName()} login code`,
    heading: `${appName()} login code`,
  })

/** Verification code for attaching a notification email to a profile. */
export const sendEmailVerifyCode = (to, code) =>
  sendCodeMail(to, code, {
    subject: `${code} — verify your email for ${appName()} notifications`,
    heading: `Verify your notification email`,
  })
