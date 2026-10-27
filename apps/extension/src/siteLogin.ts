import type { Platform } from './types';

/**
 * Whether the browser is signed in to each platform, read with the browser's
 * own cookies from pages the extension may already access. The extension
 * never sees or stores platform credentials; signing in happens on the site.
 */
export type SiteLoginState = { platform: Platform; state: 'SIGNED_IN' | 'SIGNED_OUT' | 'UNKNOWN'; name?: string; loginUrl: string; siteUrl: string };

export const SITE_LOGIN_PAGES: Record<Platform, { loginUrl: string; siteUrl: string; probeUrl: string }> = {
  JUNGOL: { loginUrl: 'https://jungol.co.kr/auth/signin', siteUrl: 'https://jungol.co.kr/', probeUrl: 'https://jungol.co.kr/' },
  SWEA: { loginUrl: 'https://swexpertacademy.com/main/identity/anonymous/loginPage.do', siteUrl: 'https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do',
    probeUrl: 'https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do' },
  PROGRAMMERS: { loginUrl: 'https://programmers.co.kr/account/sign_in?referer=https%3A%2F%2Fschool.programmers.co.kr%2Flearn%2Fchallenges',
    siteUrl: 'https://school.programmers.co.kr/learn/challenges', probeUrl: 'https://school.programmers.co.kr/learn/courses/30/lessons/42576' },
};

const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** Jungol's home page links the signed-in user's own rank card, or the sign-in page for a visitor. */
export function jungolLoginState(html: string): SiteLoginState['state'] {
  const signInLink = /href="\/auth\/signin/.test(html);
  if (/href="\/account\/\d{1,40}"/.test(html) && !signInLink) return 'SIGNED_IN';
  return signInLink ? 'SIGNED_OUT' : 'UNKNOWN';
}

/**
 * SWEA redirects a signed-out visit of the own submission list to its login
 * page, so reaching the list means signed in; the nickname is shown if found.
 */
export function sweaLoginState(responseUrl: string, html: string, ok = true): { state: SiteLoginState['state']; name?: string } {
  let path = '';
  try { path = new URL(responseUrl).pathname; } catch { return { state: 'UNKNOWN' }; }
  if (path === '/main/identity/anonymous/loginPage.do') return { state: 'SIGNED_OUT' };
  if (!ok || path !== '/main/userpage/code/userSubmitProblem.do') return { state: 'UNKNOWN' };
  const nickname = [...html.matchAll(/class="([^"]*)"[^>]*>\s*([^<]{1,80}?)\s*</g)].find(match => ['name', 'hidden-sm-down'].every(token => match[1]!.split(/\s+/).includes(token)))?.[2];
  const name = decode(nickname ?? '');
  return name ? { state: 'SIGNED_IN', name } : { state: 'SIGNED_IN' };
}

/** Programmers fills data-user-id on a lesson page only for a signed-in user. */
export function programmersLoginState(html: string): SiteLoginState['state'] {
  const ids = [...html.matchAll(/data-user-id="([^"]*)"/g)].map(match => match[1]!);
  if (ids.some(id => /^\d{1,40}$/.test(id))) return 'SIGNED_IN';
  return ids.length && ids.every(id => id === '') ? 'SIGNED_OUT' : 'UNKNOWN';
}

async function probe(platform: Platform, fetcher: typeof fetch): Promise<SiteLoginState> {
  const pages = SITE_LOGIN_PAGES[platform];
  const base = { platform, loginUrl: pages.loginUrl, siteUrl: pages.siteUrl };
  try {
    // Probes run in parallel and stay under the dashboard's 10 s message timeout.
    const response = await fetcher(pages.probeUrl, { credentials: 'include', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(8_000) });
    const html = (await response.text()).slice(0, 2_000_000);
    if (platform === 'SWEA') return { ...base, ...sweaLoginState(response.url || pages.probeUrl, html, response.ok) };
    if (!response.ok) return { ...base, state: 'UNKNOWN' };
    return { ...base, state: platform === 'JUNGOL' ? jungolLoginState(html) : programmersLoginState(html) };
  } catch { return { ...base, state: 'UNKNOWN' }; }
}

export function checkSiteLogins(fetcher: typeof fetch = fetch): Promise<SiteLoginState[]> {
  return Promise.all((['JUNGOL', 'SWEA', 'PROGRAMMERS'] as const).map(platform => probe(platform, fetcher)));
}
