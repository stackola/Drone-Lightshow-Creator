// Shared craft notes for the show generator and the copilot: how pictures
// become drones, and how to light them.

export const PICTURE_GUIDE = `Pictures and objects
- custom (flat pictures) are drawn as line art: every stroke becomes a crisp single-file line of drones, filled areas fill evenly. Describe the subject, its pose and its few defining features, what should be outline and what solid, and its colours — e.g. "a phoenix rising, wings spread, line-art feathers in a flame-orange to gold gradient, solid white eye". One clear subject per drawing.
- model3d (3D objects) are built from parts (solids, flat plates for wings and fins, tubes for necks and tails, turned shapes for vases and bodies), checked as drones from four angles and fixed. Describe subject, pose, defining features and colours; say if it should face the audience (it then gets drones only on the visible side) or spin; and say if parts move ("an eagle facing the audience, wings spread and flapping slowly, brown body, gold wingtips, white head" or "a windmill with turning blades"). Moving parts are slowed or calmed automatically to what the drones can fly.
- Drawings have a style: lines (the default — every line a line of drones, crisp, usually best), filled (drones over the whole figure — bold silhouettes and logos), adaptive (lines while they fit the sky, a filled silhouette when there are more drones than the lines can hold — use it for formations with many drones). Choose with drawing_style; edit_picture switches it later.
- Any shape can move on its own inside its formation with shape.moves: a sign swinging from its top, a star turning in place, a pendulum, two shapes swinging in opposite phase.`

export const COLOUR_GUIDE = `Colour and light
- Drones are lights in the dark; colour carries the emotion. Pick a show palette of 3–5 colours from the brief (the client's brand colours when given, otherwise the mood) and use it consistently, varying warm and cool from scene to scene for contrast. Save pure white and the most saturated accent for the big moments.
- Dark colours vanish (anything near black or deep grey); keep base colours bright and saturated. Use brightness below 1 only on supporting layers (starfields, bases, halos) so the hero reads brightest.
- Multi-colour light makes formations rich: palette spreads 2–6 colours across a shape (sunset, fire, ocean, aurora, a flag, a brand gradient — in a direction or centre → edge, still or slowly flowing); gradient blends two. Rainbow sparingly — it cheapens when overused.
- Custom drawings and 3D models carry their own colours (effect image); bring them alive with animate: shimmer (gentle life on long holds), glint (a sweep of light across metal, glass, trophies, cars), pulse (with the beat), sparkle (magic, snow, celebration).
- Light can move too: chase runs along outlines and text strokes, write draws text and line-art drawings stroke by stroke, wave sweeps a band on builds, twinkle suits starfields; keep flashes and strobes for accents and drops.
- Neighbouring shapes in one formation get contrasting colours; text over a picture reads best in white or the accent colour.
- With music: intros and breaks cool and calm (blues, violets, lower brightness), builds warm up, drops go saturated and warm with white flashes on the hits, the outro softens.`
