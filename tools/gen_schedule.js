// Schedule generator via simulated annealing.
// n players, c courts -> R = ceil(G/c) rounds where G = floor(n(n-1)/4) games.
// Every pair partners exactly once (one pair skipped when n(n-1)/2 is odd),
// no player appears twice in a round, rounds are as full as arithmetic allows,
// opponents balanced as a soft objective.
// Usage: node gen_schedule.js N C [seed]
const [,, N, C, SEED] = process.argv;
const n = +N, c = +C;
let seed = +(SEED||1);
function rnd(){ seed = (seed*1103515245 + 12345) & 0x7fffffff; return seed/0x7fffffff; }
const allPairs = n*(n-1)/2, G = Math.floor(allPairs/2), skipsAllowed = allPairs%2;
const R = Math.ceil(G/c);
const sizes = new Array(R).fill(Math.floor(G/R));
for(let i=0;i<G-Math.floor(G/R)*R;i++) sizes[i]++;
// each round: array of n seats; first 4*sizes[r] are playing (teams (0,1),(2,3) per game)
const rounds = sizes.map(()=>{ const a=[...Array(n).keys()]; for(let i=n-1;i>0;i--){const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; });
const partner = Array.from({length:n},()=>new Array(n).fill(0));
const opp = Array.from({length:n},()=>new Array(n).fill(0));
function forGames(r, fn){ for(let g=0; g<sizes[r]; g++){ const b=4*g; fn(rounds[r][b],rounds[r][b+1],rounds[r][b+2],rounds[r][b+3]); } }
function apply(r, d){ forGames(r,(a,b,x,y)=>{ partner[a][b]+=d; partner[b][a]+=d; partner[x][y]+=d; partner[y][x]+=d;
  for(const p of [a,b]) for(const q of [x,y]){ opp[p][q]+=d; opp[q][p]+=d; } }); }
for(let r=0;r<R;r++) apply(r,1);
function cost(){
  let dup=0, zero=0, oppVar=0;
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){ if(partner[i][j]>1) dup+=partner[i][j]-1; if(partner[i][j]===0) zero++; oppVar += (opp[i][j]-2)*(opp[i][j]-2); }
  return 1000*dup + 1000*Math.max(0, zero-skipsAllowed) + oppVar;
}
let cur = cost(), best = cur, bestState = rounds.map(r=>r.slice());
let T = 30;
const maxIter = 4_000_000;
for(let it=0; it<maxIter && best>0; it++){
  const r = Math.floor(rnd()*R);
  const playing = 4*sizes[r];
  // swap seat i (playing) with any other seat j in the same round
  const i = Math.floor(rnd()*playing); let j = Math.floor(rnd()*n); if(j===i) j=(j+1)%n;
  apply(r,-1); [rounds[r][i],rounds[r][j]]=[rounds[r][j],rounds[r][i]]; apply(r,1);
  const nc = cost();
  if(nc<=cur || rnd() < Math.exp((cur-nc)/T)){ cur=nc; if(cur<best){ best=cur; bestState=rounds.map(r=>r.slice()); } }
  else { apply(r,-1); [rounds[r][i],rounds[r][j]]=[rounds[r][j],rounds[r][i]]; apply(r,1); }
  if(it%2000===0) T = Math.max(0.3, T*0.995);
  if(it%200000===0 && it>0 && best>=1000){ T = 30; } // reheat if stuck with hard violations
}
// Accept if hard constraints satisfied (cost < 1000)
if(best>=1000){ console.error('FAILED', n, c, 'best', best); process.exit(1); }
const out = bestState.map((seats,r)=>{ const gs=[]; for(let g=0; g<sizes[r]; g++){ const b=4*g; gs.push([[seats[b],seats[b+1]],[seats[b+2],seats[b+3]]]); } return gs; });
// verify + report
const pc = Array.from({length:n},()=>new Array(n).fill(0)), oc = Array.from({length:n},()=>new Array(n).fill(0));
out.forEach(rd=>{ const seen=new Set(); rd.forEach(g=>{ for(const p of [...g[0],...g[1]]){ if(seen.has(p)) throw new Error('dup'); seen.add(p);} pc[g[0][0]][g[0][1]]++; pc[g[0][1]][g[0][0]]++; pc[g[1][0]][g[1][1]]++; pc[g[1][1]][g[1][0]]++;
  for(const p of g[0]) for(const q of g[1]){ oc[p][q]++; oc[q][p]++; } }); });
let skipped=0, oppMin=99, oppMax=0; for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){ if(pc[i][j]>1) throw new Error('pair twice'); if(pc[i][j]===0) skipped++; oppMin=Math.min(oppMin,oc[i][j]); oppMax=Math.max(oppMax,oc[i][j]); }
const sits = new Array(n).fill(0); out.forEach(rd=>{ const pl=new Set(rd.flatMap(g=>[...g[0],...g[1]])); for(let p=0;p<n;p++) if(!pl.has(p)) sits[p]++; });
console.error(`${n}|${c}: ${out.length} rounds, sizes ${out.map(r=>r.length).join('')}, skipped ${skipped}, opp range ${oppMin}-${oppMax}, sit-outs ${sits.join(',')}, cost ${best}`);
console.log(JSON.stringify(out));
