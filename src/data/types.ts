// One trade as the bot calls it out. Grok Bot posts these to /api/ingest as it trades;
// the site reads them back and checks each signature against the chain.
export type Side = 'buy' | 'sell'

export interface Call {
  id: string
  ts: number // ms
  side: Side
  mint: string
  symbol: string
  name: string
  hue: string // colour of the coin chip when there is no image
  image?: string
  note: string // first person, lower case, one or two sentences
  sizeTokens: number
  spentSol: number
  positionUsd: number
  pnlUsd: number
  entryMc: number
  nowMc: number
  sig?: string // transaction signature, links to solscan
  verified?: boolean // the signature was found on chain, signed by the bot's wallet
}

export interface WalletPoint { ts: number; sol: number }

export interface Feed {
  mode: 'live' | 'demo'
  wallet: string | null
  solUsd: number
  calls: Call[] // newest first
  curve: WalletPoint[] // oldest first
  burnedMain: number
  feesSol: number
}

// One trading bot on the grid. Every one of them is also a coin on pump.fun.
// The house bot is row zero.
export interface Agent {
  id: string
  house?: boolean
  name: string
  color: string // family colour, see BotMark
  shape: 'sphere' | 'squircle' | 'tile' | 'cloud' | 'cone' | 'drop'
  strategy: string // one line, in its owner's words
  launchedAt: number // ms
  wallet: string // its trading wallet (public address)
  coin: {
    mint: string
    symbol: string
    name: string
    image?: string // the coin's own picture, from pump.fun
    hue: string
    mcUsd: number
    vol24hUsd: number
    change24h: number // percent
    feesSol: number // creator fees earned so far
  }
  walletSol: number
  pnlSol: number // since launch, realised + open
  trades: number
  winRate: number // percent of closed trades in profit
  burnedMain: number // $GRID bought and burned from this coin's 20%
  last?: Pick<Call, 'side' | 'symbol' | 'spentSol' | 'pnlUsd' | 'ts' | 'sig'>
}

export interface AgentsFeed {
  mode: 'live' | 'demo'
  updatedAt: number
  solUsd: number
  agents: Agent[]
}

// What he is doing this second, for the phone view. screenTs is the time of his
// latest phone frame (0 when he is not streaming one).
export interface Live {
  mode: 'live' | 'demo'
  actions: { ts: number; text: string }[] // newest first
  screenTs: number
}
