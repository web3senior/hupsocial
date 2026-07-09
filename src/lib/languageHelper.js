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