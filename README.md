# Drone Show Designer

Design drone light shows in the browser: arrange formations on a timeline, sync them to music, layer light cues on top, and preview the result from the audience's seat. Every edit is checked for safety, and the checks are exact.

Built for small agencies and operators who need to go from an idea to a convincing client preview quickly, without giving up a show that can actually fly.

![Editor: scene list, audience view, inspector, and a timeline with scenes, light cues, and the music with its sections and hits](docs/screenshot.png)

## The flagship show

**Odyssey** (File → New show) is a 15-minute, 400-drone show in four acts, built entirely through the editor's own model API and required by the tests to pass every safety check. It plans in the background in a few seconds. It comes with its own **original score**, composed to the show like a film score. Every formation arrives on a bar line, and each act builds into a drop that hits exactly as its hero formation lands: the tree, the Earth, the LED sign, Saturn and the ring of fire. THANK YOU gets a quiet break, and the landing gets an outro. The lights follow the score.
- **Dawn:** a breathing sunrise that ripples up from the pads, and WELCOME written on over a starfield.
- **Earth:** a swaying 3D tree, a bloom, a beating heart, and a swirling Earth. Then an ant-walk column marches over an arch into an LED sign scrolling "TOGETHER WE SHINE".
- **Sky:** a bobbing hot-air balloon, a rocket that launches on a strobe, Saturn swirling in, a galaxy with a halo and starfield, and a cascading helix.
- **Finale:** THANK YOU flipping into place inside a frame, a ring of fire, a gold star, a bursting firework with flashes, and GOOD NIGHT written on. The drones then rain down to land.

## How it works

A show is a sequence: **takeoff → scene → scene → … → return & land**. Each scene is a formation that the drones hold for a while. Between scenes, the drones fly.

- **Formations come from shapes, text, or images.** There are 2D shapes (circle, heart, star, polygon, grid, spiral, wave), 3D shapes (sphere, torus, cube, double helix, cone), text in sans, serif or dot-matrix fonts, and image/logo import where each drone takes its pixel's colour. A scene can combine several shapes and share the drones between them.
- **Edit in the 3D view.** Select a formation (or click its drones) and move, rotate or scale it with the gizmo (**W E R**). It snaps to 1 m, 5° and 5% steps; hold Alt to move freely. While you drag, a ghost of the formation follows instantly. The floor, ceiling and fence light up, and the ghost turns red if it leaves the airspace. Scaling stops at the smallest safe size. **Alt + arrows** nudge the formation, and **F** frames it.
- **Idle drones have a job.** When a formation doesn't need every drone, the spares can be *parked* dark behind it, become a dim twinkling *starfield*, a *halo* ring, a *frame*, or a *base* band of light beneath it. Long holds can *breathe* (grow and settle back), *bob* or *sway*. Each motion runs whole cycles that start and end at rest. Breathing only ever widens the gaps, and bob and sway move the formation rigidly, so no motion can bring drones closer together. Amounts default to a safe fraction of what the formation can do.
- **New formations are safe by default.** Each one is sized so that drones sit at least √2 × the minimum spacing apart, and it is lifted above the airspace floor.
- **Flights are planned for you, collision-free.** Drones are matched to their next positions by an optimal assignment (Hungarian algorithm, minimising total squared distance). They all fly straight lines on one shared S-curve timing profile: ease in, cruise, ease out. The duration is computed from your speed, acceleration and jerk limits. You can make a flight longer, but never unsafely short. If a straight flight would bring two drones too close (dense formations), the planner takes a **detour**. The formation spreads out (every gap grows), crosses to a spread-out copy of the target, then closes in. The timeline marks these flights.
- **Transitions are part of the show.** Every flight can be *direct* (everyone straight and together, the fastest) or a spectacle:
  - **cascade:** drones set off in a ripple, left to right, centre out, top down and so on;
  - **swirl:** the flying formation turns on the way, by any angle;
  - **burst:** it explodes outward mid-flight, then reforms;
  - **ant walk:** the formation files into a column that marches up, over an arch and down the far side, then blooms into the new shape;
  - **rain:** drones drip down onto a low carpet, then rise into the new shape, top first.

  Spectacle transitions take longer than direct flights; the ant walk and rain are showpiece moments (roughly a minute on mid-sized formations). The timeline shows each style and its duration.
