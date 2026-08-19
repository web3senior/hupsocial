// Sidebar sections: one nav row standing in for several routes that share an
// intent. The sidebar (stores/useSidebarStore) builds its schema from this and
// SectionTabs draws the strip on each member page, so a route can never be
// reachable from the tabs but missing from the nav's active state, or vice versa.
export const SECTIONS = {
  // Things other people put up for sale: listed posts, the NFT market grid, new mints.
  bazaar: {
    id: 'bazaar',
    name: 'Bazaar',
    tabs: [
      { id: 'nfts', label: 'NFTs', path: '/nfts' },
      // "Posts", not "Bazaar" — a Bazaar tab inside a Bazaar section reads as a loop
      { id: 'posts', label: 'Posts', path: '/bazaar' },
      { id: 'drops', label: 'Drops', path: '/drops' },
    ],
  },
  // Positions you take with fungible value — swapping, launching, OTC, prediction markets.
  trade: {
    id: 'trade',
    name: 'Trade',
    tabs: [
      { id: 'swap', label: 'Swap', path: '/swap' },
      { id: 'tokens', label: 'Tokens', path: '/launches' },
      { id: 'p2p', label: 'P2P', path: '/p2p' },
      { id: 'predict', label: 'Predict', path: '/predict' },
    ],
  },
}

// Every route a section owns, for the sidebar row's multi-path active state
export const sectionPaths = (section) => section.tabs.map((tab) => tab.path)

// Where the sidebar row lands. Derived from the first tab rather than written out, so
// reordering the tabs above can't leave the nav pointing into the middle of the strip.
export const sectionLanding = (section) => section.tabs[0].path
