const TICKER_MAP = {
  LYX: { blockchain: 'Lukso', address: '0x000...000' },
  ETH: { blockchain: 'Ethereum', address: '0x000...000' },
  // ... add others
};

export function getAssetBySymbol(symbol) {
  return TICKER_MAP[symbol] || null;
}

export function getAllSymbols() {
  return Object.keys(TICKER_MAP);
}