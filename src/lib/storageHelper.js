/**
 * Utility helper to handle 0G Storage asset resolution and cache tracking.
 */

// Simple local cache to keep track of already resolved 0G blob URLs across components
const ogCache = new Map();

/**
 * Checks if a given string is a 0G Storage root hash.
 * @param {string} src - The image path or hash string.
 * @returns {boolean}
 */
export const is0GHash = (src) => {
  return typeof src === 'string' && src.startsWith('0x');
};

/**
 * Safely downloads a 0G asset via the backend proxy and returns a browser Object URL.
 * @param {string} hash - The 0G root hash.
 * @returns {Promise<string|null>} Resolves to a blob URL, or null if it fails.
 */
export const resolve0GUrl = async (hash) => {
  if (!hash || !is0GHash(hash)) return null;

  // Return from local memory if we've already fetched this asset in the current session
  if (ogCache.has(hash)) {
    return ogCache.get(hash);
  }

  try {
    const res = await fetch(`/api/0g/download?hash=${hash}`);
    if (!res.ok) throw new Error(`Failed to download 0G asset: ${res.statusText}`);

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    // Save to cache so other components displaying this user's avatar don't re-download it
    ogCache.set(hash, objectUrl);
    return objectUrl;
  } catch (error) {
    console.error('Error resolving 0G asset URL:', error);
    return null;
  }
};

/**
 * Manages the explicit lifecycle clean-up of generated 0G object URLs.
 * Use this to completely wipe the active cache and clear memory instances if needed.
 */
export const clear0GCache = () => {
  ogCache.forEach((objectUrl) => {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.error('Error revoking object URL:', e);
    }
  });
  ogCache.clear();
};