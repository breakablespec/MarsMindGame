// Everything a launch needs to change lives here.

export const CONFIG = {
  /** In-game token name. */
  currency: 'MARS',
  /** Short ticker for floating rewards. */
  ticker: 'MARS',
  /** X account players must follow (without @). */
  xHandle: 'MarsMindGame',
  /** The post players must like, repost and comment on. */
  postUrl: 'https://x.com/MarsMindGame/status/1000000000000000000',
  /** Tokens per completed quest. */
  questReward: 1000,
  /** Seconds after opening a quest link before it counts. */
  questDelaySec: 5,
  /** Public URL of the game for referral links. Empty = the address the game is opened from (Netlify, your domain). */
  gameUrl: '',
  /** Used when the game runs inside a sandbox whose own address can't be shared. */
  fallbackUrl: 'https://claude.ai/artifact/ERACnhr9QJBJojJZgdi5pG',
  /** Text pre-filled in the quote post (ref link is added automatically). */
  shareText: 'Running my Mars colony with an AI operations system 🚀 Join me:',
  /** Reply text pre-filled for the comment quest. */
  replyText: 'Commander reporting in. CORE online 🟢',
};

export const postId = () => (CONFIG.postUrl.match(/status\/(\d+)/)?.[1] ?? '');

/** Where referral links point. */
export function gameUrl(): string {
  if (CONFIG.gameUrl) return CONFIG.gameUrl;
  try {
    const { protocol, hostname, origin, pathname } = location;
    const sandbox = protocol === 'file:' || /claudeusercontent|claude\.ai|about:/.test(hostname) || !hostname;
    return sandbox ? CONFIG.fallbackUrl : `${origin}${pathname}`;
  } catch { return CONFIG.fallbackUrl; }
}
