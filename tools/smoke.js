const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('assert');
const { MockDB } = require('./mockdb');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SUPA = fs.readFileSync(require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), 'utf8');
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const db = new MockDB();
const NAMES = ['Carl', 'Joe', 'Nick', 'Kirsty', 'Brigg', 'Vicky', 'Tom Moore', 'Marie', 'Kaylz', 'Tim K', 'Christian', 'Lewis'];
const PROF = {}; NAMES.forEach(n => PROF[n] = db.seedProfile(n));

async function wire(context, profileName) {
  await context.route('**/*', async route => {
    const req = route.request(); const url = req.url();
    if (url.startsWith('https://app.test/')) return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: SUPA });
    if (url.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (url.includes('/rest/v1/')) {
      const h = {}; for (const [k, v] of Object.entries(req.headers())) h[k.toLowerCase()] = v;
      const r = db.handle(req.method(), url, h, req.postData());
      return route.fulfill({ status: r.status, headers: r.headers, body: r.body });
    }
    if (url.includes('/realtime/')) return route.abort();
    return route.abort();
  });
  await context.addInitScript(p => { localStorage.setItem('mm_profile', JSON.stringify(p)); }, { id: PROF[profileName].id, name: profileName });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let step = 0; const log = m => console.log(`  ${++step}. ${m}`);

