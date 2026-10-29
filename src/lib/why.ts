// The house bot's notes start with the reason when his strategy recorded one:
// "bought $GOOD: buyers outpacing sellers 2.1×, $48k liquidity. 0.020 SOL."
// This pulls out just the reason. Older notes without one give undefined.
const WHY = /^(?:bought|sold) [^:]{1,40}: (.+?)(?:\s+\d+(?:\.\d+)? SOL\.)?$/s

export function whyOf(note?: string): string | undefined {
  const m = note ? WHY.exec(note.trim()) : null
  return m?.[1] || undefined
}
