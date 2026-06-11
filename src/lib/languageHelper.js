// Evaluate text composition to determine if language is predominantly English
export const checkIsEnglish = (text) => {
  if (!text || text.trim().length < 4) return true

  // Utilize common English stop words to build a lightweight, instant classification profile
  const englishStopWords = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at'
  ])

  const tokens = text.toLowerCase().match(/\b[a-z]+\b/g) || []
  if (tokens.length === 0) return false

  const matchCount = tokens.filter(token => englishStopWords.has(token)).length
  const ratio = matchCount / tokens.length

  // Affirm English classification if density or base structural match matches thresholds
  return ratio > 0.15 || (tokens.length <= 5 && matchCount >= 1)
}