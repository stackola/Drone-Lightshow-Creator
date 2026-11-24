# Drone Show Designer

Design drone light shows in the browser: arrange formations on a timeline, sync them to music, layer light cues on top, and preview the result from the audience's seat. Every edit is checked for safety, and the checks are exact.

Built for small agencies and operators who need to go from an idea to a convincing client preview quickly, without giving up a show that can actually fly.

![Editor: scene list, audience view, inspector, and a timeline with scenes, light cues and music](docs/screenshot.png)

## How it works

A show is a sequence: **takeoff → scene → scene → … → return & land**. Each scene is a formation that the drones hold for a while. Between scenes, the drones fly.

- **Formations come from shapes, text, or images.** There are 2D shapes (circle, heart, star, polygon, grid, spiral, wave), 3D shapes (sphere, torus, cube, double helix, cone), text in sans, serif or dot-matrix fonts, and image/logo import where each drone takes its pixel's colour. A scene can combine several shapes and share the drones between them, including parking spare drones dark behind the formation.
- **New formations are safe by default.** Each one is sized so that drones sit at least √2 × the minimum spacing apart, and it is lifted above the airspace floor.
- **Flights are planned for you.** Drones are matched to their next positions by an optimal assignment (Hungarian algorithm, minimising total squared distance). They all fly straight lines on one shared S-curve timing profile: ease in, cruise, ease out. The duration is computed from your speed and acceleration limits. You can make a flight longer, but never unsafely short.
- **Lights are first-class.** Each shape has a base look: solid, gradient, rainbow, pulse, twinkle, chase, wave, image colours, or lights off. On top of that, **light cues** sit on their own timeline track: flashes, strobes, washes, sweeps and blackouts. They can span scenes and flights, blend over the base look (replace, tint, add), and fade in and out.
- **Music sync.** Drop in a song and beats are detected (spectral-flux onsets, tempo by autocorrelation, and a dynamic-programming beat tracker). Timeline edits snap to beats, and pulse and flash effects can fire on the beat or bar.
- **Client preview.** *Present* plays the show fullscreen from the audience position, with music.

## AI features

Optional, powered by Claude Opus 5.5. Open **AI** in the top bar or press **Ctrl K**.

- **Generate a show from a brief.** Describe the occasion, story, colours and words. Claude writes a structured plan (scenes, lights and cues). The engine builds it, lands every formation on a downbeat of your music, and applies automatic safety fixes. You preview the result before it replaces your show, and it's one undo step.
- **Copilot.** Edit by conversation: "make the heart pink and slow the globe", "add flashes on the drop", "review my show". It works through 16 tools that edit the show the same way the UI does. Each tool reports the safety status back, so the model sees the consequences of its own edits. It can *look* at rendered formations (vision) to judge readability and colour. Everything it does for one request is a single undo step.
- **Describe a formation.** Words become a bold SVG drawing, which becomes drones in the drawing's colours. "Refine" shows Claude how its drawing actually came out as drones, so it can fix what doesn't read.
- **Write a client pitch.** A proposal written from the real show: its formations (as images), timeline, music and exact safety figures. Unknowns like dates and prices become `[placeholders]`.

**The model proposes; the engine decides.** Model output never bypasses the safety engine. Every number is clamped, every colour validated, and every formation goes through the same sizing, airspace and validation path as a manual edit. Tool inputs are schema-checked before they run, and a response cut off mid-tool-call is never executed.

**Keys and privacy.** The editor is a static web app, so requests go straight from the browser to the Claude API with your own key. The key is stored only in that browser's localStorage. Anyone with access to the browser profile could read it, so for shared machines or a public deployment, set a **proxy URL** in AI settings instead. Your proxy should forward to `https://api.anthropic.com` and set the real key; the SDK sends the credential as `Authorization: Bearer …`, which the proxy should replace. If a safety classifier declines a request, it's retried automatically on Anthropic's recommended fallback model (server-side refusal fallback). Token use for the session is shown under the copilot.

## Safety checks

Checks run in a background worker after every edit. Each issue links to the moment it happens and, where possible, offers a one-click fix.

| Check | How |
|---|---|
| Minimum distance in formations | Every pair, every formation. Holds are rigid (static or spinning), so the distance is constant while held. |
| Minimum distance during flights | Every pair, closed form. With shared timing, the distance between two drones is \|A + s·B\|, so its minimum over the flight is solved analytically, not sampled. |
| Speed (horizontal, climb, descent) and acceleration | Exact peaks of the S-curve profile, and of spin ramps. |
| Altitude floor and ceiling, flight radius | Straight segments peak at their endpoints. Spinning formations are checked in closed form over the swept angle. |
| Battery | Total flight time, takeoff to landing. |

Why formations spaced ≥ √2 × min spacing always fly clear: with optimal assignment and synchronised straight-line motion, start and end separations above 2√2·r keep robots of radius r from colliding (Turpin, Michael & Kumar, “Concurrent assignment and planning of trajectories for multiple robots”, IJRR 2014). The validator doesn't rely on this; it checks every pair anyway.

The preview, the validator and the exporter all call the same `evaluate()` function, so what you see is exactly what gets exported.

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
             compile → flight plan, evaluate(t), exact validator, beats, export, file format
  engine/    Web Worker that compiles and validates off the main thread
  state/     Zustand store (document + undo history), playback clock, actions, autosave & files
  ui/        React: scene list, 3D viewport (react-three-fiber), timeline, inspector, present mode
  ai/        Claude features: client, copilot agent loop + tools, director, formation drawing,
             pitch writer; schemas and converters that route model output through the engine
  app/       Built-in demo shows (CI requires every demo to pass every check)
```

## Roadmap

- Hardware export formats
- Video export and shareable preview links
- An audience-view overlap check (drones that are safely apart but merge into one dot from the ground)
- Tracks for subgroups on independent timing (splits and merges)

## License

[MIT](LICENSE)
