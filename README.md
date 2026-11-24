# Drone Show Designer

Design drone light shows in the browser: arrange formations on a timeline, sync them to music, layer light cues on top, and preview the result from the audience's seat. Every edit is checked for safety, and the checks are exact.

Built for small agencies and operators who need to go from an idea to a convincing client preview quickly, without giving up a show that can actually fly.

![Editor: scene list, audience view, inspector, and a timeline with scenes, light cues and music](docs/screenshot.png)

## How it works

A show is a sequence: **takeoff → scene → scene → … → return & land**. Each scene is a formation that the drones hold for a while. Between scenes, the drones fly.

- **Formations come from shapes, text, or images.** There are 2D shapes (circle, heart, star, polygon, grid, spiral, wave), 3D shapes (sphere, torus, cube, double helix, cone), text in sans, serif or dot-matrix fonts, and image/logo import where each drone takes its pixel's colour. A scene can combine several shapes and share the drones between them.
- **Edit in the 3D view.** Select a formation (or click its drones) and move, rotate or scale it with the gizmo (**W E R**). It snaps to 1 m, 5° and 5% steps; hold Alt to move freely. While you drag, a ghost of the formation follows instantly. The floor, ceiling and fence light up, and the ghost turns red if it leaves the airspace. Scaling stops at the smallest safe size. **Alt + arrows** nudge the formation, and **F** frames it.
- **Idle drones have a job.** When a formation doesn't need every drone, the spares can be *parked* dark behind it, become a dim twinkling *starfield*, a *halo* ring, a *frame*, or a *base* band of light beneath it. Long holds can *breathe* (grow and settle back), *bob* or *sway*. Each motion runs whole cycles that start and end at rest. Breathing only ever widens the gaps, and bob and sway move the formation rigidly, so no motion can bring drones closer together. Amounts default to a safe fraction of what the formation can do.
- **New formations are safe by default.** Each one is sized so that drones sit at least √2 × the minimum spacing apart, and it is lifted above the airspace floor.
- **Flights are planned for you, collision-free.** Drones are matched to their next positions by an optimal assignment (Hungarian algorithm, minimising total squared distance). They all fly straight lines on one shared S-curve timing profile: ease in, cruise, ease out. The duration is computed from your speed, acceleration and jerk limits. You can make a flight longer, but never unsafely short. If a straight flight would bring two drones too close (dense formations), the planner takes a **detour**. The formation spreads out (every gap grows), crosses to a spread-out copy of the target, then closes in. The timeline marks these flights.
- **Lights are first-class.** Each shape has a base look: solid, gradient, rainbow, pulse, twinkle, chase, wave, image colours, or lights off. On top of that, **light cues** sit on their own timeline track: flashes, strobes, washes, sweeps and blackouts. They can span scenes and flights, blend over the base look (replace, tint, add), and fade in and out.
- **Music sync.** Drop in a song and beats are detected (spectral-flux onsets, tempo by autocorrelation, and a dynamic-programming beat tracker). Timeline edits snap to beats, and pulse and flash effects can fire on the beat or bar.
- **Client preview.** *Present* plays the show fullscreen from the audience position, with music.

## AI features

Optional, powered by Claude Opus 5.5. Open **AI** in the top bar or press **Ctrl K**.

- **Generate a show from a brief.** Describe the occasion, story, colours and words. Claude writes a structured plan (scenes, lights and cues). The engine builds it, lands every formation on a downbeat of your music, and applies automatic safety fixes. You preview the result before it replaces your show, and it's one undo step.
- **Copilot.** Edit by conversation: "make the heart pink and slow the globe", "add flashes on the drop", "review my show". It works through 17 tools that edit the show the same way the UI does. Each tool reports the safety status back, so the model sees the consequences of its own edits. It can *look* at rendered formations (vision) to judge readability and colour. Everything it does for one request is a single undo step.
- **Describe a formation.** Words become a bold SVG drawing, which becomes drones in the drawing's colours. "Refine" shows Claude how its drawing actually came out as drones, so it can fix what doesn't read.
- **Create a 3D model — with look and fix.** Describe an object ("a hot-air balloon with a basket"). Claude builds it from solid parts (spheres, ellipsoids, boxes, cylinders, cones, capsules, tori, each with its own colour), and the engine spreads the drones evenly over the outer surface. Then Claude *looks* at the actual drones from the front, side, top and a three-quarter angle, says what doesn't read (a part that's too thin, a missing feature, wrong proportions), and fixes the model. It repeats until it's satisfied or the round limit (1–3) is reached. You can add your own feedback for more rounds, and reopen any 3D model from the inspector with **Improve**. The copilot and the show generator can create 3D models too, and the copilot can look at any scene from all four angles.
- **Write a client pitch.** A proposal written from the real show: its formations (as images), timeline, music and exact safety figures. Unknowns like dates and prices become `[placeholders]`.

**The model proposes; the engine decides.** Model output never bypasses the safety engine. Every number is clamped, every colour validated, and every formation goes through the same sizing, airspace and validation path as a manual edit. Tool inputs are schema-checked before they run, and a response cut off mid-tool-call is never executed.

**Keys and privacy.** The editor is a static web app, so requests go straight from the browser to the Claude API with your own key. The key is stored only in that browser's localStorage. Anyone with access to the browser profile could read it, so for shared machines or a public deployment, set a **proxy URL** in AI settings instead. Your proxy should forward to `https://api.anthropic.com` and set the real key; the SDK sends the credential as `Authorization: Bearer …`, which the proxy should replace. If a safety classifier declines a request, it's retried automatically on Anthropic's recommended fallback model (server-side refusal fallback). Token use for the session is shown under the copilot.

## Safety checks

Checks run in a background worker after every edit. Each issue links to the moment it happens and, where possible, offers a one-click fix.

| Check | How |
|---|---|
| Minimum distance in formations | Every pair, every formation. Spin, bob and sway are rigid motions, and breathing only scales up, so held spacing is never below the base spacing. |
| Minimum distance during flights | Every pair, on every leg, closed form. With shared timing, the distance between two drones is \|A + s·B\|, so its minimum over the leg is solved analytically, not sampled. |
| Speed (horizontal, climb, descent), acceleration and jerk | Exact peaks of each leg's S-curve. Spin and idle motions are measured on the closed-form trajectory of their fastest-moving drones. Unsafe motion gets a "calm" fix. |
| Altitude floor and ceiling, flight radius | Straight legs peak at their endpoints, so formations, pads and detour waypoints are checked there. Spinning, swaying, breathing and bobbing formations are bounded over their whole range of motion. |
| Battery | Total flight time, takeoff to landing. |

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

- **Project** (`.droneshow.json`): the full show, with the music embedded.
- **Trajectories** (ZIP): one CSV per drone with columns `time_s, east_m, north_m, up_m, red, green, blue`, sampled at 5–20 Hz. Coordinates are ENU metres from the centre of the takeoff grid; the audience stands to the south.

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
             compile → flight plan (with collision-free detours), evaluate(t), exact validator,
             idle drones, wind simulation, beats, export, file format
  engine/    Web Workers: compile + validate off the main thread; wind simulation
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
- Tracks for subgroups on independent timing (splits and merges)

## License

[MIT](LICENSE)
