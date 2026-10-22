# DESIGN.md — Polish Playbook (Phase P5 only)

Governed by `AGENTS.local.md`. **Do not open this file until the money shot works end to end.**
Design is P5 — the last phase before you ship at `F` (82–100% of `F`, per `AGENTS.local.md` §1).
A beautiful landing page in front of a broken product loses to an ugly product that works.

**The visual bar is unconditional.** It does not scale down when the rubric weights design lightly.
Judges read visual quality as a competence proxy on *every* criterion — a submission that looks like
a real product gets read more generously everywhere else.

**The time box is equally unconditional**, and there is exactly one way those two facts coexist:
**compose from pre-built, designer-made blocks — never author visuals or motion from scratch** (§6).
Composition makes ambition nearly free. Authoring makes it unbounded and, because you cannot see the
result, unreliable. If a look cannot be assembled from the block library inside P5, **it gets cut** —
it does not get hand-rolled, and it never pushes `F`.

The only thing that still scales with the rubric's design weight is **bespoke** work — custom
shaders, 3D, illustration. The default for all of it is none.

---

## 1. What actually reads as "polished" to a judge

Items 1–6 are **prerequisites, not options**. No amount of animation compensates for failing them —
motion layered over inconsistent spacing and default type reads as *worse* than no motion at all.
Do these first, in this order, then do §6.

1. **One typeface, one accent color, consistent spacing.** This alone separates "designed" from
   "default." Most amateur-looking projects fail here, not on missing animation.
2. **No layout shift, no flash of unstyled content, no scrollbar jank.**
3. **Real content, real copy.** Lorem ipsum and `Button` labelled "Button" read as unfinished.
4. **Loading / empty / error states that look intentional.** Skeletons, not spinners; a designed
   empty state, not a blank div.
5. **Alignment and rhythm.** Everything on the same grid, consistent gaps, optical alignment of
   icons to text.
6. **Focus and hover states** on everything interactive.
7. **Motion, from the block library.** Signature moments composed from §6's shortlist — never
   keyframed by hand.

---

## 2. Token system (define once, in `globals.css` + Tailwind theme)

Never hardcode a color, size, or radius in a component. If you need a value that isn't a token,
either add it as a token or you're wrong about needing it.

**Color** — one accent, one neutral ramp, semantic states only:

| Token | Use |
|---|---|
| `--background` / `--foreground` | Page base and body text |
| `--muted` / `--muted-foreground` | Secondary surfaces and text |
| `--card` / `--border` | Elevated surfaces and hairlines |
| `--primary` / `--primary-foreground` | The one accent — CTAs and active state only |
| `--destructive`, `--success`, `--warning` | State feedback only |

Rules: **one** accent color, used sparingly so it means "act here." Neutrals do 90% of the work.
Support light and dark **only if both are actually tested** — a broken dark mode is worse than none;
if you can't verify it, force one theme with `color-scheme`.

**Type scale** — one variable font (self-hosted via `next/font`; no render-blocking CDN), max two
weights:

```
display 48/56 -0.02em   h1 32/40 -0.01em   h2 24/32   h3 20/28
body 16/26              small 14/20        caption 12/16 (labels only)
```

Body text never below 16px. Measure 60–75 characters. Numbers in tables/scores use tabular figures.

**Spacing** — a 4px base scale: `4 8 12 16 24 32 48 64 96`. Nothing else. Section vertical rhythm:
64px mobile, 96–128px desktop. Container max-width 1120px with 20px gutters.

**Radius:** one value (`8px` or `12px`) plus `full` for pills/avatars.
**Elevation:** two shadows total — a subtle resting shadow and one lifted. Prefer borders over shadows.

## 3. Component hierarchy

Build these once, from shadcn/ui, themed to the tokens; never style ad hoc:

`Button` (primary / secondary / ghost / destructive, one size scale) · `Input` + `Label` +
`FieldError` · `Card` · `Badge` · `Dialog` · `Toast` · `Skeleton` · `EmptyState` · `Tooltip`

Layout primitives: `PageShell`, `Section`, `Container`, `Stack`, `Grid`. Every page composes from
these — no bespoke padding per page.

Icons: **lucide-react only**, one size per context (16px inline, 20px buttons, 24px nav),
`currentColor`, always `aria-hidden` when decorative.

## 4. Mobile-first, thumb-first

Design at **375px first**, then widen. Non-negotiables:

