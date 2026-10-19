// Exercises the pure CORE block of index.html in node. Run: node tools/test_core.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const core = html.slice(html.indexOf('const MIN_PLAYERS'), html.indexOf('/* ==================== END CORE'));
const exportsList = ['SCHEDULES','MIN_PLAYERS','MAX_PLAYERS','MAX_COURTS','maxCourtsFor','scheduleFor','scheduleInfo','buildGameRows','groupRounds','perPlayerAgg','matchStandings','computeAllTime','FORMATS','gamesPerRound','mexicanoSitters','mexicanoNextRound','matchIsComplete','computeInsights','finishingPositions'];
const C = new Function(core + '\nreturn {' + exportsList.join(',') + '};')();
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

console.log('Schedules');
for (const key of Object.keys(C.SCHEDULES)) {
  const [n, c] = key.split('|').map(Number);
  const s = C.SCHEDULES[key];
  ok(key, () => {
    const partner = Array.from({ length: n }, () => new Array(n).fill(0));
    s.forEach(r => {
      assert(r.length <= c, 'too many games in a round');
      const seen = new Set();
      r.forEach(g => {
        const ids = [...g[0], ...g[1]];
        ids.forEach(p => { assert(p >= 0 && p < n, 'seat out of range'); assert(!seen.has(p), 'player twice in round ' + key); seen.add(p); });
        partner[g[0][0]][g[0][1]]++; partner[g[0][1]][g[0][0]]++; partner[g[1][0]][g[1][1]]++; partner[g[1][1]][g[1][0]]++;
      });
    });
    let zero = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { assert(partner[i][j] <= 1, 'pair partners twice'); if (!partner[i][j]) zero++; }
    assert.strictEqual(zero, (n * (n - 1) / 2) % 2, 'wrong number of skipped pairs');
    const G = s.reduce((a, r) => a + r.length, 0);
    const minRounds = Math.ceil(G / c);
    const short = s.filter(r => r.length < c).length;
    // The bug report: 10|2 had 12 rounds with two single-game rounds. Must now be optimal.
    if (['10|2', '14|3', '15|3', '16|3', '8|2', '9|2', '12|3', '13|3', '15|2', '16|2', '16|4'].includes(key)) assert.strictEqual(s.length, minRounds, key + ' not packed to the minimum rounds');
    process.stdout.write(`      ${s.length} rounds (min ${minRounds}), ${G} games, ${short} round(s) short of ${c} courts\n`);
  });
}

