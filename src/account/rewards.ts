// Reward rules shared by the game and the server. The server is the authority:
// the client only reports what happened, the server decides how much MARS it is worth.

export const QUEST_IDS = ['follow', 'like', 'rt', 'reply'] as const;
export type QuestId = (typeof QUEST_IDS)[number];
export const QUEST_LABEL: Record<QuestId, string> = { follow: 'FOLLOW', like: 'LIKE', rt: 'REPOST', reply: 'COMMENT' };

/** One-time achievements: id → name + reward. Unlock rules live in account.ts (they read the colony). */
export const ACH_REWARD: Record<string, { name: string; reward: number }> = {
  'first-build': { name: 'First Module', reward: 250 },
  'o2-backup': { name: 'Backup Oxygen', reward: 500 },
  titanium: { name: 'Titanium Strike', reward: 250 },
  storm: { name: 'Storm Survivor', reward: 500 },
  robot: { name: 'Robot Factory', reward: 250 },
  research: { name: 'First Discovery', reward: 250 },
  modules15: { name: '15 Modules', reward: 500 },
  sol5: { name: '5 Sols Alive', reward: 500 },
  sol10: { name: '10 Sols Alive', reward: 1000 },
  base: { name: 'Base Established', reward: 1000 },
  colony: { name: 'Colony Founded', reward: 2000 },
  rare: { name: 'Rare Minerals', reward: 500 },
};

/** Repeatable rewards for things that happen in a colony, with a per-player daily cap. */
export const EARN_RULES = {
  module: { amount: 50, cap: 60, label: 'Module built' },
  robot: { amount: 100, cap: 20, label: 'Robot built' },
  research: { amount: 150, cap: 20, label: 'Research complete' },
  sol: { amount: 100, cap: 30, label: 'Sol survived' },
  storm: { amount: 200, cap: 10, label: 'Storm survived' },
  stage: { amount: 1000, cap: 4, label: 'New colony stage' },
  deposit: { amount: 25, cap: 40, label: 'Deposit found' },
} as const;
export type EarnEvent = keyof typeof EARN_RULES;
