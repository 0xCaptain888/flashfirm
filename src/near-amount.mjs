// Decimal-only conversion; never round monetary values through Number.
export function parseNear(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,24})?$/.test(value)) throw Error('Enter a non-negative NEAR amount with at most 24 decimal places');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, '0'));
  if (amount >= 2n ** 128n) throw Error('Amount exceeds treasury capacity');
  return String(amount);
}
export function formatNear(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw Error('Invalid yoctoNEAR amount');
  const amount = BigInt(value), fraction = String(amount % (10n ** 24n)).padStart(24, '0').replace(/0+$/, '');
  return `${amount / (10n ** 24n)}${fraction ? '.' + fraction : ''}`;
}
