const prefix = process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX || ''

export const CHAT_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const chatLocalStorageBurnerKey = `${prefix}chat_burner_key`
export const chatLocalStorageBurnerAddress = `${prefix}chat_burner_address`
export const chatSessionStorageUnlockedKey = `${prefix}chat_unlocked_burner_key`