- **Keyframes while held.** Move, turn or resize a whole formation during its hold: a rocket rising 30 m, a logo turning to face the audience, a heart growing on the drop. Each key sets a time, a move, a rotation and a size. The formation follows a minimum-jerk curve into each key and comes to rest there, so drones never jerk; mark a key **flow through** and the formation sweeps past it without stopping, on a smooth quintic curve through all the keys (hollow diamonds on the timeline). The last key always rests. Keyframes combine with spin, breathing, bobbing and swaying, and the next flight starts wherever the last key leaves the formation. The inspector lists the keys (add one at the playhead), the timeline shows them as diamonds you can drag to retime, and both AIs can set them.
- **Auto-key (K).** Turn it on, put the playhead inside a formation's hold and just move, turn or resize the formation with the gizmo (or Alt+arrows): the change becomes a keyframe at the playhead instead of moving the whole formation. The gizmo sits at the keyed pose, so scrubbing and dragging is how you animate.
- **Even spacing, smaller formations.** Shapes, text, drawings and 3D models are sampled with farthest-point picking, Lloyd relaxation and a final pass that moves each drone to the nearby spot farthest from its neighbours, worst gaps first. A formation's size is set by its closest pair (it has to grow until that pair is safe), and this keeps the closest pair at about 0.9 of the typical spacing — so formations are about a third smaller at the same safety, and show finer detail with the same drones.
- **Colour.** Besides solid, gradient, rainbow, pulse, twinkle, chase, wave, flashes and the music-reactive and text effects, a **palette** spreads 2–6 colours across a shape (in a direction or centre → edge, still or slowly flowing: sunsets, fire, oceans, flags, brand gradients), and drawings and 3D models keep their own colours with optional life on top: **shimmer**, a **glint** of light sweeping across, a **pulse** on the beat, or **sparkle**. Both AIs follow a shared colour guide: a show palette from the brief, warm/cool contrast between scenes, nothing dark, white and the strongest accent saved for the big moments, colour temperature following the music.
- **Moving parts.** Parts of a formation can move on their own while it's held: a bird's wings flap, a pendulum swings, a windmill's blades turn. Any shape can swing, turn or slide about a pivot on its own edges; a 3D model's parts hang on joints (a wingtip on a wing), each with its own hinge, swing, beat and phase. Every motion eases in from rest and back, so flights in and out start from the designed pose. *Add → Flapping bird* adds a bird with the fullest flap your drones can fly. Pivots show in the viewport when the formation is selected.
- **Groups: splits and merges.** After a formation's hold, its drones can split into groups. You can split by shape, into left and right halves, top and bottom halves, or three columns. Each group flies its own sequence of formations at its own pace, and can set off with a delay. Drones in no group keep holding the formation. The next scene merges everyone back together.
  - The split itself is one synchronised flight out of the formation, planned (with a detour if needed) and checked exactly like any flight. After that each group keeps its own clock.
  - Group formations are ordinary scenes sized for their group's drones, so every editor works on them.
  - The timeline shows a row per group, with draggable timing. The scene list nests each group's formations under its scene. Clicking a drone during a split selects the formation its group is flying.
  - New group formations are laid out so groups keep apart, and a one-click fix moves overlapping groups apart.
- **Text can perform.** Text formations know which letter each drone belongs to and its pen order, recovered by thinning each letter to a skeleton and tracing it. So text can be:
  - *written on* stroke by stroke with a glowing pen tip (other shapes get drawn along their outline);
  - *typed* letter by letter with a blinking cursor;
  - *flipped* like a split-flap board.

  **LED signs** are grids where each drone is one dot of a dot-matrix font, scrolling text column by column like a marquee. Two fonts: 5×7, or 3×5 for small fleets (a 5×12 panel of 60 drones shows three letters at a time). Set the panel to any size, such as 8 × 10; text stays on exact rows and is centred when the panel is taller than the font. These are light effects, so they also work as cues.
