# Retention & Addiction Design — Ice 'N' Water

How we make the game *feel* sticky the way Candy Crush does — by stealing
its **craft** (difficulty direction, near-miss engineering, streak economy,
session cadence) and refusing its **extraction** (difficulty bent toward a
paywall, ad-reward inversion, state-based pricing, energy systems).

The line we hold: **every assist the game gives you is honest and
eventually disclosed; nothing we tune ever sells the way out.** A game that
openly says "the militia eased off — you were on a cold streak" reads as
generous. A game that secretly does it reads as rigged the day someone
reads the bundle — and on the web, someone always reads the bundle.

---

## 0. What the Candy Crush teardown actually proved

| Mechanic they found | What it really is | Ours to steal? |
|---|---|---|
| `passProximity` target trajectory | A designed difficulty curve, checked every move | ✅ the intent, done openly |
| `MakeEasierAction()` | Loss-streak assist (rubber-band down) | ✅ |
| `MakeHarderAction()` | Flow-channel challenge for skilled players | ✅ |
| Near-miss moments (lose by 1 candy) | The single strongest retry trigger | ✅ engineered + surfaced |
| Streak/loss-state reading | Session context informing the match | ✅ |
| Ad reward ∝ 1/proximity | Punishing hope to push payment | ❌ |
| Dynamic pricing (+5…+190 moves) | Extracting per-player desperation | ❌ |
| Unplaceable hand after ad load | Rigged loss tied to monetization | ❌ |
| Energy/lives gating play | Artificial scarcity of play itself | ❌ |

---

## 1. The loops, by timescale

Addiction isn't one mechanic — it's four loops that hand off to each
other. Map every feature to a loop; a loop with nothing in it is the leak.

```
IN-MATCH (0–90s)      SESSION (the retry loop)    CAMPAIGN (500 levels)      DAILY/WEEKLY (habit)
─────────────────     ────────────────────────    ──────────────────────     ────────────────────
near-miss moments ──→ "you were 2s out!" ────────→ "Kano is 3 towns away" ──→ daily stop + streak
threat rhythm         streak stakes surfaced      star economy               champion race board
rescue drama          one-tap retry               unlock anticipation        comeback bonus
last-10s heartbeat    "the road calls"            boss skill collection      season reset
```

---

## 2. IN-MATCH loop — the 90 seconds itself

The atomic unit. Candy Crush's trick: **almost every move should feel like
it could be the one.** Our chase already generates near-misses — we just
don't measure or amplify them.

### 2.1 Measure "closeness" — the honest passProximity

We already have the data; we just never score it.

- `timeLeft` (line ~1781), `playerFreezes`, `playerRescues` are tracked
- The one number that matters: **how close to the objective was the player
  at the moment they lost?**
  - survive: `timeLeft` at final freeze → "1.8s from clear"
  - collect: `dropsGot / dropsNeed` → "1 drop short"
  - rescue: `playerRescues / count` → "1 mate left frozen"
  - hunt: `tagged / huntCount` → "one runner escaped"

**New:** `proximityScore(level, state) → 0..1` computed at loss. Store on
`Stats` (add `lastProximity`) and feed the end screen.

### 2.2 Surface it — "SO CLOSE" is the retry fuel

The end screen (`~2568`, the `won` branch and its loss twin) currently
shows `Frozen N× · Rescues · Xs survived` — raw stats, no stakes.

