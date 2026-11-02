/**
 * @file lib/botAvatarNetworks.js
 * @description Network logos for the robot avatar's chest badge (lib/botAvatar.js), inlined from
 * public/networks/*.svg. They have to live in the SVG itself: a robot is shown as an <img> data URI,
 * and an SVG loaded that way cannot fetch other files. Clip paths are dropped — the badge clips to
 * a circle — so no id inside can collide with the robot's own.
 *
 * `background` fills the badge behind logos that have no square of their own.
 */

export const BOT_NETWORK_BADGES = Object.freeze({
  lukso: {
    label: 'LUKSO',
    viewBox: '0 0 32 32',
    background: '#ffffff',
    inset: 5,
    markup:
      '<path d="M27.66 6.06 18.33.71a5.33 5.33 0 0 0-5.34 0L3.67 6.06A5.33 5.33 0 0 0 1 10.65v10.69c0 1.9 1.02 3.65 2.67 4.6l9.32 5.35c1.65.95 3.69.95 5.34 0l9.32-5.35a5.33 5.33 0 0 0 2.67-4.6V10.65c0-1.9-1.01-3.64-2.66-4.6ZM23.06 17.06l-2.77 4.77a2.12 2.12 0 0 1-1.85 1.06h-5.55c-.76 0-1.47-.4-1.85-1.06l-2.78-4.77a2.12 2.12 0 0 1 0-2.12l2.77-4.77c.38-.66 1.09-1.06 1.85-1.06h5.55c.76 0 1.47.4 1.85 1.06l2.77 4.77c.39.66.39 1.46.01 2.12Z" fill="#FE005B"/>',
  },
  ethereum: {
    label: 'Ethereum',
    viewBox: '0 0 32 32',
    markup:
      '<rect width="32" height="32" fill="#627EEA"/><path d="M16 6v7.39l6.25 2.8L16 6Z" fill="#fff" fill-opacity=".6"/><path d="M16 6 9.75 16.19 16 13.39V6Z" fill="#fff"/><path d="M16 20.98V26l6.25-8.65L16 20.98Z" fill="#fff" fill-opacity=".6"/><path d="M16 26v-5.02l-6.25-3.63L16 26Z" fill="#fff"/><path d="m16 19.81 6.25-3.63L16 13.4v6.41Z" fill="#fff" fill-opacity=".2"/><path d="M9.75 16.19 16 19.81V13.4l-6.25 2.79Z" fill="#fff" fill-opacity=".6"/>',
  },
  base: {
    label: 'Base',
    viewBox: '0 0 32 32',
    markup:
      '<rect width="32" height="32" fill="#0052FF"/><path d="M15.98 26a10 10 0 1 0-9.96-10.84h14.84v1.66H6.02A10 10 0 0 0 15.98 26Z" fill="#fff" fill-rule="evenodd"/>',
  },
  bnb: {
    label: 'BNB Chain',
    viewBox: '0 0 32 32',
    markup:
      '<rect width="32" height="32" fill="#F0B90B"/><path d="m9.41 16 .01 3.87 3.29 1.93v2.27l-5.21-3.06v-6.14L9.41 16Zm0-3.87v2.26l-1.91-1.14V11l1.91-1.13L11.33 11l-1.92 1.13Zm4.67-1.13L16 9.87 17.92 11 16 12.13 14.08 11Z" fill="#fff"/><path d="M10.79 19.07V16.8l1.92 1.13v2.26l-1.92-1.12Zm3.29 3.54L16 23.75l1.92-1.14v2.26L16 26l-1.92-1.13v-2.26ZM20.66 11l1.92-1.13L24.5 11v2.25l-1.92 1.14v-2.26L20.66 11Zm1.92 8.87.01-3.87 1.91-1.13v6.14l-5.21 3.06V21.8l3.29-1.93Z" fill="#fff"/><path d="m21.21 19.07-1.92 1.12v-2.26l1.92-1.13v2.27Z" fill="#fff"/><path d="m21.21 12.93.01 2.27-3.3 1.93v3.88L16 22.13l-1.91-1.12v-3.88l-3.3-1.93v-2.27l1.92-1.13L16 13.74l3.29-1.94 1.92 1.13ZM10.79 9.07 16 6l5.21 3.07-1.92 1.13L16 8.26l-3.29 1.94-1.92-1.13Z" fill="#fff"/>',
  },
  arbitrum: {
    label: 'Arbitrum',
    viewBox: '0 0 32 32',
    markup:
      '<rect width="32" height="32" fill="#213147"/><path d="m16.05 18.91 2.76 4.33 2.55-1.48-3.62-5.71-1.69 2.86Z" fill="#12AAFF"/><path d="M23.68 20.02v-1.18l-3.96-6.17-1.47 2.49 3.82 6.18 1.38-.8c.14-.11.22-.27.23-.45v-.07Z" fill="#12AAFF"/><path d="m7.09 21.14 1.95 1.12 6.5-10.41-1.1-.03c-.94-.01-1.95.23-2.42.99l-3.69 5.71-1.24 1.91v.71Z" fill="#fff"/><path d="m19.29 11.85-2.91.01-6.57 10.84 2.3 1.32.62-1.06 6.56-11.11Z" fill="#fff"/><path d="M24.91 11.83a2.08 2.08 0 0 0-.87-1.49L16.82 6.2a2.12 2.12 0 0 0-1.66 0l-7.02 4.07c-.1.05-.19.1-.28.16-.46.33-.74.84-.77 1.4v8.6l1.24-1.9-.01-6.64.01-.07a.62.62 0 0 1 .25-.39l7.13-4.13c.17-.08.38-.08.55 0l7.12 4.1c.17.1.28.29.29.49v8.22a.65.65 0 0 1-.21.45l-1.39.8-.71.41-2.55 1.48-2.58 1.5c-.14.05-.3.05-.44-.01l-3.06-1.76-.62 1.06 2.75 1.58.24.14.2.11c.2.09.48.15.73.15.23 0 .46-.04.67-.13l7.51-4.35c.43-.33.68-.84.71-1.38v-8.31Z" fill="#9DCCED"/>',
  },
  polygon: {
    label: 'Polygon',
    viewBox: '-3 -4 16 16',
    background: '#ffffff',
    markup:
      '<path d="M0 6.56V3.68L2.8 2.19l.95.54v1.3l-.95-.53-1.55.79v1.6l1.55.82 1.58-.82V1.44L7.15 0 10 1.44v2.89L7.16 5.78l-.91-.53V3.96l.91.51 1.59-.8V2.1l-1.59-.8-1.54.8v4.47L2.8 8 0 6.56Z" fill="#6C00F6"/>',
  },
  monad: {
    label: 'Monad',
    viewBox: '0 0 32 32',
    markup:
      '<rect width="32" height="32" fill="#836EF9"/><path d="M16 6C13.11 6 6 13.11 6 16s7.11 10 10 10 10-7.11 10-10S18.89 6 16 6Zm-1.56 15.72c-1.22-.33-4.49-6.06-4.16-7.28.33-1.22 6.06-4.49 7.28-4.16 1.22.33 4.49 6.06 4.16 7.28-.33 1.22-6.06 4.49-7.28 4.16Z" fill="#FEFEFE"/>',
  },
  celo: {
    label: 'Celo',
    viewBox: '0 0 32 32',
    markup:
      '<rect width="32" height="32" fill="#FCFF52"/><path d="M24 24H8V8h16v5.59h-2.65a5.9 5.9 0 0 0-5.34-3.46 5.88 5.88 0 1 0 5.38 8.19H24V24Z" fill="#000" fill-rule="evenodd"/>',
  },
})