- **The real site.** In **Site** (show settings), place the show on a street map by searching for a place, or by pasting coordinates or a map link. Set the compass bearing the audience faces, then draw on the map:
  - **Keep-out zones:** the audience area, obstacles with a height (buildings, trees, masts), or no-fly areas. Each has a buffer drones must also keep.
  - **The permitted flight area**, for example from your permit.

  Every drone is checked against them for the whole show, takeoff and landing included. When a held formation intrudes, the fix moves it just clear. Moving or turning the site keeps zones where they are on the ground. The 3D view shows zones as volumes, and can lay the map (dimmed for night) under the show so clients see it at the real venue.
- **Position accuracy.** Real drones are never exactly on their planned path. Set your positioning system's accuracy, for example RTK at ±0.1 m across and ±0.15 m up and down. Every clearance then allows for it: spacing grows by twice the accuracy, and floor, ceiling, fence and zones by the accuracy. Planning, sizing and checks all use the widened values.
- **Lights are first-class.** Each shape has a base look: solid, gradient, rainbow, pulse, twinkle, chase, wave, image colours, or lights off. On top of that, **light cues** sit on their own timeline track: flashes, strobes, washes, sweeps and blackouts. They can span scenes and flights, blend over the base look (replace, tint, add), and fade in and out.
- **Music is the backbone.** Drop in a song and the editor works out its structure:
  - **beats** (spectral-flux onsets, tempo by autocorrelation, a dynamic-programming beat tracker);
  - **loudness, bass and brightness** for every beat;
  - **accents**: the stand-out hits, such as crashes and drops;
  - **sections**, labelled intro, verse, build, drop, break or outro. Sections are found from bar-level changes in loudness, bass and brightness, and snapped to 4-bar phrases.

  The music lane shows the sections as coloured bands, accents as markers, and the loudness curve. Timeline edits snap to beats. From the music menu:
  - **Light the music** (bold or subtle) adds cues that follow the song's structure: breathing with the loudness in quiet parts, a sweep and beat flashes building into each drop, a flash on every accent in drops, sparkle in breaks, and a fade in the outro. Running it again replaces only its own cues.
  - **Fit show to song** lands every arrival on a bar line. It then stretches or tightens holds, bar by bar, so the finale ends with the music. Flights never get faster than safe.

  Lights can react to the music directly. *Breathe* brightness follows the loudness, a *level meter* fills with it, and flashes can fire on accents instead of every beat.
- **No song? Compose one.** *Compose a score for this show* (music menu) writes an original soundtrack to your show. Arrivals move onto a bar grid, and the music builds and drops exactly as the hero formations arrive. It's synthesised in the browser (pads, arpeggio, bass, drums, risers, crashes, lead), so the editor knows the score exactly: beats, sections and hits. The project saves only the recipe, and the music is regenerated when you open it. Use it as a temp track for client previews, or as the show's music. Undo brings your previous song back.
- **Client preview.** *Present* plays the show fullscreen from the audience position, with music.

## AI features

Optional, powered by Claude Opus 5.5. Open **AI** in the top bar or press **Ctrl K**.

- **Generate a show from a brief.** Describe the occasion, story, colours and words. Claude writes a complete plan and the engine builds it safely. You preview the result before it replaces your show, and applying it is one undo step. The plan can use every feature of the editor:
  - scenes with built-in shapes, text, LED signs or several shapes at once;
  - up to **10 custom formations**: 2D drawings and 3D models, including inside groups and as extra shapes. Each one is checked by looking at it as drones and fixed before it is used;
  - spectacle transitions, idle motion and spare-drone roles;
  - splits into groups;
  - light cues and a flight home.

  With music, the song is the backbone: Claude reads its sections and accents and puts the hero formation exactly on the biggest drop. The engine lands every other formation on a bar, fits the finale to the end of the song, lights the music, and applies automatic safety fixes. With no song, Claude picks the hero formations and a tempo, and an original score is composed with its drops on them. The site's keep-out zones and flight area are part of the brief.
