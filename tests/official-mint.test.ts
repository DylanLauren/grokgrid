import test from 'node:test'
import assert from 'node:assert/strict'
import { officialVerdict } from '../scripts/official-mint.mjs'

const T = 'GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT', B = 'E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq', PDA = 'Pda1111111111111111111111111111111111111111'
const ok = {
  mint: { initialized: true, mintAuthority: null, freezeAuthority: null },
  sharing: { adminRevoked: true, shareholders: [{ address: T, shareBps: 8000 }, { address: B, shareBps: 2000 }] },
  sharingPda: PDA,
  curve: { creator: PDA, isMayhemMode: false, isCashbackCoin: false, isHolderReward: false, quoteMint: '11111111111111111111111111111111', creatorFeeBps: '0' },
  expected: { treasury: T, burn: B },
}

test('$GRID verifies only with the locked 80/20 split to the pinned wallets, on a plain fixed-supply SOL curve', () => {
  assert.equal(officialVerdict(ok), 'ok')
  assert.equal(officialVerdict({ ...ok, curve: { ...ok.curve, quoteMint: 'So11111111111111111111111111111111111111112' } }), 'ok')
  const cases: [Partial<typeof ok>, string][] = [
    [{ mint: null as never }, 'mint-not-on-chain'],
    [{ mint: { ...ok.mint, mintAuthority: 'X' as never } }, 'mint-or-freeze-authority-set'],
    [{ mint: { ...ok.mint, freezeAuthority: 'X' as never } }, 'mint-or-freeze-authority-set'],
    [{ sharing: null as never }, 'no-fee-sharing-config'],
    [{ sharing: { ...ok.sharing, adminRevoked: false } }, 'fee-sharing-admin-not-revoked'],
    [{ sharing: { ...ok.sharing, shareholders: [{ address: T, shareBps: 9000 }, { address: B, shareBps: 1000 }] } }, 'fee-split-mismatch'],
    [{ sharing: { ...ok.sharing, shareholders: [{ address: B, shareBps: 8000 }, { address: T, shareBps: 2000 }] } }, 'fee-split-mismatch'],
    [{ sharing: { ...ok.sharing, shareholders: [...ok.sharing.shareholders, { address: PDA, shareBps: 0 }] } }, 'fee-split-mismatch'],
    [{ sharing: { ...ok.sharing, shareholders: [{ address: PDA, shareBps: 8000 }, { address: B, shareBps: 2000 }] } }, 'fee-split-mismatch'],
    [{ curve: null as never }, 'no-bonding-curve'],
    [{ curve: { ...ok.curve, creator: T } }, 'creator-not-fee-sharing-config'],
    [{ curve: { ...ok.curve, isCashbackCoin: true } }, 'fee-diverting-mode'],
    [{ curve: { ...ok.curve, quoteMint: B } }, 'not-sol-quoted'],
    [{ curve: { ...ok.curve, creatorFeeBps: '50' } }, 'custom-creator-fee'],
  ]
  for (const [patch, want] of cases) assert.equal(officialVerdict({ ...ok, ...patch }), want, want)
})
