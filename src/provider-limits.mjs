export function providerLimits(policy) {
  const maxCalls = policy.maxCalls ?? 8, maxTokens = policy.maxTokens ?? 1600;
  if (![8, 12].includes(maxCalls) || ![1000, 1600].includes(maxTokens)) throw Error('UNAPPROVED_PROVIDER_LIMITS');
  return { maxCalls, maxTokens, perCallReservationFen: Math.ceil((20000 + 4096 + maxTokens) / 100) };
}