- **Copilot.** Edit by conversation: "make the heart pink and slow the globe", "add flashes on the drop", "split the heart and send the halves different ways", "the stage is 120 m out and 12 m tall", "how does it hold up in a 7 m/s wind?". It works through 32 tools that reach everything the editor can do:
  - formations, including several shapes, LED signs, custom drawings and traced pictures (style, detail, sensitivity, a new picture), 3D models (relief, their moving parts) and any shape swinging, turning or sliding on its own;
  - lights (palettes, shape colours with shimmer, glint, pulse or sparkle) and cues, groups, and music;
  - show-wide settings (fleet limits, airspace, takeoff, landing, the flight home);
  - the real site (accuracy, location, heading, zones, flight area);
  - the wind test, and showing you the result in the preview.

  Each tool reports the safety status back, so the model sees the consequences of its own edits. It can *look* at rendered formations to judge readability and colour. Everything it does for one request is a single undo step.
- **Picture to drones.** The highest-fidelity way to make a figure (bouquets, couples, tiaras, phoenixes):
  1. *Write* — Claude expands a few words ("bride and groom") into a full picture description: pose, the defining features as lines, a colour palette, the picture's shape (wide, tall or square) and the level of detail the drone count can show (a line budget, with neighbouring lines never closer than a twentieth of the picture).
  2. *Draw* — an OpenAI image model draws it as glowing neon line art on black. The default, **gpt-image-2.5-flare**, was the best value in our tests on drone subjects (a phoenix, a dancing couple, a tiara, a bouquet, a rose): about $0.014 and 16 s per medium square picture, a quarter of gpt-image-2's price and three times faster, and its bold, simple lines traced into drones as well or better (it adds a glow, which the tracer ignores). gpt-image-2 draws the cleanest and most detailed line art; 2.5 Sunburst is close to Flare; the 2.6 models are faster still but busier. Pick the model and quality in AI settings, which shows each one's price.
  3. *Trace* — the picture's bright lines are found (blurred brightness, hysteresis threshold so faint stretches don't break a line), thinned to centre lines and traced into strokes, joined straight through junctions; wide areas become fills; every drone takes the most vivid colour of the picture where it sits.
  4. *Drones* — the strokes become evenly spaced single-file lines of drones at any count. With fewer drones, strokes that would blur into a stronger neighbour at that spacing are left out (closed shapes like heads and gems, and differently coloured lines, are kept longest).
  5. *Look & fix* — Claude compares the picture with the drones and approves, adjusts detail or line sensitivity, or describes a new picture.

  **Lines, filled or adaptive.** *Lines* (the default) makes every line of the picture a line of drones; *filled* spreads the drones over the whole figure (what the lines enclose) in the colours of the lines around them; *adaptive* uses lines while the figure they make fits a typical show sky (about 100 m tall and 200 m wide at 3 m between drones), and a clean filled silhouette when there are more drones than the lines can hold, so the figure stays compact. Switch in the studio or the inspector, for traced pictures and Claude's drawings alike.

  Every stage can be re-run on its own: the drone count, detail and sensitivity re-trace instantly from the kept picture (no new image), and you can edit the description and draw again. The studio shows how big the formation is at safe spacing and whether it fits the airspace (a line drawing needs about 3 m of line per drone — more drones need more lines, not a bigger figure), with the count that fits. "Add as new scene" uses your drone count: fewer than the show has and the rest wait dark behind it; more and the show grows. The picture is kept with the formation, so **Studio** in the inspector reopens it later. Your own pictures (bright lines on dark) can be traced too. With an OpenAI key set, the show generator and the copilot use this pipeline for custom pictures. The key is stored only in the browser, in AI settings.
