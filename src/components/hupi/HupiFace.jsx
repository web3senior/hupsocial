import clsx from 'clsx'
import styles from './HupiFace.module.scss'

/**
 * @file components/hupi/HupiFace.jsx
 * @description Hupi's face, alive: public/hupi.svg drawn inline so its parts can move on their
 * own. It blinks and breathes at rest, perks its crown and glances toward the panel on hover,
 * and works its crown while Hupi is answering. Outlines draw in currentColor and the fills in
 * the surface colour, so it follows the theme without an invert filter.
 *
 * @param {Object} props
 * @param {'idle'|'thinking'} [props.mood='idle']
 * @param {boolean} [props.interactive=false] Reacts when its parent element is hovered — for
 *   the launcher, where the face is the button's whole content.
 * @param {number} [props.size=32] Width in px; the height follows the drawing's 62:56 shape.
 * @param {string} [props.className]
 */
export default function HupiFace({ mood = 'idle', interactive = false, size = 32, className }) {
  return (
    <svg
      viewBox="0 0 62 56"
      width={size}
      height={Math.round((size * 56) / 62)}
      fill="none"
      aria-hidden="true"
      className={clsx(styles.face, styles[`face--${mood}`], interactive && styles['face--interactive'], className)}
    >
      <g className={styles.face__head}>
        <g className={clsx(styles.face__spike, styles['face__spike--left'])}>
          <path
            d="M18.2579 20.0399L11.4297 19.743L5.41801 12.9891C5.07166 12.5933 4.99744 12.1232 5.19536 11.579L7.42192 5.93834C7.61984 5.44355 8.01567 5.29511 8.60942 5.49302L16.0313 7.94224C16.4766 8.09068 16.7982 8.46177 16.9961 9.05552L20.5586 19.8172L18.2579 20.0399Z"
            className={styles.face__ink}
          />
          <path
            d="M14.7488 12.0067C14.4004 11.4033 13.6288 11.1965 13.0253 11.5449C12.4218 11.8933 12.2151 12.665 12.5635 13.2685L14.9385 17.3821C15.2869 17.9856 16.0585 18.1923 16.662 17.8439C17.2655 17.4955 17.4723 16.7238 17.1238 16.1204L14.7488 12.0067Z"
            className={styles.face__paper}
          />
        </g>
        <g className={clsx(styles.face__spike, styles['face__spike--center'])}>
          <path
            d="M25.9767 19.7422L23.379 7.42188C23.2801 6.8776 23.4533 6.38281 23.8986 5.9375L29.7619 0.445312C30.3556 -0.148438 30.9494 -0.148438 31.5431 0.445312L37.4064 5.9375C37.8517 6.38281 38.0249 6.8776 37.9259 7.42188L35.3283 19.7422H25.9767Z"
            className={styles.face__ink}
          />
          <path
            d="M31.9141 7.49609C31.9141 6.79927 31.3492 6.23438 30.6523 6.23438C29.9555 6.23438 29.3906 6.79927 29.3906 7.49609V15.6602C29.3906 16.357 29.9555 16.9219 30.6523 16.9219C31.3492 16.9219 31.9141 16.357 31.9141 15.6602V7.49609Z"
            className={styles.face__paper}
          />
        </g>
        <g className={clsx(styles.face__spike, styles['face__spike--right'])}>
          <path
            d="M43.0469 20.0399L49.875 19.743L55.8867 12.9891C56.2331 12.5933 56.3073 12.1232 56.1094 11.579L53.8828 5.93834C53.6849 5.44355 53.2891 5.29511 52.6953 5.49302L45.2734 7.94224C44.8281 8.09068 44.5065 8.46177 44.3086 9.05552L40.7461 19.8172L43.0469 20.0399Z"
            className={styles.face__ink}
          />
          <path
            d="M48.741 13.2685C49.0894 12.665 48.8827 11.8933 48.2792 11.5449C47.6757 11.1965 46.9041 11.4033 46.5557 12.0067L44.1807 16.1204C43.8323 16.7238 44.039 17.4955 44.6425 17.8439C45.246 18.1923 46.0176 17.9856 46.366 17.3821L48.741 13.2685Z"
            className={styles.face__paper}
          />
        </g>

        <path
          d="M14.1758 21.207H47.1289C51.6896 21.207 55.3867 24.9042 55.3867 29.4648V46.832C55.3867 51.3927 51.6896 55.0898 47.1289 55.0898H14.1758C9.61512 55.0898 5.91797 51.3927 5.91797 46.832V29.4648C5.91797 24.9042 9.61512 21.207 14.1758 21.207Z"
          className={styles.face__shell}
        />
        <path
          d="M5.04688 29.6875H4.15625C1.86082 29.6875 0 31.5483 0 33.8438V40.5234C0 42.8189 1.86082 44.6797 4.15625 44.6797H5.04688C7.34231 44.6797 9.20312 42.8189 9.20312 40.5234V33.8438C9.20312 31.5483 7.34231 29.6875 5.04688 29.6875Z"
          className={styles.face__ink}
        />
        <path
          d="M57.1484 29.6875H56.2578C53.9624 29.6875 52.1016 31.5483 52.1016 33.8438V40.5234C52.1016 42.8189 53.9624 44.6797 56.2578 44.6797H57.1484C59.4439 44.6797 61.3047 42.8189 61.3047 40.5234V33.8438C61.3047 31.5483 59.4439 29.6875 57.1484 29.6875Z"
          className={styles.face__ink}
        />
        <path
          d="M46.5352 29.0195H14.7695C11.7363 29.0195 9.27734 31.4785 9.27734 34.5117V40.2266C9.27734 43.2598 11.7363 45.7188 14.7695 45.7188H46.5352C49.5684 45.7188 52.0273 43.2598 52.0273 40.2266V34.5117C52.0273 31.4785 49.5684 29.0195 46.5352 29.0195Z"
          className={styles.face__paper}
        />
        <path
          d="M4.67578 34.1406C4.67578 33.5258 4.17735 33.0273 3.5625 33.0273C2.94765 33.0273 2.44922 33.5258 2.44922 34.1406V40.375C2.44922 40.9898 2.94765 41.4883 3.5625 41.4883C4.17735 41.4883 4.67578 40.9898 4.67578 40.375V34.1406Z"
          className={styles.face__paper}
        />
        <path
          d="M58.8555 34.1406C58.8555 33.5258 58.357 33.0273 57.7422 33.0273C57.1273 33.0273 56.6289 33.5258 56.6289 34.1406V40.375C56.6289 40.9898 57.1273 41.4883 57.7422 41.4883C58.357 41.4883 58.8555 40.9898 58.8555 40.375V34.1406Z"
          className={styles.face__paper}
        />

        {/* Two groups so a glance (translate) and a blink (scale) never fight over one transform */}
        <g className={styles.face__look}>
          <g className={styles.face__blink}>
            <path
              d="M23.3789 35.2539C23.3789 34.1472 22.4817 33.25 21.375 33.25C20.2683 33.25 19.3711 34.1472 19.3711 35.2539V39.5586C19.3711 40.6653 20.2683 41.5625 21.375 41.5625C22.4817 41.5625 23.3789 40.6653 23.3789 39.5586V35.2539Z"
              className={styles.face__ink}
            />
            <path
              d="M42.2767 35.6343C42.4689 34.5443 41.7411 33.505 40.6512 33.3128C39.5613 33.1206 38.5219 33.8484 38.3298 34.9383L37.5823 39.1776C37.3901 40.2675 38.1178 41.3069 39.2077 41.499C40.2977 41.6912 41.337 40.9635 41.5292 39.8735L42.2767 35.6343Z"
              className={styles.face__ink}
            />
          </g>
        </g>

        <path d="M26.7188 49.5781C29.3411 51.5078 31.9635 51.5078 34.5859 49.5781" className={styles.face__smile} />
      </g>
    </svg>
  )
}