Add a proximity line on **losses only** (wins don't need it):

- `proximity ≥ 0.8` → **"SO CLOSE — {detail}"** + the RETRY button pulses
- e.g. *"1.8s from the whistle"*, *"one drop short"*, *"Femi was still frozen"*

This is the honest version of Candy Crush's "lose by 1": we didn't rig the
loss — we just *tell the truth about how close it was.* That truth IS the
one-more-try trigger.

### 2.3 The last-10-seconds heartbeat

`survive` levels end either in escape or a freeze. The most
addictive-feeling chase games compress the last stretch into a crescendo:

- **At `timeLeft ≤ 10`:** chaser speed `+8%` (they smell the whistle),
  heartbeat sfx under the music, vignette tightens.
- **At `timeLeft ≤ 5`:** crew mates *sprint* toward you for last-second
  rescue plays (they already pathfind to frozen allies — let them hover
  near the player too when `rescue ≥ .5`).

Knobs exist: `cState.speedMult`, `rState` AI steering, `Sfx`. This creates
the "I just barely made it" win AND the "froze at 1.9s" loss — both are
the same high-arousal moment.

### 2.4 Rescue drama is underpriced

The freeze/thaw loop is our signature mechanic — Candy Crush has nothing
like it — and it's currently quiet.

- **Rescue countdown ring** on frozen runners: a shrinking arc around the
  ice block showing decay-toward-perma-freeze (if the rules allow a decay;
  if not, show "thaw window" pressure differently — see 2.5).
- **"THAW ME" ping**: frozen player can tap/press to flash a marker over
  their block — makes crew rescue legible + gives the frozen player one
  input of agency (reduces the "watching paint" dead time).

### 2.5 The twist lever — perma-freeze pressure

On `twist` collect levels, leftover drops become hunters. Extend the
drama: on `refuge`/`rescue` levels, frozen runners can **ice over** —
full freeze needs a thaw chain (nearest living mate must touch twice).
Converts a binary state into a countdown — the same pressure CC gets from
"moves remaining" but native to our fiction.

*Guard:* only on levels flagged `twist` or chapter ≥ 4 — don't punish
early players with a second failure state.

---

## 3. SESSION loop — lose → retry → lose → win

Candy Crush's real engine: the *frictionless* retry with a stake attached.
Our loop: `end screen → RETRY → scene.restart()`. Already frictionless —
what's missing is **stakes and context**.

### 3.1 The streak is tracked and invisible — surface it

`Stats.streak` / `bestStreak` exist in `meta.ts` and literally nothing
reads them in gameplay. This is the cheapest, highest-value win in this
document:

- **Lobby HUD:** tiny flame chip `🔥 4` next to the name plate — only when
  streak ≥ 2.
- **Match intro card:** "protect the streak" tag under the level title
  when `streak ≥ 3`.
- **Loss screen:** the streak death needs a face — *"streak ends at 4"*
  in dim red under the stats. Losing a streak is a loss ON TOP of the
  level loss — doubling the retry impulse honestly.
- **Milestone gates:** "don't lose it here — a crown waits" when the level
  is a boss.

### 3.2 The honest streak-bender (our MakeEasierAction)

After **3 consecutive losses** on the same level, the level bends
*subtly and disclosedly*:

- `streakLose` counter per level in `adventureProgress` (new field).
- At `streakLose ≥ 3`: `initialChasers -1`, reinforcement `+20%` later,
  militia `speedMult ×0.95`.
- **Disclose it at the intro card:** *"the road heard you — easier
  stop"* — one line, no shame. The player KNOWS the game helped them and
  feels the company is kind, not rigged. This disclosure is the whole
  difference between CC's pattern and ours.
- Reset on win.

Mirror: **`MakeHarderAction` honest version** — win streak ≥ 5 on classic
mode bumps `chaserMult +0.05` up to +0.15, surfaced as *"they're hunting
harder — your streak bought attention."* Feels like earned status, not
punishment.

### 3.3 The retry under 400ms

From loss-screen-tap to controllable gameplay must feel instant. Audit
`transitionTo`/restart path: the blade wipe + scene restart should be
≤ ~400ms. Anything slower and the rage-quit window opens.

### 3.4 "The road calls" — exit guilt, honest edition

When the player picks THE ROAD/lobby from a **loss** (not a win): the map
screen greets them with the node they failed, still pulsing, plus the
proximity line ghosted over it ("1.8s, man"). They didn't just lose — the
road *remembers*. Costs nothing but a `lastFail` record in
`adventureProgress`.

---

## 4. CAMPAIGN loop — 500 levels is the moat

CC's $1B/yr is long-arc pacing. We have the better structure already —
the journey is *literal geography*. Exploit it.

### 4.1 Stars must buy something

Currently stars gate nothing (unlock check is just `stars[n] > 0` = "did
you win"). Give them three sinks:

1. **Milestone gate (soft):** town N unlocks at `totalStars ≥ N×10×1.6`
   — keeps casuals moving (1-2★ clears still advance) but makes 3★
   back-clearing profitable for the engaged.
   *Alternative if 500-gating feels punishing:* star sinks buy cosmetics
   (see 2), keep level-gate on wins only.
2. **Star-shop cosmetics:** fur dyes, regalia patterns, podium trims —
   priced in stars (30★, 60★, 120★ tiers). `stars` total already exists;
   a `redeemedCosmetics` set in progress storage is trivial. This is the
   honest version of gold bars — earned, never sold.
3. **Perfect-town badge:** 30/30 stars in a town stamps the map node gold
   and names the player "SHERIFF OF {town}" on the lobby plate for a
   session. Vanity titles are the cheapest durable reward in games.

### 4.2 The unlock anticipation arc — "next champion in 2 towns"

The character unlocks (milestones 3,6,9,12,15,20,25,30,40) are currently
invisible until you hit them. The wardrobe should show the **locked-next
champion silhouette** with *"beat the BAALE OF SURULERE to free them"* —
that's the long-arc hook: an explicit "play X more to earn Y" target, the
honest version of "X more moves for the offer."

### 4.3 Chapter pacing — visible destination

Map screen already shows the road. Add a persistent **chapter header**:
*"COMPOUND WARS — 21 of 50 stops · Kaduna in 3 towns"* — the brain files
"3 towns" as a sub-goal; chapter boundaries are natural session targets
("I'll stop after this town") that reliably become "one more town."

### 4.4 Boss levels are events — price them like it

Boss stops (every 10th) should *feel* different going in: the map node
already glows — add the boss's title under it pre-fight (*"OONI OF IFE
holds this town"*), play the milestone card slower, and on **first-attempt
loss** the boss *taunts* (one line: *"the Ife throne doesn't fall to
passersby"*). Bosses who talk lose→retry rates are measurably higher —
the loss has a face and a grudge.

### 4.5 The 500 — the endgame doesn't exist yet, admit it

Level 500 completion should mint something permanent: a `LEGEND OF THE
ROAD` title + a golden hero skin + the player's name written into the
town roll. Whatever — it must EXIST, even if nobody reaches it this year.
Visible endgame converts a grind into a pilgrimage.

---

## 5. DAILY / WEEKLY loop — the habit layer

This is where we currently have *nothing*. It's also the riskiest layer
for dark-pattern creep — design it as a gift, not a tax.

### 5.1 The Daily Stop (daily challenge seed)

One level per UTC day, seeded deterministically (`mapSeed = hash(date)`),
same for everyone:

- A special node on the map: *"TODAY'S STOP — {town} variant"*
- One attempt "counts" (replays allowed, only first scored); it posts to a
  daily leaderboard board (our API already has `/api/board` + `/api/score`
  — a `daily:{date}` key is a new board name, not new infra).
- Payout: +10★ equivalent progress or a daily cosmetic token.

Why it works (and stays honest): the daily is *content*, not a gate. It
gives a reason to open the app that isn't "the game punished you for
leaving" — and one seed/day worldwide is a shared ritual, the thing that
makes Wordle/Commute games sticky.

### 5.2 The streak-saver is banned; the streak *grace* isn't

Do NOT sell streak insurance (that's the dark version). Instead: the first
loss after a streak ≥ 5 converts to a **"grace loss"** — streak preserved
once per day, disclosed: *"the road forgives — once."* Generous, bounded,
non-transactional.

### 5.3 Comeback, not guilt

`lastPlayedAt` in stats; on return after ≥ 3 days:
- lobby shows *"the road missed you"* + **one comeback gift** (a cosmetic
  token or a free "start next town with a shield" buff).
- Never darken the UI, never countdown a punishment. The CC pattern is
  "you left, now pay"; ours is "you're back, welcome."

### 5.4 Weekly champion race (post-multiplayer)

The leaderboard board already exists — when multiplayer ships, a 7-day
rolling board (`week:{ISOweek}`) with a small crown cosmetic payout is the
weekly hook. **Defer until NetScene is live** — a solo weekly board is a
ghost town and teaches the wrong lesson.

---

## 6. The director — honest `MakeEasier/MakeHarder`

Wrap everything above into one function — the difficulty director. This is
the mechanism CC hides; ours is disclosed and bounded:

```ts
// director.ts — the road reads the player's week, never their wallet
export interface Assist { chaserMult: number; reinforceFrac: number; extraCrew: number; note?: string }
export function director(n: number, s: Stats, p: AdventureProgress): Assist
```

- **Inputs (all local):** `streakLose[n]`, `Stats.streak`, `playerFreezes`
  history, days-since-last-win. **Never** session-length, wallet, or
  ad-state — we don't have those anyway, keep it that way.
- **Output bounds:** `chaserMult ∈ [0.9, 1.15]`, reinforcements shifted
  ≤ 25%, ±1 crew. Hard floor/ceiling — a director with bounds can't be
  accused of rigging.
- **Disclosure:** any non-1.0 assist prints one line on the intro card.
  The kindness is the feature.
- **Cooldown:** assists apply per-level (a stuck player gets help on
  THAT stop, not a blanket nerf to the campaign).

---

## 7. Ship order — cheapest honest wins first

| Phase | Work | Effort | Loop served |
|---|---|---|---|
| **0 — surface what exists** | streak chip in lobby; "streak ends at N" on loss; proximity score + "SO CLOSE" line | ~1 day | session |
| **1 — the director** | `director()` + streakLose counter + intro-card disclosure + boss taunts | ~2 days | session + campaign |
| **2 — drama** | last-10s crescendo (speed, heartbeat, crew hover); rescue countdown ring; THAW-ME ping | ~3 days | in-match |
| **3 — star economy** | star-shop cosmetics; perfect-town title; locked-champion silhouette in wardrobe | ~3 days | campaign |
| **4 — daily** | daily seeded stop + daily board + comeback gift | ~3 days (+ API key) | daily |
| **5 — season** | weekly board, season reset, LEGEND endgame | when MP lands | weekly |

Do not ship 4 before 0–3 — a daily challenge into an untuned core loop
advertises a weaker game daily.

---

## 8. Instrumentation — or none of this is real

Track in `Stats` (localStorage is fine pre-API):

- `proximity` at every loss → **target: ≥ 60% of losses are proximity ≥ .7**
  (near-misses = retry fuel; blowouts = churn)
- `retriesAfterLoss` / `retriesAfterWin` → the SO-CLOSE line should move
  the first number up
- `streakLose` distribution → find the actual rage-quit cliff (3? 4? 6?)
- `daysSinceLastWin` on session start → comeback trigger AND difficulty
  drift detector
- `dau_return` — does the daily stop actually bring players back

If the proximity distribution sits below ~50%, the levels are too binary —
that measurement ALONE tells you whether the game feels "rigged against
me" or "almost had it."

---

## 9. The line — explicitly banned

So it's written down and can't creep:

1. **No lives/energy/timers that charge back for play.**
2. **No reward scaling that punishes proximity** (the CC ad inversion).
3. **No state-based pricing of anything, ever.**
4. **No hidden difficulty coupling to purchases** — we have no IAP; if
   that ever changes, the director's inputs stay win/loss history only.
5. **No fake scarcity / countdown stores / "98% of players failed"**
   social-pressure copy that isn't literally true.
6. **Every assist is disclosed once per level.** The moment we're hiding
   the bend, we've built the thing we mocked.

The whole thesis: Candy Crush's *retention mechanics* and its
*monetization mechanics* are separate machines that shake hands. We adopt
the first machine verbatim-ish and bolt the second machine's casing to
the floor.