- Touch targets ≥44×44px, ≥8px apart.
- Primary CTA reachable in the bottom third of the screen on mobile; sticky bottom bar if the
  demo path needs it.
- No horizontal scroll. Ever. Test with a long unbroken string and with a wide table.
- Modals become full-screen sheets below `sm`.
- Respect safe-area insets and `100dvh` (not `100vh`) so mobile browser chrome doesn't clip the CTA.
- Test with the on-screen keyboard open on any screen with an input.

Breakpoints: Tailwind defaults only (`sm md lg xl`). No custom breakpoints.

## 5. Accessibility minimums (cheap, and it's a quality signal)

- Text contrast ≥4.5:1; UI/borders ≥3:1. Check the accent-on-white pairing specifically — it's
  usually the failure.
- Visible focus ring on every interactive element. Never `outline: none` without a replacement.
- Semantic HTML: real `<button>`, real headings in order, labelled inputs, `<main>`/`<nav>`.
- Keyboard-complete demo path: tab through the whole script without touching the mouse.
- Announce async results to screen readers via a live region; don't rely on color alone for state.
- Honor `prefers-reduced-motion`.

## 6. Motion — composed, never authored

**Rule zero: you cannot see.** You cannot judge an easing curve, catch jank, or notice two effects
fighting each other. So do not invent motion. Every animated element comes from a designer-made
block library, used **unmodified** except for color tokens, copy, and layout. Hand-keyframed
animation is precisely how a page ends up looking worse than if it had none.

### Engine: GSAP

**GSAP is the default animation engine.** Since 30 April 2025 it is 100% free including every
formerly Club-only plugin — SplitText, MorphSVG, ScrollSmoother, ScrollTrigger — commercial use
covered. Nothing else matches its timeline control or ScrollTrigger.

```powershell
npm install gsap @gsap/react
```

**Install GSAP's official agent skills first** — GreenSock maintains them precisely for this:
`https://github.com/greensock/gsap-skills` (`skills/gsap-react/SKILL.md` covers `useGSAP`, refs,
`gsap.context()`, cleanup and SSR; MIT). Use those canonical patterns instead of writing GSAP from
memory. This is not optional — it is the difference between GSAP that works and GSAP that leaks
ScrollTriggers on every navigation.

**Licence, precisely:** GSAP is *not* MIT. It ships under GreenSock's standard "no charge" licence,
which also **prohibits** use inside tools that let users build visual animations without code in
competition with Webflow. If a candidate idea is a no-code animation builder, GSAP is off the table
— flag it at §0.4 rather than discovering it at submission. Your repo stays MIT; GSAP keeps its own
licence, and the README says so (`AGENTS.local.md` §7).

**Next.js App Router footguns — each of these is an hour lost if met blind:**

- **ScrollTrigger touches `window` when registered.** Registering at module top level breaks the
  build. Guard it: `if (typeof window !== "undefined") gsap.registerPlugin(useGSAP, ScrollTrigger)`.
  This is the single most common way adding ScrollTrigger breaks a Next build.
- `gsap.registerPlugin(useGSAP)` runs **once, at module top level, outside the component.**
- Only the **animated leaf** gets `"use client"`. The page stays a Server Component.
- Always pass `{ scope: containerRef }` so selectors resolve inside your tree, not the whole page.
- **Never gate returned JSX on `typeof window` or a mounted-flag `useState`** — that is a real
  hydration mismatch. The server HTML must already match the animation's *start* state.
- Wrap event-handler animations in `contextSafe()` so they no-op after unmount.

### Block libraries, in order of preference

| Library | Why | Caveat |
|---|---|---|
| **react-bits** — `reactbits.dev` | 110+ components; pulls GSAP in only for the components that need it. **The only one shipping `prefers-reduced-motion` handling by default.** MIT. Per-component install: `npx shadcn@latest add "https://reactbits.dev/r/…"` — you own the code | Newer; confirm each component compiles against the installed React version |
| **Aceternity UI** — `ui.aceternity.com` | 200+ blocks including hero sections and shader backgrounds — closest to the dark/cinematic reference look, so reach here first when the brief calls for drama | All-Access Pass is paid. **Never integrate a paid block** — confirm free first |
| **Magic UI** — `magicui.design` | 150+ components, shadcn companion | Pro tier is paid — free components only |
| **Motion** — `motion.dev` | Only if a chosen block already depends on it. Do not run Motion *and* GSAP as two engines for effects you wrote yourself | In a Server Component, import `motion/react-client`, or the build fails with *"unsupported to use `export *` in a client boundary."* React 19 needs `framer-motion@12`+ |

