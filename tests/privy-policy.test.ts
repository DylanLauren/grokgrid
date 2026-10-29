import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRules } from '../ops/privy-setup.mjs'

test('agent policy has no recipient-free transfers or closes, and every IDL check is paired with its program', () => {
  const rules = buildRules('50000000')
  const sources = rules.flatMap(r => r.conditions.map((c: { field_source: string }) => c.field_source))
  assert.ok(!sources.includes('solana_system_program_instruction'))
  assert.ok(!sources.includes('solana_token_program_instruction'))
  for (const r of rules) {
    assert.equal(r.method, 'signTransaction'); assert.equal(r.action, 'ALLOW')
    if (r.conditions.some((c: { field_source: string }) => c.field_source === 'solana_instruction_data'))
      assert.ok(r.conditions.some((c: { field_source: string; field: string }) => c.field_source === 'solana_program_instruction' && c.field === 'programId'))
  }
  const caps = rules.flatMap(r => r.conditions).filter((c: { operator: string }) => c.operator === 'lte')
  assert.ok(caps.every((c: { value: string }) => c.value === '50000000'))
  assert.ok(Buffer.byteLength(JSON.stringify(rules)) < 128 * 1024)
})
