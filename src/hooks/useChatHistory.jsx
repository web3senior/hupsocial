import useSWR from 'swr';
import { unlockAppKeyFromStorage,APP_PASSWORD_SESSION_STORAGE } from '@/lib/appVault';

  const getUnlockedKey = async () => {
    try {
      const unlocked = await unlockAppKeyFromStorage()
      if (!unlocked) {
        sessionStorage.removeItem(APP_PASSWORD_SESSION_STORAGE)
        return null
      }
      return unlocked
    } catch (error) {
      sessionStorage.removeItem(APP_PASSWORD_SESSION_STORAGE)
      router.push('/unlock')
      return null
    }
  }
export function useChatHistory(receiverAddress, contacts, { publicClient, tunnelAddress, address }) {
  
  const fetcher = async () => {
    // 1. Fetch keys INSIDE the fetcher
    const keys = await getUnlockedKey();
    
    // 2. Guard clauses
    if (!keys || !publicClient || !tunnelAddress || !address || !receiverAddress) return [];
    
    const friend = contacts.find((c) => c.contactAddress.toLowerCase() === receiverAddress.toLowerCase());
    if (!friend) return [];

    // ... (Your existing logic: deriveRoomFromPeerKey, fetch history, decrypt) ...
    // Note: Use 'keys' variable here
    
    return decryptedList;
  };

  return useSWR(
    receiverAddress ? ['chat-history', receiverAddress] : null,
    fetcher,
    {
      refreshInterval: 5000,
      dedupingInterval: 3000,
      revalidateOnFocus: false,
    }
  );
}