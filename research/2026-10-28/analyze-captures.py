import json,re,csv,pathlib
root=pathlib.Path('/Users/dylanladrido/coding/grokgrid-launch-safety/research/2026-10-28')
def money(s):
 s=s.replace(',','').replace('$','').replace('+','').strip()
 if s in ['—','Transferred','Transferred in']:return None
 try:return float(s.rstrip('KMB'))*({'K':1e3,'M':1e6,'B':1e9}.get(s[-1],1))
 except:return None
rows=[];summary=[]
for p in sorted(root.glob('*-pnl.json')):
 j=json.loads(p.read_text());t=j['text'];n=re.search(r'([\d,.]+[KMB]?) total / ([\d,.]+[KMB]?) holding / ([\d,.]+[KMB]?) sold',t)
 if not n:
  summary.append({'source':p.name,'status':'detail-not-loaded','url':j['url']});continue
 data=t[n.end():]; data=data[data.index('ROI\n')+4:]
 matches=list(re.finditer(r'(?:^|\n)([^\n]+)\n((?:\d+\s?)(?:s|m|h|d|mo|y))\n',data))
 parsed=[]
 for i,m in enumerate(matches):
  block=data[m.end():matches[i+1].start() if i+1<len(matches) else len(data)].strip().split('\n')
  # Fixed table order: unrealized, realized, total, value, quantity, invested, avg cost, ROI.
  if len(block)<7:continue
  roi=next((x for x in reversed(block) if re.fullmatch(r'[+-]?[\d,.]+[KMB]?%',x)),None)
  row={'source':p.name,'wallet_url':j['url'],'symbol':m[1],'last_activity':m[2],'realized_usd_rounded':money(block[1]),'total_pnl_usd_rounded':money(block[2]),'invested_usd_rounded':money(block[5]),'roi_display':roi,'transferred_in':'Transferred in' in block,'scope':'wallet token history; not restricted to 30D; mint not exposed in capture','raw':' | '.join(block)}
  parsed.append(row);rows.append(row)
 vals=[r for r in parsed if r['realized_usd_rounded'] is not None and not r['transferred_in']]
 ranked=sorted(vals,key=lambda x:x['realized_usd_rounded'],reverse=True)
 summary.append({'source':p.name,'url':j['url'],'displayed_token_count':n[1],'parsed_rows':len(parsed),'load_more':j.get('loadMore',False),'period_summary':t[t.index('REALIZED IN PERIOD'):t.index('SUMMARY')] if 'REALIZED IN PERIOD' in t else '', 'transferred_rows':sum(r['transferred_in'] for r in parsed),'positive_realized_rows':sum(r['realized_usd_rounded']>0 for r in vals),'negative_realized_rows':sum(r['realized_usd_rounded']<0 for r in vals),'sum_displayed_realized_excluding_transfers':sum(r['realized_usd_rounded'] for r in vals),'largest_winners':[{k:r[k] for k in ['symbol','realized_usd_rounded','invested_usd_rounded','roi_display','last_activity']} for r in ranked[:5]],'largest_losers':[{k:r[k] for k in ['symbol','realized_usd_rounded','invested_usd_rounded','roi_display','last_activity']} for r in ranked[-5:]]})
(root/'analysis.json').write_text(json.dumps(summary,indent=2))
if rows:
 with (root/'token-history.csv').open('w') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
for s in summary:print(json.dumps({k:s.get(k) for k in ['source','displayed_token_count','parsed_rows','transferred_rows','sum_displayed_realized_excluding_transfers','largest_winners']},ensure_ascii=False))
