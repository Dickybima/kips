// The official $KIPS token on Robinhood Chain, featured at the top of Explore.
export const OFFICIAL_TOKEN = "0xd1F91331F3c9CE8b4C4E265392c27Afb90a7f82C" as const;

export const isOfficial = (token: string) => token.toLowerCase() === OFFICIAL_TOKEN.toLowerCase();
