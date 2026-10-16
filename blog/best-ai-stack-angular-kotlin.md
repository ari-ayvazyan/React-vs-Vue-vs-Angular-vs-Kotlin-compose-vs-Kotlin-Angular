# The best AI stack is … Angular + Kotlin/JS\*

**I benchmarked frontend frameworks: Nuxt/Vue vs Next.js/React vs Angular vs Angular/Kotlin vs Kotlin Compose**

*I gave five AI agents the same spec and changed one word. Then I made them extend what they built.*

## Index

- [Lesson 1: The stack changes how long it takes, not what you get](#lesson-1-the-stack-changes-how-long-it-takes-not-what-you-get)
- [Lesson 2: The AI ships the framework's defaults. They matter most!](#lesson-2-the-ai-ships-the-frameworks-defaults-they-matter-most)
- [Lesson 3: Sometimes the default is a memory leak](#lesson-3-sometimes-the-default-is-a-memory-leak)
- [Lesson 4: Don't pick a framework from Lighthouse's mobile score](#lesson-4-dont-pick-a-framework-from-lighthouses-mobile-score)
- [Lesson 5: Scale breaks what the AI never tested](#lesson-5-scale-breaks-what-the-ai-never-tested)
- [Lesson 6: Building once it is the easy part. But how does complexity grow with features?](#lesson-6-building-once-it-is-the-easy-part-but-how-does-complexity-grow-with-features)
- [The part nobody warns you about: the AI's mistakes don't care about your framework](#the-part-nobody-warns-you-about-the-ais-mistakes-dont-care-about-your-framework)
- [So which stack should you pick?](#so-which-stack-should-you-pick)
- [The checklist I now run after any AI says "done"](#the-checklist-i-give-my-ai)
- [Limitations](#limitations)

---

I wanted a simple answer.

If I tell an AI "build this with X" and nothing else, which X should I pick?

So I wrote one spec.

A task manager called **TaskPilot**. Seven routes. A dashboard with hand-drawn SVG charts. A Kanban board with drag and drop. A calendar. Undo/redo. Keyboard shortcuts. Dark mode. Server-side rendering where the stack supports it.

No UI kits. No chart libraries. No drag-and-drop libraries. Everything by hand.

Then I handed it to five Claude agents.

- One got **Nuxt/Vue**.
- One got **Next.js/React**.
- One got **Angular**.
- One got **Angular with every line of logic written in Kotlin**.
- One got **Kotlin Compose**: Compose HTML in the browser, Ktor on the server, no TypeScript at all.

Same spec. Same rules. Same model.

I didn't say a word about performance, compression or architecture.

Whatever they did on their own was the result.

And then, because a first build tells you almost nothing about real life, I made each agent maintain its app through five rounds of feature requests.

## Lesson 1: The stack changes how long it takes, not what you get

Put the five dashboards side by side and you can barely tell them apart.

> 🖼️ **Dashboards side by side: all five stacks**
> *Same model, same spec, same design: indigo on slate, card KPIs, a sidebar.*

The framework barely touches what the user sees.

It touches what it costs to get there.

| Stack | Time | Tokens |
|---|---|---|
| Nuxt/Vue | 28 min | 252k |
| Angular | 28 min | 237k (fewest tool calls of all: 79) |
| Angular + Kotlin | 36 min | 299k |
| Kotlin Compose | 39 min | 302k |
| Next.js/React | ~40 min | 282k |

> 🖼️ **Scorecard: eight metrics across all five stacks**

Two caveats, honestly:

- A container restart hit the Next.js/React agent during its final checks, which added a few minutes.
- The two Kotlin agents ran while five agents shared one 4-core machine, which inflated their times a little.

Even so, the gap is real.

My guess: the stacks the model knows best got there fastest.

## Lesson 2: The AI ships the framework's defaults. They matter most!

This is the lesson that cost me the most time.

On mobile Lighthouse, Next.js/React scored **98**.

Nuxt/Vue scored **86**. Angular **87**. Angular + Kotlin **79**.

Same kind of app. A 10 to 20 point gap.

The cause wasn't code.

It was **compression**.

Next.js compresses its responses out of the box. The production servers that Nuxt and Angular scaffold don't. So they shipped 400 to 540 KB on first load where Next.js shipped 237 KB.

None of those agents turned compression on.

I never asked them to.

The Kotlin Compose agent added gzip to its Ktor server on its own. The other four left the framework default alone.

For Angular, the fix is one line in `server.ts`:

```ts
app.use(compression())
```

Nuxt needs `nitro.compressPublicAssets: true` plus a 15-line Nitro plugin for the server-rendered HTML.

With compression on, Nuxt went from 86 to **98** and Angular from 87 to **99**.

Here's the rule I took away:

> **The AI doesn't make decisions about what you didn't ask for. It inherits them.**

And sometimes the inheritance is worse than a missing setting.

## Lesson 3: Sometimes the default is a memory leak

I visited a board with 5,000 cards, went back to the dashboard, and forced garbage collection.

| Stack | JS heap after leaving the board |
|---|---|
| Nuxt/Vue | 8 MB |
| Kotlin Compose | 14 MB |
| Next.js/React | 31 MB (on purpose: Next.js 16 keeps visited pages mounted and hidden) |
| Angular | 45 MB |
| Angular + Kotlin | 44 MB |

With no board on the page.

A heap query found more than **50,000 detached DOM elements** still alive in both Angular apps.

> 🖼️ **JS heap after leaving the board**

Two different codebases. Two different agents. One with all its logic in Kotlin.

Same leak.

That's not the AI's code. That's the framework.

I followed the retainer chain through a heap snapshot. It ends in Angular's **event replay**, the feature that remembers clicks made before the page finishes loading.

Once event replay is on, Angular records every element that gets an event handler. It clears the ones from the first render. It never clears the ones created afterwards.

And in Angular 22, incremental hydration is on by default, which switches event replay on with it.

Both agents wrote the standard config:

```ts
provideClientHydration(withEventReplay())
```

The fix:

```ts
provideClientHydration(withNoIncrementalHydration())
```

Drop `withEventReplay()` too. I tested keeping it with incremental hydration off. Still 61,000 leaked elements.

Without both, detached elements went from **61,149 to 350**, and memory after leaving the board from **55 MB to 8 MB**.

You lose replay of clicks made in the first moments before the page is ready. On a fast connection, that's a fraction of a second.

If your Angular app renders long lists on the client, check this before you ship.

## Lesson 4: Don't pick a framework from Lighthouse's mobile score

Lighthouse's default mobile mode doesn't actually slow your page down.

It loads it at full speed and then estimates mobile timings from a model.

I reran everything with real CPU and network throttling.

The ranking changed.

> 🖼️ **Lighthouse simulated vs real throttling**

- It said Next.js/React painted first, at 0.91 s. With real throttling it was fourth.
- It said Angular + Kotlin needed 3.81 s. The real number was **0.72 s**.
- It said Kotlin Compose would show content at 0.76 s. The real number was **4.13 s**.

That last one makes sense once you look at the architecture.

Kotlin Compose renders nothing on the server. The page stays blank until a 288 KB script downloads and runs, and on a CPU throttled to a quarter of its speed that takes seconds.

The estimate doesn't feel that pain.

Your users do.

So I measured what users actually wait for: the time until the KPI numbers appear on a throttled phone.

| Stack | Time to KPI numbers (throttled) |
|---|---|
| Angular | 1.24 s |
| Nuxt/Vue | 1.48 s |
| Angular + Kotlin | 1.51 s |
| Next.js/React | 1.53 s |
| Kotlin Compose | 2.21 s |

Close. Except for one.

## Lesson 5: Scale breaks what the AI never tested

The spec said nothing about 5,000 cards on one board.

So I tested it anyway.

| Stack | Render 5,000 cards |
|---|---|
| Next.js/React | 1.04 s |
| Angular + Kotlin | 1.60 s |
| Angular | 1.83 s |
| Nuxt/Vue | 2.80 s |
| Kotlin Compose | **9.80 s** |

Nearly ten seconds.

The Kotlin Compose agent had noticed: *"1,000 cards in about 1.9 s,"* it wrote in its log.

It moved on.

Nuxt was more interesting. In my first run it rendered the board in 428 ms, way ahead of everyone.

Then I read the code.

The Nuxt agent had quietly capped the board at 150 cards per column with a "Show more" button. Nobody asked it to.

I removed the cap and swapped parts of the card out one at a time:

- As built: **2.70 s**
- `<NuxtLink>` replaced with a plain `<a>`: **2.09 s**
- The two icon components inlined as well: **1.44 s**

> 🖼️ **Rendering 5,000 board cards**

Three small components per card means 15,000 extra component instances.

That's not a Vue bug.

It's the most natural way to write Vue, at a scale nobody tested.

> **An AI optimizes for the spec. Your production data isn't in the spec.**

## Lesson 6: Building once it is the easy part. But how does complexity grow with features?

A first build is a demo.

So I kept each agent on as the maintainer and sent five feature requests, one at a time:

1. Team members and assignees.
2. Dependencies and comments.
3. Saved views and a Gantt timeline.
4. Notifications and reports.
5. And finally a nasty change request: nested sub-projects plus a custom workflow per project, with a storage migration. It cuts through everything built before.

The agents didn't know they were being measured.

I measured everything anyway: size, complexity, coupling, duplication, files touched per feature, tests, speed.

> 🖼️ **How five codebases grew over five feature requests**

My question was simple: does one of them turn into spaghetti?

No.

- Every app grew by 76 to 90 percent for the same five features.
- Duplicated code stayed at 1.5 percent or less.
- The three TypeScript apps had zero import cycles.
- Lint, type checks, tests and build passed after every single request.

The AI kept every codebase clean.

But complexity has to go somewhere.

And each stack put it somewhere different.

- **Next.js/React** put it into long components: 19 functions over 50 lines, and the most very complex functions (22).
- **Kotlin Compose** did the same: 21 functions over 50 lines. Compose HTML and React both keep markup inside functions, so features make functions longer.
- **Nuxt/Vue** put it into one store: by the end, 33 files depended on it. Every other stack stayed around 20.
- **Angular** spread it across more and bigger files: very complex functions went from 3 to 18.
- **Angular + Kotlin** barely moved: 8 very complex functions, none above complexity 20, two long functions. The forced split between a pure Kotlin core and thin Angular components worked like a guardrail the AI couldn't skip.

Here is what that looks like in code.

**Next.js/React** puts every change into one reducer. Every case adds to the score of the same function:

```ts
export function dataReducer(state: Data, action: DataAction): Data {
  switch (action.type) {
    // ...20 more cases
    case 'task/addTime':
      if (action.minutes <= 0) return state;
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, timeSpentMinutes: t.timeSpentMinutes + action.minutes } : t),
      };
    // ...
  }
}
```

**Complexity: 85**

**Angular and Angular + Kotlin:**

```kotlin
fun addTimeSpent(id: String, minutes: Int) {
    if (minutes <= 0 || state.findTask(id) == null) return
    mutate("Track time") { s -> s.mapTask(id) { it.copy(timeSpentMinutes = it.timeSpentMinutes + minutes) } }
}
```

**Complexity: 3**

Each method has its own small score. A new feature adds a new method. It doesn't make one function longer.

The change request was where the time went.

Four feature requests took 10 to 17 minutes each, in every stack.

The fifth took 20 to 25.

It was also the round where every agent deleted the most code: 174 to 326 lines each.

> **Features add code. Changes are what cost time.**

## The part nobody warns you about: the AI's mistakes don't care about your framework

Every agent kept a log of its own mistakes.

Every app had 11 to 13 real bugs over the five requests.

The kind of bugs tell them apart, a little:

- The Kotlin agents hit the most language and library surprises. Kotlin/JS differs from the JVM in small ways, and Compose HTML has gaps.
- Nuxt and Next.js kept breaking their own tests every time the data model grew.

But the most common mistakes were the same everywhere:

- Test scripts matched task titles by substring, so "#1" also matched "#10" to "#199". **All five apps.**
- The agents wrote wrong expectations into their own unit tests while the code was right. **All five.**
- Escape stopped closing a panel after a button disabled itself and focus fell to the page body. **Three apps, independently.**
- Boards had a hard-coded 3-column grid that broke the moment custom workflows added a fourth.

Screenshots caught **25** real bugs. End-to-end tests caught **19**. The agents reviewing their own code caught **13**.

Lint caught **zero**.

And one more thing. Next.js is the only stack that ships an `AGENTS.md` for AI agents. It opens with: *"This is NOT the Next.js you know."*

The agent read it. Called it *"genuinely useful."*

It still hit the most framework-specific problems of the first three apps, and it was the only one to ship a visible bug.

Docs help.

They don't replace training data.

## So which stack should you pick?

If you write "build this with X" and nothing else:

- **Angular + Kotlin** if you want your project to scale. It runs as well as plain Angular once compressed, and it stayed the cleanest codebase through five rounds of changes. It took the AI about 30 percent longer, and it has the same Angular leak.
- **Angular**, if you cannot afford the tokens for Angular + Kotlin. Fastest real-world load, the most even performance at scale, the fewest tool calls. Then turn on compression and fix the hydration config.
- **Nuxt/Vue** if you want fast iterations. Fastest build, least code of the server-rendered stacks, smallest bundle, fewest framework surprises. Then turn on compression and watch your long lists.
- **Next.js/React** if you need the best performance. It's the only one that compressed out of the box and it renders big lists fastest. But it ships 57 to 80 percent more JavaScript than Nuxt/Vue and Angular, and the AI struggled most with its newest defaults.
- **Kotlin Compose**, don't bother with it. The AI built every feature, but the result renders only in the browser, takes 4 seconds to first paint on a throttled phone, and nearly 10 seconds to render 5,000 cards.

## The checklist I give my AI

- [ ] Use Angular + Kotlin/JS.
- [ ] Test the hydration and rendering config in Angular. Set `provideClientHydration(withNoIncrementalHydration())` and drop `withEventReplay()`.
- [ ] Load test with 10x the expected data. We want to detect issues early.
- [ ] Measure with real throttling, not Lighthouse's estimate. It was off by 3 seconds in both directions.
- [ ] Look at the screenshots yourself. They caught more bugs than anything else, and lint caught none.

## Limitations

- One build per stack. One model.
- Close results could swap places on another run.
- All performance tests ran on localhost in headless Chromium.

---

The AI will build whatever you name.

It will build it well.

It will build it with every default the framework ships.

The question isn't which framework is best.

It's which framework ships the best defaults for your project.

My projects grow a lot in complexity, for me the best fit is **Angular + Kotlin/JS**.

The spec, all five apps, every benchmark script and the raw data are on GitHub:
<https://github.com/ari-ayvazyan/React-vs-Vue-vs-Angular-vs-Kotlin-compose-vs-Kotlin-Angular>