async function addPlayers(page, names) {
  for (const n of names) {
    await page.waitForSelector('#add-player-sel option:not([value=""])', { state: 'attached' });
    await page.selectOption('#add-player-sel', { label: n });
    await page.click('.addrow button');
    await page.waitForFunction(n => state.players.some(p => p.name === n), n);
  }
}
async function playUntil(page, pred, onRound) {
  for (let guard = 0; guard < 400; guard++) {
    if (await page.evaluate(pred)) return;
    const save = page.locator('button:has-text("Save score ✓")');
    if (await save.count()) {
      if (onRound) await onRound(page);
      // random-ish score: nudge the + button a few times
      const k = guard % 5; for (let i = 0; i < k; i++) await page.locator('.scorer button').nth(1).click();
      await save.click();
      await page.waitForFunction(() => !document.querySelector('#view-play.active button:has(.scoreval)') || true);
      await sleep(150);
      continue;
    }
    const enter = page.locator('#view-play button:has-text("Enter score")');
    if (await enter.count()) { if (onRound) await onRound(page); await enter.first().click(); await sleep(60); continue; }
    const draw = page.locator('button:has-text("Draw round")');
    if (await draw.count()) { await draw.click(); await sleep(200); continue; }
    await sleep(200);
  }
  throw new Error('playUntil stalled');
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
  await wire(ctx, 'Carl');
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
  await page.goto('https://app.test/index.html');
  await page.waitForSelector('#view-home.active');
  log('home renders for Carl');
  await page.screenshot({ path: OUT + '/A0_home_dark.png', fullPage: true });
  assert((await page.textContent('#fmt-info')).includes('Americano:'));

  // ---------- Scenario A: Americano, 10 players, 2 courts (the bug report) ----------
  await page.fill('#new-name', 'Ten player test');
  await page.click('button:has-text("Create match")');
  await page.waitForSelector('#view-lobby.active');
  log('lobby open');
  await addPlayers(page, NAMES.slice(1, 10));
  assert.strictEqual(await page.evaluate(() => state.players.length), 10);
  await page.click('.courtchips .chip:has-text("2 courts")');
  const info = await page.textContent('#lobby-host-controls');
  assert(info.includes('22 games · 11 rounds'), info);
  log('10 players, 2 courts → ' + info.match(/\d+ games · \d+ rounds/)[0]);
  await page.screenshot({ path: OUT + '/A1_lobby_dark.png' });
  await page.click('button:has-text("Set pairings & start")');
  await page.waitForSelector('#view-play.active');
  let seenEmpty = 0, roundsSeen = new Set(), courtsPerRound = {};
  await playUntil(page, () => document.querySelector('#view-final.active') !== null, async p => {
    seenEmpty += await p.locator('.court.empty').count();
    const t = await p.textContent('#play-title'); const r = t.match(/round (\d+) of (\d+)/);
    roundsSeen.add(r[1]); courtsPerRound[r[1]] = Math.max(courtsPerRound[r[1]] || 0, await p.locator('#view-play .court:not(.empty)').count());
    if (r[1] === '1' && !fs.existsSync(OUT + '/A2_play_dark.png')) await p.screenshot({ path: OUT + '/A2_play_dark.png' });
  });
  assert.strictEqual(seenEmpty, 0, 'an empty court card appeared in a 10|2 night');
  assert.strictEqual(roundsSeen.size, 11);
  assert(Object.values(courtsPerRound).every(c => c === 2), JSON.stringify(courtsPerRound));
  log('played all 11 rounds, 2 games every round, no empty court → final view');
  await page.screenshot({ path: OUT + '/A3_final.png' });
  assert.strictEqual(db.t.games.filter(g => g.score1 === null).length, 0);
  await page.click('button:has-text("Start another match")');
  await page.waitForSelector('#view-home.active');

  // ---------- Scenario B: Mexicano, 9 players, 2 courts, 5 rounds ----------
  await page.click('#fmt-mexicano');
  assert((await page.textContent('#fmt-info')).includes('Mexicano:'));
  await page.fill('#new-name', 'Mexicano test');
  await page.click('button:has-text("Create match")');
  await page.waitForSelector('#view-lobby.active');
  await addPlayers(page, NAMES.slice(1, 9));
  await page.click('.courtchips .chip:has-text("2 courts")');
  await page.waitForSelector('.roundchips');
  await page.click('.roundchips .chip:has-text("5")');
  const binfo = await page.textContent('#lobby-host-controls');
  assert(binfo.includes('5 rounds · 2 games per round · 1 sit out'), binfo);
  log('Mexicano lobby: ' + binfo.match(/5 rounds[^·]*·[^·]*·[^·]*/)[0].trim());
  await page.screenshot({ path: OUT + '/B1_mex_lobby.png' });
  await page.click('button:has-text("Draw round 1 & start")');
  await page.waitForSelector('#view-play.active');
  const mid = await page.evaluate(() => state.match.id);
  const draws = [];
  await playUntil(page, () => document.querySelector('#view-final.active') !== null, async p => {
    const t = await p.textContent('#play-title');
    const r = +t.match(/round (\d+) of (\d+)/)[1];
    if (!draws[r - 1]) {
      draws[r - 1] = await p.evaluate(() => { const rs = groupRounds(state.games); const cur = rs[rs.length - 1]; return cur.games.map(g => ({ t1: g.team1.map(pname), t2: g.team2.map(pname), court: g.court })); });
      const next = await p.textContent('#view-play');
      if (r < 5) assert(next.includes('Next round is drawn from the standings'), 'mexicano next-round hint missing');
      if (r === 2) await p.screenshot({ path: OUT + '/B2_mex_round2.png' });
    }
  });
  const mg = db.t.games.filter(g => g.match_id === mid);
  assert.strictEqual(mg.length, 10, 'expected 5 rounds × 2 games');
  assert.strictEqual(db.t.matches.find(m => m.id === mid).status, 'finished');
  // round 2 must follow the standings of round 1
  const r1 = mg.filter(g => g.round === 0), r2 = mg.filter(g => g.round === 1);
  const pts = {}; r1.forEach(g => { g.team1.forEach(id => pts[id] = (pts[id] || 0) + g.score1); g.team2.forEach(id => pts[id] = (pts[id] || 0) + g.score2); });
  const playedR1 = Object.keys(pts).sort((a, b) => pts[b] - pts[a]);
  const r2c1 = r2.find(g => g.court === 1);
  const r2players = new Set(r2.flatMap(g => [...g.team1, ...g.team2]));
  const satR1 = db.t.players.filter(p => p.match_id === mid && !(p.id in pts))[0];
  assert(r2players.has(satR1.id), 'round-1 sitter must play round 2');
  const top4 = playedR1.filter(id => r2players.has(id)).slice(0, 4);
  assert.deepStrictEqual(new Set([...r2c1.team1, ...r2c1.team2]), new Set(top4), 'court 1 in round 2 is not the top four');
  log('Mexicano: 5 rounds drawn automatically, round 2 court 1 = top 4 of round 1, sitter rotated, match finished');
  console.log('     round draws:', draws.map((d, i) => `R${i + 1}: ` + d.map(g => `${g.t1.join('&')} v ${g.t2.join('&')}`).join(' | ')).join('\n                  '));
  await page.click('button:has-text("Start another match")');
  await page.waitForSelector('#view-home.active');

  // ---------- Scenario C: host adds Joe before he arrives; Joe sees the banner ----------
  await page.click('#fmt-americano');
  await page.fill('#new-name', 'Late Joe');
  await page.click('button:has-text("Create match")');
  await page.waitForSelector('#view-lobby.active');
  await addPlayers(page, ['Joe', 'Nick', 'Kirsty']);
  assert((await page.textContent('#lobby-players')).includes('added'));
  await page.screenshot({ path: OUT + '/C1_lobby_with_added.png' });
  const ctx2 = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
  await wire(ctx2, 'Joe');
  const joe = await ctx2.newPage();
  joe.on('pageerror', e => { console.error('PAGE ERROR (joe)', e.message); process.exitCode = 1; });
  await joe.goto('https://app.test/index.html');
  await joe.waitForSelector('.banner');
  const banner = await joe.textContent('.banner');
  assert(banner.includes("You've been added") && banner.includes('Late Joe') && banner.includes('Carl put you in'), banner);
  log('Joe opens the app → banner: ' + banner.replace(/\s+/g, ' ').trim().slice(0, 90));
  await joe.screenshot({ path: OUT + '/C2_joe_banner.png' });
  await joe.click('.banner button');
  await joe.waitForSelector('#view-lobby.active');
  const lob = await joe.textContent('#lobby-players');
  assert(lob.includes('Joe') && (await joe.locator('#lobby-players .youbadge').count()) === 1);
  assert.strictEqual(db.t.players.filter(p => p.name === 'Joe' && p.match_id === db.t.matches.at(-1).id).length, 1, 'Joe must not be duplicated');
  log('Joe joins the lobby on his own seat (no duplicate row)');
  // joining via the open-matches list must also claim the seat, not insert a second row
  await joe.click('button:has-text("Leave match")');
  await joe.waitForSelector('#view-home.active');
  // Leaving in the lobby deletes the seat — so re-add and rejoin via the list
  await page.waitForFunction(() => !state.players.some(p => p.name === 'Joe'));
  await addPlayers(page, ['Joe']);
  await joe.click('button:has-text("Check again")');
  await joe.waitForSelector('#open-list button:has-text("Join")');
  await joe.click('#open-list button:has-text("Join")');
  await joe.waitForSelector('#view-lobby.active');
  assert.strictEqual(db.t.players.filter(p => p.name === 'Joe' && p.match_id === db.t.matches.at(-1).id).length, 1);
  log('Joining from the open-matches list also reuses the seat');

  // ---------- Light mode ----------
  await joe.click('#bottomnav button[data-tab=profile]');
  await joe.waitForSelector('.themerow');
  await joe.click('.themerow .chip:has-text("Light")'); assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  assert.strictEqual(await joe.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  assert.strictEqual(await joe.evaluate(() => localStorage.getItem('mm_theme')), 'light');
  await joe.screenshot({ path: OUT + '/D1_profile_light.png', fullPage: true });
  await joe.click('#bottomnav button[data-tab=match]');
  await joe.waitForSelector('#view-lobby.active');
  await joe.screenshot({ path: OUT + '/D2_lobby_light.png' });
  await joe.click('#bottomnav button[data-tab=boards]');
  await sleep(300);
  await joe.screenshot({ path: OUT + '/D3_leaders_light.png', fullPage: true });
  log('light mode applied and persisted');

  // ---------- Profile insights + leaders (Carl, dark) ----------
  await page.click('#bottomnav button[data-tab=profile]');
  await page.waitForSelector('#prof-insights[style*="block"]');
  const ins = await page.textContent('#prof-insights');
  assert(ins.includes('Your best pairing') && ins.includes('Your nemesis') && ins.includes('Last 10 games'), ins);
  log('profile insights: ' + ins.replace(/\s+/g, ' ').trim().slice(0, 140));
  await page.screenshot({ path: OUT + '/E1_profile_dark.png', fullPage: true });
  await page.click('#chip-po'); await sleep(100);
  await page.click('#bottomnav button[data-tab=boards]');
  await page.waitForSelector('#boards-list li');
  for (const mode of ['wins', 'winrate', 'titles', 'podiums', 'total', 'avg']) {
    await page.click('#chip-' + mode); await sleep(200);
    assert((await page.locator('#boards-list li').count()) >= 1, mode);
  }
  await page.click('#chip-wins'); await sleep(200);
  await page.screenshot({ path: OUT + '/E2_leaders_wins_dark.png', fullPage: true });
  log('leaderboard modes all render');

  // ---------- Americano with an odd number: 11 players shows the empty-court card once ----------
  await page.click('#bottomnav button[data-tab=match]');
  await page.waitForSelector('#view-lobby.active');
  await addPlayers(page, ['Brigg', 'Vicky', 'Tom Moore', 'Marie', 'Kaylz', 'Tim K', 'Christian']); // Carl+Joe+Nick+Kirsty+7 = 11
  assert.strictEqual(await page.evaluate(() => state.players.length), 11);
  await page.click('.courtchips .chip:has-text("2 courts")');
  await page.click('button:has-text("Set pairings & start")');
  await page.waitForSelector('#view-play.active');
  let emptySeen = 0;
  await playUntil(page, () => document.querySelector('#view-final.active') !== null, async p => {
    const n = await p.locator('.court.empty').count(); if (n && !emptySeen) await p.screenshot({ path: OUT + '/F1_empty_court.png' }); emptySeen += n;
  });
  assert(emptySeen >= 1, 'odd-game night should show the empty-court card');
  log('11 players, 2 courts: the one single-game round is labelled rather than silently short');

  await browser.close();
  console.log('\nALL SMOKE CHECKS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
