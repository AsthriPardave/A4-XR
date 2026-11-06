# A4 · Mobile AR Docking

WebXR docking task on a real horizontal surface. Three simple objects (arrow, wedge, L), a translucent ghost of one of them, and two techniques: touch gestures and carry.

## Run

WebXR needs a secure context.

- Desktop preview (no phone): open `index.html` with any static server. `http://localhost` counts as secure for the preview button. Example: `npx serve` in this folder.
- Phone: HTTPS. GitHub Pages works. For a USB debug session, reverse-proxy the port (`adb reverse tcp:3000 tcp:3000`) and open the `localhost` URL in Chrome on the phone, or publish the folder.
- Remote console: `chrome://inspect` with the phone plugged in.

The page checks `immersive-ar`. **Entrar en AR** starts a hit-test session (`hit-test`, and `dom-overlay` when the phone allows it). **Vista previa en escritorio** uses a virtual floor so the flow can be checked without ARCore. Add `?debug=1` to see live position and yaw error.

## Task

1. Aim the centre of the phone until the ring sits on a table or the floor. Tap to place the ghost. Its yaw is random.
2. Three objects appear 30–50 cm away. Tap the one that matches the ghost. A wrong tap is counted and does not start the timer.
3. Dock it within 2 cm and 10° of yaw. Hold still for a moment. The rim flashes green and the trial is logged.
4. Three trials, then “How tired are your arms?” (1–5). The score is written onto those three rows.

**Gestos.** One finger drags on the surface plane. Two fingers twist around the vertical axis. On a desktop mouse, Shift+drag twists.

**Carry.** Hold the button. The object stays on the surface, about 32 cm in front of the phone, and yaws with the phone. Release to drop it. See `DESIGN.md`.

## CSV

`a4-docking.csv` columns:

`participant_id, technique, trial, completion_time_s, pos_error_cm, yaw_error_deg, wrong_selections, touch_count, tracking_lost, arm_fatigue`

`technique` is `touch` or `carry`. `touch_count` counts pointer-downs from the moment the objects appear until the dock (selection taps, drags, and the carry button). `tracking_lost` counts transitions where WebXR lost the viewer pose or returned no hit-test, during selection and docking. `arm_fatigue` is the 1–5 answer for that block. Time starts when the correct object is selected.

Surface and lighting notes stay in the page (local storage) and are repeated on the summary. They are not a CSV column.

Counterbalance by hand: odd participant starts on touch, even participant starts on carry, then the other technique.
