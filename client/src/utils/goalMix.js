export const GOAL_SESSION_MIX = [
  { key: 'province', share: 0.7, feeKey: 'default_fee' },
  { key: 'capital', share: 0.25, feeKey: 'capital_fee' },
  { key: 'special', share: 0.05, feeKey: 'special_fee' },
];

export function buildGoalSessionMix(goalRemaining, pricing = {}) {
  const remaining = Number(goalRemaining || 0);
  if (remaining <= 0) return [];

  return GOAL_SESSION_MIX
    .map((item) => {
      const fee = Number(pricing?.[item.feeKey] || 0);
      if (!fee) return null;

      const targetAmount = remaining * item.share;
      const exactSessions = targetAmount / fee;

      return {
        ...item,
        fee,
        targetAmount,
        exactSessions,
        sessions: exactSessions > 0 ? Math.max(1, Math.ceil(exactSessions)) : 0,
      };
    })
    .filter(Boolean);
}
