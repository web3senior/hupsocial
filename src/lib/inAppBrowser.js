/**
 * @file lib/inAppBrowser.js
 * @description Whether the page runs inside an iOS app's own web view (a wallet's dApp browser,
 * such as the Universal Profile app) rather than Safari or another browser.
 */

/**
 * Safari, Chrome and Firefox on iOS all carry the Safari token; a WKWebView an app embeds does
 * not, unless the app dresses its user agent up as one, in which case a wallet's injected
 * window.lukso still gives it away. Such an app may float its own toolbar over the page just above
 * the keyboard, where no viewport API reports it.
 * @returns {boolean}
 */
export const isIosAppWebView = () => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS asks for desktop pages under a Mac user agent; only the touch points tell it apart
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  return isIos && (!/Safari\//.test(ua) || Boolean(window.lukso))
}