- **Describe a formation — line art.** Words become an SVG drawing, which becomes drones the way drone-show artists draw: every **stroke** becomes one crisp, evenly spaced line of drones along its path (outlines, contours, feathers, rays), and **filled** areas fill evenly around them. Each drone takes the drawing's colour where it sits, gradients included. Claude gets a drone budget (how far apart the drones will be), then compares its drawing with the actual drones side by side and redraws what got lost (merged lines, vanished details, muddy colours) — up to two rounds. "Refine" adds your own feedback. Imported SVG logos keep their strokes as lines too, and *write* draws a drawing stroke by stroke.
- **Create a 3D model — with look and fix.** Describe an object ("a hot-air balloon with a basket", "an eagle flapping its wings"). Claude builds it from up to 80 parts — solids (spheres, ellipsoids, boxes, cylinders, cones, capsules, tori), flat **plates** (wings, fins, leaves, logos), **tubes** along a path (necks, tails, tentacles) and **turned** shapes (vases, bells, bodies) — each with its own colour, and the engine spreads the drones evenly over the outer surface. Parts thinner than the drone spacing become one sheet or one line of drones (a wing doesn't waste drones on its back face), a tiny sphere becomes a single drone (an eye), and *relief* puts drones only on the side the audience sees, twice as dense. If the description implies motion, the model gets **moving parts** (wings on shoulder joints, a tail, turning wheels), calmed to what the drones can fly. Then Claude *looks*: at its parts as solid surfaces, at the actual drones from the front, side, top and a three-quarter angle, and (for moving parts) at the drones at both ends of the motion; it says what doesn't read (a feature that vanished, wrong proportions, a wing hinged in the wrong place) and fixes the model. It repeats until it's satisfied or the round limit (1–3) is reached. You can add your own feedback for more rounds, and reopen any 3D model from the inspector with **Improve**. The copilot and the show generator can create 3D models too, and the copilot can look at any scene from all four angles.
- **Write a client pitch.** A proposal written from the real show: its formations (as images), timeline, music and exact safety figures. Unknowns like dates and prices become `[placeholders]`.

**Big outputs as tool calls.** Plans, drawings and 3D models come back as a call to a regular tool, which Claude uses to hand over its result. Grammar-constrained structured output caps a request at 24 optional fields, and a show plan has well over a hundred. The input is validated against the same schema, and any problems go back to Claude to correct.

**The model proposes; the engine decides.** Model output never bypasses the safety engine. Every number is clamped, every colour validated, and every formation goes through the same sizing, airspace and validation path as a manual edit. Tool inputs are schema-checked before they run, and a response cut off mid-tool-call is never executed.

**Keys and privacy.** The editor is a static web app, so requests go straight from the browser to the Claude API with your own key. The key is stored only in that browser's localStorage. Anyone with access to the browser profile could read it, so for shared machines or a public deployment, set a **proxy URL** in AI settings instead. Your proxy should forward to `https://api.anthropic.com` and set the real key; the SDK sends the credential as `Authorization: Bearer …`, which the proxy should replace. If a safety classifier declines a request, it's retried automatically on Anthropic's recommended fallback model (server-side refusal fallback).

**What it costs.** Once the AI has spent anything, the top bar shows today's spending (estimated; it pulses while a request is running); click it for this session, today and all time, today's spending by feature, and the latest calls. Every AI window also has a cost meter: what this window has spent so far (updated as each call finishes; it pulses while one is running), split into Claude and pictures, with today's and the all-time total. Click it for every call: what it was for, the model that answered, tokens in and out, and its price. The picture studio shows the typical price on each button before you press it (from your recent calls, or list prices until there are some); the copilot shows the session's cost next to its token count. Prices come from the token counts each response returns, at the published list prices of the model that actually answered (a refusal fallback is priced as the fallback model): Claude by input, output and cache tokens, pictures by text, image and output tokens (a medium-quality square picture is about $0.014 with gpt-image-2.5-flare, $0.05 with gpt-image-2). **AI settings → Costs** shows the totals by feature, lets you change any price if yours differ (or reset to list prices), and clears the history. The record stays in this browser; it is an estimate, and your Anthropic and OpenAI consoles are the bill.

## Safety checks

Checks run in a background worker after every edit. Each issue links to the moment it happens and, where possible, offers a one-click fix.

| Check | How |
|---|---|
| Minimum distance in formations | Every pair, every formation. Spin, bob and sway are rigid motions, and breathing only scales up, so held spacing is never below the base spacing. |
| Minimum distance during flights | Every pair, on every leg, closed form. With shared timing, the distance between two drones is \|A + s·B\|, so its minimum over the leg is solved analytically, not sampled. Swirl and burst only rotate and enlarge the flying formation, so this bound covers them too. Cascade, rain and ant walk are checked on a fine time grid. Between grid points each path stays within a·Δt²/8 of its chord, so the closest approach of the chords minus that margin is a proven lower bound. |
| Speed (horizontal, climb, descent), acceleration and jerk | Exact peaks of each leg's S-curve. Spin and idle motions are measured on the closed-form trajectory of their fastest-moving drones. Unsafe motion gets a "calm" fix. |
| Altitude floor and ceiling, flight radius | Straight legs peak at their endpoints, so formations, pads and detour waypoints are checked there. Spinning, swaying, breathing and bobbing formations are bounded over their whole range of motion. |
| Between groups during a split | Groups don't share a clock, so the closed form doesn't apply. Separation is proven with a speed bound instead. No drone moves faster than v, so between samples Δt apart a pair at distances d₀ and d₁ stays at least (d₀ + d₁)/2 − v·Δt apart. Where that isn't enough, the interval is bisected until the bound clears it or a sample shows a real close pass. Pairs are found with a spatial hash, and the results are tested against 5 ms brute-force sampling. Each group's own flights and formations get the exact checks above. |
| Keep-out zones and the flight area | The same proven speed-bound method, for every drone against each zone (distance to the zone's prism minus its buffer and the position accuracy) over the whole show. |
| Position accuracy | All of the above use clearances widened by the accuracy, so the plan is safe wherever within its accuracy each drone really is. |
| Moving parts | Within a moving piece distances never change. Between pieces (and the still drones), every drone's speed from the parts' motion is bounded (joint rate × distance from the pivot, summed along its chain of joints), so a pair's distance changes by at most the sum of their bounds; the hold is sampled, and any interval the bound can't clear is bisected until it's proven clear or a real close pass is found. Speed, acceleration and jerk are measured on the trajectories of each rigid piece's extreme points (the motion is affine in a point's position). Fixes slow the beat (acceleration drops with its square) or calm the swing. |
| Keyframes | Moves and turns keep every distance; size scales every distance by exactly that factor, so the smallest spacing is the base spacing times the smallest size, checked exactly at the keys when every key rests, and densely sampled (with a margin for the curve's slope) when a key flows through and the size can dip between keys. Speed, acceleration and jerk are measured on the actual trajectories of every drone (or the formation's outermost points for very large fleets). The pose is an affine map of each drone's place in the formation, so the peaks are there. Altitude and reach are sampled and widened by the top speed × half the sample step, which bounds the motion between samples. Fixes calm the keyframes when they carry a formation out of the airspace, too fast, or too small. |
| Battery | Total flight time, takeoff to landing. |

How transitions stay safe:
- **Swirl and burst** inherit the plain flight's exact proof, since rotating or enlarging the formation can't bring drones closer.
- **Ant walk** is safe by construction. The column marches in lockstep, each lane in its own plane in front of or behind the formations, with drones at least a spacing apart along each lane. Getting into and out of the column are synchronised flights.
- **Cascade and rain** keep the plain flight's exact timing and only delay each drone's start. If the ripple would bring drones too close, it is softened to the strongest safe stagger. Rain's last resort falls and rises together.
- **Fallback:** if a style can't be made safe, the flight flies direct, and the inspector says why. Speeds, accelerations, jerk and the airspace are checked on the styled paths too.

Why formations spaced ≥ √2 × min spacing always fly clear: with optimal assignment and synchronised straight-line motion, start and end separations above 2√2·r keep robots of radius r from colliding (Turpin, Michael & Kumar, “Concurrent assignment and planning of trajectories for multiple robots”, IJRR 2014). The validator doesn't rely on this; it checks every pair anyway.

The preview, the validator and the exporter all call the same `evaluate()` function, so what you see is exactly what gets exported.

### Wind test

The checks prove the *plan* is safe. The **wind test** shows how much margin it leaves in real air. It flies every drone through a physical simulation:

- thrust limited in magnitude and tilt (35°), with a response lag;
- quadratic drag against the relative wind;
- wind that grows with altitude (power law), gusts that travel with the wind, and turbulence on each drone;
- a PID position controller with feed-forward of the planned acceleration, which doesn't know the wind.

It reports the real closest approach next to the planned one, the largest and typical drift, and the time drones spend at their control limits. It lists the closest calls (click one to jump there). **Watch in viewport** replays the simulated, blown-about flight. The simulation runs in its own worker. Its results are an engineering estimate, not a certification.

## Export

- **Project** (`.droneshow.json`): the full show, with the music embedded (a composed score is saved as its recipe).
- **Trajectories** (ZIP): one CSV per drone with columns `time_s, east_m, north_m, up_m, red, green, blue`, sampled at 5–20 Hz. Coordinates are ENU metres from the centre of the takeoff grid. With a site location they are true east and north (the show turned to the audience's heading), with added `lat_deg, lon_deg` columns (WGS84). A `site.json` lists the origin, the zones and the flight area. Without a location, the audience is assumed to stand to the south.

Formats for specific flight controllers and show systems are planned.

## Keyboard

| | |
|---|---|
| Space | Play / pause |
| ← → (Shift) | Seek 1 s (5 s) |
| ↑ ↓ | Previous / next scene |
| A / C | Add formation / light cue at playhead |
| Ctrl D, Delete | Duplicate, delete |
| Ctrl Z, Ctrl Shift Z | Undo, redo |
| 1 2 3 | Audience / orbit / top view |
| Q W E R | Select / move / rotate / scale the selected formation in the view (Alt: no snapping) |
| Alt ← → ↑ ↓ (Shift) | Nudge the formation across / up and down, 1 m (5 m) |
| Alt PgUp / PgDn | Nudge it away from / toward the audience |
| F | Frame the selected formation |
| P | Present |
| Ctrl S | Save project |
| Ctrl K | Ask the AI copilot |

Drag any number field's label to scrub it (Shift ×10, Alt ×0.1). Hold Alt while dragging on the timeline to bypass beat snapping.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # unit tests (engine, validator, beats, export, demos, AI converters and agent loop)
pnpm test:e2e     # browser tests, incl. AI features against a mocked Claude API (no key needed)
                  # (Playwright; run `pnpm exec playwright install chromium` once)
pnpm typecheck && pnpm lint && pnpm build
```

```
src/
  core/      Pure, deterministic engine: model, shapes, assignment, motion profiles,
             compile → flight plan (with collision-free detours and spectacle transitions),
             evaluate(t), exact validator, idle drones, text pen order, wind simulation,
             music (beats, sections, accents, music tools, score synthesiser), groups and splits,
             the real site (geo, zones, position accuracy, proven speed-bound checks), export, file format
  engine/    Web Workers: compile + validate, beat analysis and score rendering off the main
             thread; wind simulation
  state/     Zustand store (document + undo history), playback clock, actions, autosave & files
  ui/        React: scene list, 3D viewport (react-three-fiber), timeline, inspector, present mode
  ai/        Claude features: client, copilot agent loop + tools, director, formation drawing,
             3D models with look-and-fix, pitch writer; schemas and converters that route model
             output through the engine
  app/       Built-in demo shows (CI requires every demo to pass every check)
```

## Roadmap

- Hardware export formats
- Video export and shareable preview links
- An audience-view overlap check (drones that are safely apart but merge into one dot from the ground)
- Gizmo editing of individual shapes within a scene, and a "find the wind limit" sweep
- Elevation data for sloped sites (altitudes are above the takeoff ground)

## License

[MIT](LICENSE)
