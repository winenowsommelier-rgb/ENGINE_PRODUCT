// Name-based allow-list of distilleries whose whiskies are reliably peated/smoky.
// WHY a name allow-list (spec §11.8): the export tags some genuinely-smoky whiskies
// smokiness='none' (VERIFIED false-negatives: Talisker 10/14, Ledaig). The old peat
// logic guessed from region=Islay, which both missed non-Islay peated malts (Talisker
// = Skye, Ledaig = Mull) and mislabelled clean Islay bottles. This list is a POSITIVE
// signal only — used to BOOST a smoky-seeker's match, never to exclude.
const PEATED = ['talisker','ledaig','laphroaig','ardbeg','lagavulin','caol ila','kilchoman','octomore','bowmore','bunnahabhain'];

export function isLikelyPeated(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return PEATED.some(d => n.includes(d));
}
