# Technique 2 design draft — Carry

Written before implementation. Baseline (technique 1) is fixed by the assignment: one-finger drag translates on the surface, two-finger twist yaws.

## What Carry does

The phone is the handle. After the matching object is selected, the user presses and holds an on-screen **Carry** button. While the button is held:

- The object stays on the real horizontal surface (no lift, no roll, no pitch).
- Its position is a point a short distance **in front of the phone**, dropped onto that surface along the surface normal. Walking or sliding the phone translates the object.
- Its yaw matches the phone’s heading around the same vertical axis. Turning the phone rotates the object.

Releasing the button leaves the object where it is. A new hold picks it up again. Selection is the same in both techniques: a tap casts a ray from the camera through the touch point.

This is not the screen-centre reticle. The object is attached to the phone, not to the aim point. Turning in place swings the object, because it lives in front of the body. That coupling is part of the technique.

## Course concepts

- **Direct, isomorphic manipulation** (the A2 grab, moved to a phone): the display frame and the control frame are the phone’s own pose. One physical motion updates translation and yaw together.
- **3 DoF on a constraint surface.** Hit-testing defines the plane; Carry never leaves it. Input that would have been 6 DoF is projected onto x, z, and yaw.
- **Control–display coupling.** Touch splits the degrees of freedom (one finger moves, two fingers turn). Carry binds them to a single pose, so a correction in yaw also moves the contact point.
- **Body vs. finger effort.** Touch works with the thumb on the glass. Carry moves the arms. The fatigue question is there to catch that cost.
- **Monoscopic placement.** A point locked in front of the phone gives a depth the flat camera image does not. The user can use proprioception (“it sits in front of me”) instead of judging depth in the video.

## Prediction

Carry will be **faster** to a coarse alignment and **worse** at the final tolerance, and it will **tire the arms more**.

Touch should take longer and log more touch events, but land with smaller position and yaw error and a lower fatigue score. The last centimetres are easier when yaw does not drag the object sideways.

The study can support the trade-off even if only one side of it shows up (time or accuracy or fatigue).
