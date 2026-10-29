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
  positionUsd: number | null
  pnlUsd: number | null
  entryMc: number | null
  nowMc: number | null
  sig?: string // transaction signature, links to solscan
  verification?: 'wallet-balance-movements'
  verified?: boolean // receipt checks only the wallet token/SOL flows, not profit
}

// loading: no answer yet. empty: answered, nothing traded yet. error: the API could not be reached.
export type DataMode = 'loading' | 'live' | 'empty' | 'error'

export interface WalletPoint { ts: number; sol: number }

export interface Feed {
  mode: DataMode
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
    real?: boolean // false for a coin that was not launched here
  }
  walletSol: number
  pnlSol: number | null // since launch, realised + open
  trades: number
  winRate: number | null // percent of closed trades in profit
  burnedMain: number // $GRID bought and burned from this coin's 20%
  last?: Pick<Call, 'side' | 'symbol' | 'spentSol' | 'pnlUsd' | 'ts' | 'sig'> & Partial<Pick<Call, 'mint' | 'image' | 'hue'>>
}

export interface AgentsFeed {
  mode: DataMode
  updatedAt: number
  solUsd: number
  agents: Agent[]
}

// What he is doing this second, for the phone view. screenTs is the time of his
// latest phone frame (0 when he is not streaming one).
export interface Live {
  mode: 'live' | 'idle'
  actions: { ts: number; text: string }[] // newest first
  screenTs: number
}