console.log('Mexicano');
function simulate(n, c, roundsToPlay, seed = 1) {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, seat: i, profile_id: 'pr' + i }));
  const games = [];
  const roundsOut = [];
  for (let r = 0; r < roundsToPlay; r++) {
    const draw = C.mexicanoNextRound(players, games, c);
    roundsOut.push(draw);
    draw.forEach((g, i) => games.push({ id: 'g' + games.length, idx: games.length, round: r, court: g.court, team1: g.team1, team2: g.team2, score1: null, score2: null }));
    // score the round
    games.filter(g => g.round === r).forEach(g => { const a = Math.floor(rnd() * 25); g.score1 = a; g.score2 = 24 - a; });
  }
  return { players, games, roundsOut };
}
ok('10 players, 2 courts, 7 rounds: shape, no clashes, fair sit-outs', () => {
  const { players, games, roundsOut } = simulate(10, 2, 7);
  const sits = {}; players.forEach(p => sits[p.id] = 0);
  roundsOut.forEach(draw => {
    assert.strictEqual(draw.length, 2);
    const seen = new Set(draw.flatMap(g => [...g.team1, ...g.team2]));
    assert.strictEqual(seen.size, 8, 'eight distinct players per round');
    players.forEach(p => { if (!seen.has(p.id)) sits[p.id]++; });
  });
  const v = Object.values(sits);
  assert(Math.max(...v) - Math.min(...v) <= 1, 'sit-outs unbalanced: ' + v);
  assert.deepStrictEqual(v.reduce((a, b) => a + b, 0), 14);
});
ok('round 2+ pairs 1st&4th v 2nd&3rd on court 1, 5th-8th on court 2', () => {
  const { players, games } = simulate(10, 2, 3);
  const scored = games.filter(g => g.round < 3);
  const draw = C.mexicanoNextRound(players, scored, 2);
  const rounds = C.groupRounds(scored);
  const sitters = new Set(C.mexicanoSitters(players, rounds, 2).map(p => p.id));
  const agg = C.perPlayerAgg(scored);
  const ranked = players.filter(p => !sitters.has(p.id)).sort((a, b) => agg[b.id].pts - agg[a.id].pts || agg[b.id].wins - agg[a.id].wins || agg[a.id].games - agg[b.id].games || a.seat - b.seat).map(p => p.id);
  assert.deepStrictEqual(draw[0].team1, [ranked[0], ranked[3]]);
  assert.deepStrictEqual(draw[0].team2, [ranked[1], ranked[2]]);
  assert.deepStrictEqual(draw[1].team1, [ranked[4], ranked[7]]);
  assert.deepStrictEqual(draw[1].team2, [ranked[5], ranked[6]]);
});
ok('sitters: fewest sit-outs first, then longest ago', () => {
  const { players, games } = simulate(9, 2, 4);
  // after 4 rounds with 1 sitter each, 4 players sat once; the next sitter must be one who never has
  const rounds = C.groupRounds(games);
  const satSoFar = new Set();
  rounds.forEach(r => { const pl = new Set(r.games.flatMap(g => [...g.team1, ...g.team2])); players.forEach(p => { if (!pl.has(p.id)) satSoFar.add(p.id); }); });
  assert.strictEqual(satSoFar.size, 4);
  const next = C.mexicanoSitters(players, rounds, 1)[0];
  assert(!satSoFar.has(next.id));
});
ok('4,5,8,12,16 players draw the right number of games', () => {
  for (const [n, c, g] of [[4, 1, 1], [5, 1, 1], [8, 2, 2], [8, 1, 1], [12, 3, 3], [16, 4, 4], [13, 3, 3]]) {
    const { roundsOut } = simulate(n, c, 2);
    assert.strictEqual(roundsOut[0].length, g); assert.strictEqual(roundsOut[1].length, g);
  }
});
ok('matchIsComplete respects target_rounds', () => {
  const { games } = simulate(8, 2, 5);
  assert.strictEqual(C.matchIsComplete({ format: 'mexicano', target_rounds: 6 }, games), false);
  assert.strictEqual(C.matchIsComplete({ format: 'mexicano', target_rounds: 5 }, games), true);
  assert.strictEqual(C.matchIsComplete({ format: 'americano' }, games), true);
  games[0].score1 = null; assert.strictEqual(C.matchIsComplete({ format: 'americano' }, games), false);
});

console.log('Insights (real data dump)');
const dumpPath = process.env.MM_DUMP || '';
if (dumpPath && fs.existsSync(dumpPath)) {
  const d = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
  const profiles = d.profiles.map(p => ({ id: p[0], name: p[1], created_at: p[2] }));
  // matches list isn't in the dump; reconstruct minimal rows from game match_ids with a fake date order by idx
  const matchIds = [...new Set(d.games.map(g => g.match_id))];
  const matches = matchIds.map((id, i) => ({ id, status: 'finished', created_at: '2026-01-' + String(i + 1).padStart(2, '0') }));
  const data = { matches, players: d.players, games: d.games.filter(g => g.score1 !== null), profiles };
  ok('computeInsights runs for every profile and finds a best pairing + nemesis', () => {
    profiles.forEach(pr => {
      const ins = C.computeInsights(pr.id, data);
      if (!ins) return;
      assert(ins.bestPartner && ins.nemesis, pr.name);
      assert.strictEqual(ins.form.length, Math.min(10, ins.games));
      assert(ins.pf >= 0 && ins.pa >= 0);
    });
    const carl = profiles.find(p => p.name === 'Carl');
    const ins = C.computeInsights(carl.id, data);
    console.log(`      Carl: ${ins.games} games · best pairing ${ins.bestPartner.name} (${ins.bestPartner.wins}/${ins.bestPartner.games}) · nemesis ${ins.nemesis.name} (lost ${ins.nemesis.losses}/${ins.nemesis.games}) · streak ${ins.bestStreak} · form ${ins.form.join('')}`);
  });
  ok('finishingPositions gives one rank per finished night', () => {
    const pos = C.finishingPositions(matches, d.players, d.games);
    const all = C.computeAllTime(matches, d.players.filter(p => p.profile_id), d.games.filter(g => g.score1 !== null), profiles);
    all.forEach(s => assert.strictEqual((pos[s.profileId] || []).length, s.nights, s.name));
  });
} else console.log('  (set MM_DUMP=/path/to/dump.json to run the real-data checks; skipped)');

console.log(`\n${passed} checks passed`);
