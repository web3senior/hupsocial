// Evaluate text composition to determine if language is predominantly English
export const checkIsEnglish = (text) => {
  if (!text || text.trim().length < 4) return true

  // Expanded dictionary to seamlessly catch conversational phrasing, questions, and short updates
  const englishStopWords = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    'how', 'your', 'is', 'am', 'are', 'was', 'were', 'has', 'had', 'just', 'now'
  ])

  const tokens = text.toLowerCase().match(/\b[a-z]+\b/g) || []
  if (tokens.length === 0) return false

  const matchCount = tokens.filter(token => englishStopWords.has(token)).length
  const ratio = matchCount / tokens.length

  // Affirm English classification if density or base structural match matches thresholds
  return ratio > 0.15 || (tokens.length <= 5 && matchCount >= 1)
}