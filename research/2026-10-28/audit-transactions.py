import json,csv,collections
from pathlib import Path
from decimal import Decimal
root=Path(__file__).parent
quotes={'So11111111111111111111111111111111111111112':'WSOL','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v':'USDC','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB':'USDT'}
rows=[]; summaries=[]
for f in sorted((root/'transactions').glob('*.json')):
 d=json.loads(f.read_text());w=d['wallet'];counts=collections.Counter();mintcounts=collections.Counter();txs=[t for t in d['records'] if d['start']<=t['timestamp']<=d['end']]
 for t in txs:
  deltas=collections.defaultdict(Decimal)
  for a in t.get('accountData',[]):
   for b in a.get('tokenBalanceChanges',[]):
    if b.get('userAccount')==w:
     z=b['rawTokenAmount'];deltas[b['mint']]+=Decimal(z['tokenAmount'])/(Decimal(10)**z['decimals'])
  native=sum(a.get('nativeBalanceChange',0) for a in t.get('accountData',[]) if a['account']==w)
  quote={quotes[m]:str(v) for m,v in deltas.items() if m in quotes and v}
  if native:quote['SOL_NET']=str(Decimal(native)/10**9)
  assets={m:v for m,v in deltas.items() if m not in quotes and v}
  failed=t.get('transactionError') is not None
  for m,v in assets.items():
   opposite=[q for q,amount in quote.items() if Decimal(amount)*v<0]
   if failed:kind='failed'
   elif len(assets)==1 and opposite and t['type']=='SWAP':kind='provider-swap-buy' if v>0 else 'provider-swap-sell'
   elif len(assets)==1 and opposite:kind='unverified-buy-candidate' if v>0 else 'unverified-sell-candidate'
   elif not opposite:kind='inflow-without-observed-payment' if v>0 else 'outflow-without-observed-proceeds'
   else:kind='complex-exchange'
   counts[kind]+=1;mintcounts[m]+=1
   rows.append({'wallet':w,'signature':t['signature'],'timestamp':t['timestamp'],'mint':m,'token_delta':str(v),'classification':kind,'provider_type':t['type'],'provider_source':t['source'],'quote_net_deltas':json.dumps(quote),'transaction_fee_lamports':t['fee'],'wallet_paid_transaction_fee':t['feePayer']==w,'historical_volume':'','historical_liquidity':''})
 summaries.append({'wallet':w,'records_downloaded':len(d['records']),'records_in_window':len(txs),'cutoff_reached':d['complete'],'stop_reason':d.get('stopReason'),'pages':d['pages'],'oldest_timestamp':min((t['timestamp'] for t in d['records']),default=None),'distinct_nonquote_mints':len(mintcounts),'classifications':dict(counts),'provider_types':dict(collections.Counter(t['type'] for t in txs))})
(root/'transaction-audit.json').write_text(json.dumps(summaries,indent=2))
if rows:
 with (root/'transaction-evidence.csv').open('w') as f:
  writer=csv.DictWriter(f,fieldnames=rows[0].keys());writer.writeheader();writer.writerows(rows)
print(json.dumps({'wallets':len(summaries),'records':sum(s['records_downloaded'] for s in summaries),'cutoff_reached':sum(s['cutoff_reached'] for s in summaries),'evidence_rows':len(rows)},indent=2))
