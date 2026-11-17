// Public build marker shown in the app; docs/ZALO_LIVE_DATA.md and README cite it.
// LIVE-20261106.1: lunch/breakfast check-in exemptions and neutral unknown meal states.
// LIVE-20261116.1: use server claim status and preserve post-confirmation login errors.
// LIVE-20261116.2: transfer the link request from the website into Zalo.
// LIVE-20261116.3: open the verification website and expose a browser fallback.
// LIVE-20261117.1: link by a code sent to the school email; silent sign-in inside Zalo;
//   explain unregistered months in the history (the API now applies own check-in exemptions).
export const ACCOUNT_LINK_BUILD = 'LIVE-20261117.1';