### The scouting pass — 10 minutes, fixed, once, in P5

Check whether something better shipped recently, then stop.

- Hard 10-minute box. It is a check, not a research project.
- **Never switch after blocks are already integrated.** Re-integration mid-P5 is unbounded work.
- Reject anything published in the last week (`AGENTS.local.md` §3), anything with a paid
  dependency, and anything needing a second animation runtime alongside one you already have.
- Record what you checked and the decision in the brief. If nothing beats the shortlist, say so in
  one line and move on.

### The hero moment — go big here, exactly once

**One moment on the page is allowed to be maximal.** Spend the drama budget there, from the GSAP
recipes below, and keep everything else disciplined. Ambition concentrated in one place reads as
confident; ambition sprayed everywhere reads as noise.

Recipes that reliably land, all standard GSAP with official documented examples:

- **ScrollTrigger pinned scene** — pin the hero and scrub a timeline as the user scrolls.
- **SplitText headline reveal** — per-character or per-word stagger, mask-clipped, on load.
- **Scrub-linked sequence** — tie a timeline's `progress` to scroll so the visual explains the product.
- **Horizontal scroll section** — one pinned track that moves sideways.
- **Parallax depth layers** — 2–3 layers at different `yPercent` rates behind the hero.
- **Flip** — animate a real layout change (card → detail) instead of faking it.
- **MorphSVG** — one logo/shape morph, if you have the SVGs already.

**Compose these from documented recipes, not invention.** The unit you copy is a *whole working
recipe* from GSAP's docs, the official skill, or a block library — then retheme it. You still may
not hand-tune easing curves and timings by feel, because you cannot see the result.

**Hard gates on the hero moment — it is cut if any fail:**

- **60fps on a mid-range laptop.** Check with devtools' FPS meter. A janky "jaw-dropping" animation
  reads as broken software, which is worse than a static hero.
- **Never scroll-jack the demo path.** Pinning and smooth-scroll on the marketing hero is fine; on
  any screen a judge uses to *operate* the product it is hostile — they are on a trackpad, in a
  hurry, and will read fighting the scroll as a bug.
- **Never delay the money shot.** "Try the demo" must respond instantly. No entrance animation
  gating a click, no preloader, no 2-second intro sequence.
- **Degrades cleanly:** `prefers-reduced-motion` turns it off, and a failed asset or plugin leaves a
  static hero that still reads correctly — never a blank screen.
- Mobile: verify at 375px. Pinned scroll scenes are the first thing that breaks on small viewports.

### Achievable from blocks in ~2 hours — high impact, low risk

Near-black background with one saturated accent · large tight-tracked display type · radial or conic
glow behind the hero · dot/grid pattern with noise overlay · staggered scroll-reveal on sections ·
spotlight or border-glow cards · logo/tech marquee · animated gradient beams or borders · animated
number counters · text scramble on the headline · one sticky pinned scroll section.

### Traps — do not attempt

- **Custom WebGL/shader heroes.** Days of work, unbounded risk, and you cannot evaluate the output.
  Use a prebuilt shader background block, or nothing.
- **Bespoke 3D scenes.** The bottleneck is asset creation, not code.
- **Custom cursor physics, SVG morphing, hand-drawn illustration systems.**
- **Imitating a mature product's micro-interactions.** What makes a Linear-class site feel that way
  is restraint and consistency accumulated over years, not animation count — adding animations to
  imitate it moves you further away. Copy the *discipline*: fewer moments, executed cleanly.

### Budget and mechanics

- **One hero moment plus one secondary signature moment** — maximum. Beyond that it reads as a demo
  reel and the product stops being the thing judges remember, which is a loss even if it looks great.
- Micro: 120–180ms, `ease-out`, **opacity and transform only** — never animate layout properties.
- Signature: ≤400ms, and it should *explain* something (data arriving, a result computing).
- Never block interaction on an animation. Never animate on every render.
- Honor `prefers-reduced-motion` — verify it by toggling it, don't assume the library handled it.
- Scroll-linked effects: use the library's implementation, never a hand-rolled scroll listener.

## 7. The landing / hero section

**Time-box: ~2 hours, inside P5, and only because every visual comes from §6's block library.** It is
a section above your working app, not a separate marketing site. Purpose: orient a judge in 5 seconds
and get them into the demo in one click. If it is running long, drop sections — never extend the box.

Required, in order:

