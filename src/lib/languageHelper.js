// ■■■ Language Detection Utilities ■■■

// Evaluate text composition to determine if language is predominantly English
export const checkIsEnglish = (text) => {
  if (!text || text.trim().length < 4) return true

  // Non-Latin scripts and accented letters (Cyrillic, CJK, Arabic, French/Spanish/etc.
  // diacritics...) are a much stronger signal of a foreign language than word lists,
  // and catch it regardless of message length. Test for actual letters (not emoji,
  // which are non-ASCII symbols, not letters) so emoji-only posts aren't misflagged.
  const nonAsciiChars = text.replace(/[\x00-\x7F]/g, '')
  if (nonAsciiChars && /\p{L}/u.test(nonAsciiChars)) return false

  // Comprehensive dictionary tracking structural, conversational, and platform slang patterns
  const englishStopWords = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    'how', 'your', 'is', 'am', 'are', 'was', 'were', 'has', 'had', 'just', 'now',

    // Social media expressions, web3 phrasing, and platform context
    'sup', 'hup', 'hups', 'gm', 'gn', 'hey', 'hi', 'hello', 'yo', 'fren', 'frens',

    // Common interface nouns and social interactions
    'nice', 'cool', 'great', 'awesome', 'good', 'love', 'like', 'badge', 'post',
    'feed', 'profile', 'wallet', 'chain', 'crypto', 'app', 'user', 'fren', 'frens'
  ])

  const tokens = text.toLowerCase().match(/\b[a-z]+\b/g) || []
  // No recognizable words (emoji, numbers, punctuation only) means there's nothing to
  // translate, not evidence of a foreign language
  if (tokens.length === 0) return true

  const matchCount = tokens.filter(token => englishStopWords.has(token)).length
  const ratio = matchCount / tokens.length

  // Short, all-ASCII messages are ambiguous (slang, names, captions) rather than proof
  // of a foreign language once a non-Latin script is already ruled out, so default to English
  if (tokens.length <= 5) return true

  // Affirm English classification if density matches threshold
  return ratio > 0.15
}

// ■■■ Translation Target Catalogue ■■■

export const DEFAULT_TRANSLATION_LANGUAGE = 'en'

// Languages a reader can have posts translated into, as accepted by the translation
// endpoint, sorted by English name. The names are static rather than derived from
// Intl.DisplayNames on purpose: browsers only carry display data for the locales they
// ship, so Chrome renders Armenian as "Armenian" where Node renders "հայերեն" — which
// both defeats the point of an endonym and breaks hydration on this list.
export const TRANSLATION_LANGUAGES = [
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans' },
  { code: 'sq', name: 'Albanian', nativeName: 'shqip' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hy', name: 'Armenian', nativeName: 'հայերեն' },
  { code: 'az', name: 'Azerbaijani', nativeName: 'azərbaycan' },
  { code: 'bn', name: 'Bangla', nativeName: 'বাংলা' },
  { code: 'eu', name: 'Basque', nativeName: 'euskara' },
  { code: 'be', name: 'Belarusian', nativeName: 'беларуская' },
  { code: 'bs', name: 'Bosnian', nativeName: 'bosanski' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'български' },
  { code: 'my', name: 'Burmese', nativeName: 'မြန်မာ' },
  { code: 'ca', name: 'Catalan', nativeName: 'català' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '中文（简体）' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '中文（繁體）' },
  { code: 'hr', name: 'Croatian', nativeName: 'hrvatski' },
  { code: 'cs', name: 'Czech', nativeName: 'čeština' },
  { code: 'da', name: 'Danish', nativeName: 'dansk' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'et', name: 'Estonian', nativeName: 'eesti' },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino' },
  { code: 'fi', name: 'Finnish', nativeName: 'suomi' },
  { code: 'fr', name: 'French', nativeName: 'français' },
  { code: 'gl', name: 'Galician', nativeName: 'galego' },
  { code: 'ka', name: 'Georgian', nativeName: 'ქართული' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'ha', name: 'Hausa', nativeName: 'Hausa' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'hu', name: 'Hungarian', nativeName: 'magyar' },
  { code: 'is', name: 'Icelandic', nativeName: 'íslenska' },
  { code: 'id', name: 'Indonesian', nativeName: 'Indonesia' },
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge' },
  { code: 'it', name: 'Italian', nativeName: 'italiano' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'jv', name: 'Javanese', nativeName: 'Jawa' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'kk', name: 'Kazakh', nativeName: 'қазақ тілі' },
  { code: 'km', name: 'Khmer', nativeName: 'ខ្មែរ' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'ku', name: 'Kurdish', nativeName: 'Kurdî' },
  { code: 'ky', name: 'Kyrgyz', nativeName: 'кыргызча' },
  { code: 'lo', name: 'Lao', nativeName: 'ລາວ' },
  { code: 'lv', name: 'Latvian', nativeName: 'latviešu' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'lietuvių' },
  { code: 'mk', name: 'Macedonian', nativeName: 'македонски' },
  { code: 'ms', name: 'Malay', nativeName: 'Melayu' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'mn', name: 'Mongolian', nativeName: 'монгол' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली' },
  { code: 'no', name: 'Norwegian', nativeName: 'norsk' },
  { code: 'ps', name: 'Pashto', nativeName: 'پښتو' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی' },
  { code: 'pl', name: 'Polish', nativeName: 'polski' },
  { code: 'pt', name: 'Portuguese', nativeName: 'português' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'ro', name: 'Romanian', nativeName: 'română' },
  { code: 'ru', name: 'Russian', nativeName: 'русский' },
  { code: 'sr', name: 'Serbian', nativeName: 'српски' },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල' },
  { code: 'sk', name: 'Slovak', nativeName: 'slovenčina' },
  { code: 'sl', name: 'Slovenian', nativeName: 'slovenščina' },
  { code: 'so', name: 'Somali', nativeName: 'Soomaali' },
  { code: 'es', name: 'Spanish', nativeName: 'español' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
  { code: 'sv', name: 'Swedish', nativeName: 'svenska' },
  { code: 'tg', name: 'Tajik', nativeName: 'тоҷикӣ' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'tk', name: 'Turkmen', nativeName: 'türkmen dili' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'українська' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'uz', name: 'Uzbek', nativeName: 'o‘zbek' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'cy', name: 'Welsh', nativeName: 'Cymraeg' },
  { code: 'yo', name: 'Yoruba', nativeName: 'Èdè Yorùbá' },
  { code: 'zu', name: 'Zulu', nativeName: 'isiZulu' },
]

const languagesByCode = new Map(TRANSLATION_LANGUAGES.map((language) => [language.code, language]))

export const TRANSLATION_LANGUAGE_CODES = TRANSLATION_LANGUAGES.map((language) => language.code)

/**
 * Look a language code up in the catalogue, falling back to the raw code so a stale
 * stored preference still renders something readable.
 * @param {string} code
 * @returns {{code: string, name: string, nativeName: string}}
 */
export const getLanguageLabel = (code) => languagesByCode.get(code) ?? { code, name: code, nativeName: code }

/**
 * Whether a post is worth offering a translation for. The detector above is a binary
 * English / not-English test, so it can only rule out the one certain no-op: an English
 * post for a reader who already reads English. Against any other target it cannot tell
 * the post's language apart from "not English", so the offer stands — translating text
 * into the language it is already in simply returns it unchanged.
 * @param {string} text
 * @param {string} targetLang
 */
export const shouldOfferTranslation = (text, targetLang) => {
  if (!text) return false
  if (targetLang === 'en') return !checkIsEnglish(text)
  return true
}