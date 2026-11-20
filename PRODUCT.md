# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Players:** groups of up to four people standing around a hologram pyramid on a tablet, one per pyramid face. Walk-up exhibit visitors (families, children, tourists) with nobody there to explain it, and school classes led by a teacher or guide.
- **Guide:** a teacher or guide who starts a story for a group and may pause, skip or restart it.
- **Author:** the person who builds the stories and sets up the hardware. Not necessarily a programmer.

## Product Purpose

Holo Stage tells an interactive story inside a four-sided Pepper's ghost pyramid. 3D animation chapters alternate with interactive phases in which the group acts together through four physical buttons attached to the tablet. Success: a group that has never seen it understands what to do without help, finishes the story together, and has learned something from it.

## Positioning

The story waits for the group. Progress comes from cooperation on physical buttons, not from one person tapping a screen, and every player sees the same hologram from their own side.

## Operating Context

- A tablet lies flat with the pyramid on top; the room is dim. The screen is seen only as a reflection in the glass, so everything shown to players is mirrored per face by the app.
- Four physical buttons (USB arcade encoder, microcontroller as keyboard/gamepad, or Bluetooth keys), one per face.
- Runs unattended as an exhibit: it must attract, start itself on a button press, survive people leaving mid-story and reset when idle.
- Runs offline as an installed PWA. Videos and stories are stored in the browser.

## Capabilities and Constraints

- A **story** is an ordered list of **scenes**. Scene types: animation chapter, *all together* (everyone presses or holds at once), *quiz / vote* (each player answers with their button), *take turns* (each player contributes in order).
- Stories are authored in an in-app editor, without code, and can be exported and imported as files.
- Players have exactly one button each. No interaction may require touching the screen during a story.
- Text inside the hologram must be short and large; glass reflections are low-contrast and small.
- Plain HTML/CSS/JS, no build step, no framework.
- Button learning and pyramid layout calibration from the first version stay. The original per-player clip triggering remains as a "free play" run mode when no story is used.

## Evidence on Hand

- Volcano demo clips in `demo/` (idle loop and eruption, turning).
- Printable pyramid template in `template/`.
- No real story content yet beyond the volcano demo; do not invent curriculum claims.

## Product Principles

1. The group is the player: design every interactive phase so that it needs more than one person.
2. The hologram is the only screen players look at; setup UI never appears during a story.
3. An unattended exhibit must always recover: no dead ends, no state a visitor can leave it stuck in.
4. Authoring a story should feel like arranging scenes, not configuring software.