1. **Headline** — what it does, in plain language, no cleverness. A judge who reads only this
   should understand the project.
2. **Subhead** — who it's for and the concrete outcome, one sentence.
3. **Primary CTA: "Try the demo"** → one click into the money shot, no signup (`AGENTS.local.md` §5).
   One secondary link (repo or 60-second video). No third CTA.
4. **Proof of the thing working** — a live embed, a real screenshot, or an autoplaying muted
   ≤10s loop of the actual product. Not an illustration.
5. **How it works** — 3 steps or a small architecture diagram. This is where technical judges
   award points; don't hide it.
6. Optional: the honest artifacts in §8.

Do not build: pricing tables, "trusted by" logo walls, testimonial carousels, newsletter
capture, blog, cookie-consent theater, or a footer with dead links.

## 8. Honest substitutes for social proof

You have no users, so **fabricating proof is banned** (`AGENTS.local.md` §9). What actually persuades
judges more than fake quotes anyway:

| Instead of | Ship this |
|---|---|
| Invented testimonials | A quote from a real test user, attributed and dated — or nothing |
| Fake user counts | A live counter of real activity, or your own usage during the build |
| Made-up benchmarks | A benchmark you actually ran, with the method and the command shown |
| "Trusted by" logos | The tech/APIs you built on, labelled as the stack |
| Vague "10x faster" | A measured before/after with the numbers and conditions |
| Fake case study | A 30-second "watch it solve a real example" clip |

If something is mocked, say so in the UI or README. "Simulated data for demo" costs you nothing
and buys credibility for everything else on the page.

## 9. P5 exit audit — look at it, then check it

**Capture the page and actually inspect it.** You can read images; use that. Screenshot the hero and
every landing section at 375px and 1440px, open the files, and judge them. Fix what is plainly wrong:
overlapping text, an element off the grid, a glow swallowing the headline, failing contrast, a
section that reads as empty. Zero-install options (confirm flags with `--help`; do **not** add a test
framework, `AGENTS.local.md` §3):

```powershell
# Chrome headless — no install if Chrome is present
chrome --headless --screenshot=hero.png --window-size=1440,900 http://localhost:3000

# or a one-off Playwright CLI run — downloads a browser, takes a few minutes
npx playwright screenshot --viewport-size=375,812 http://localhost:3000 mobile.png
```

**Honest limit: a still cannot show motion.** It cannot reveal jank, a jarring easing curve, or two
effects colliding. For motion you therefore have *structural* guarantees only — unmodified library
components, reduced-motion honored, no layout-property animation, nothing over 400ms. So at the gate,
**report motion as verified-as-stills-only and post the preview URL** so the user can judge timing.
Never claim the motion "looks good." You did not see it move.

Then walk the demo path in a fresh incognito window at 375px and at 1440px, and confirm:

- [ ] Zero hardcoded colors/spacings outside the token system.
- [ ] One typeface, ≤2 weights, no FOUT/FOIT, no layout shift on load.
- [ ] Every interactive element has hover, focus, active, and disabled states.
- [ ] Every async surface has skeleton, empty, and error states — designed, not default.
- [ ] Contrast checked on the accent pairing and on muted text.
- [ ] Full keyboard pass of the demo path.
- [ ] No horizontal scroll at 320px, 375px, 768px, 1440px.
- [ ] No dead links, placeholder text, "Button" labels, or unimplemented nav items.
- [ ] Nothing on screen is fabricated proof.
- [ ] Motion respects `prefers-reduced-motion` (toggled and checked) and stays inside the §6 budget.
- [ ] Screenshots captured and inspected at 375px and 1440px; anything found is reported, not glossed.
- [ ] Every animated element came from the §6 shortlist or a documented GSAP recipe — nothing invented.
- [ ] Hero moment holds 60fps, doesn't scroll-jack the demo path, and never delays the money shot.
- [ ] GSAP `registerPlugin` is `window`-guarded; no ScrollTrigger leaks across navigation.
- [ ] No paid or licence-restricted block shipped; GSAP's non-MIT licence noted in the README.
- [ ] Favicon, page `<title>`, and OG image set (the OG image is what appears in the submission
      and in every Slack/Discord link — 10 minutes, disproportionate payoff).

The visual floor above is **not** negotiable against the rubric. What is negotiable is any *bespoke*
work beyond the block library — default none. Once the floor is met and this audit passes, **stop
polishing and go rehearse the pitch**: the marginal hour is worth more there than on a third
signature animation.
