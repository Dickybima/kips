// Tokens launched through KIPS that should not be listed (tests, mistakes).
// They stay on-chain and their token page still opens by address; they are
// only left out of Explore and the Home preview. Add addresses here, any case.
const HIDDEN = [
  "0x88B8824C22776f8fCef5993cDEC13693a0Cbf34A", // Atlas ($ATLAS), deploy test
];

const hidden = new Set(HIDDEN.map((a) => a.toLowerCase()));

export const isHidden = (token: string) => hidden.has(token.toLowerCase());
