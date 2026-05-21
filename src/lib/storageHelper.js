/**
 * Utility helper to handle 0G Storage asset routing.
 */

/**
 * Checks if a given string is a 0G Storage root hash.
 * @param {string} src - The image path or hash string.
 * @returns {boolean}
 */
export const is0GHash = (src) => {
  return typeof src === 'string' && src.startsWith('0x');
};

/**
 * Resolves a 0G root hash to a direct backend streaming proxy endpoint.
 * @param {string} hash - The 0G root hash.
 * @returns {string|null} The API proxy endpoint URL, or null if invalid.
 */
export const resolve0GUrl = (hash) => {
  if (!hash || !is0GHash(hash)) return null;

  // Point directly to the API endpoint to leverage native browser streaming and caching
  return `/api/0g/download?hash=${hash}`;
};