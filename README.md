# Holo Stage

A Progressive Web App that tells interactive stories inside a 4-sided Pepper's ghost hologram pyramid.
3D animation chapters alternate with phases where the story waits for the group. Each pyramid face belongs to one player, and each player has one physical button.

## Run it

```bash
python3 -m http.server 8765
# open http://localhost:8765
```

To install it as an app on a tablet or phone, host the folder over **HTTPS**, for example on GitHub Pages, Netlify or Cloudflare Pages. Then open it in Chrome/Edge and choose *Install app* (or *Add to Home Screen* on iOS). After that it runs offline.

## Build a story

Open setup with the button in the top-left corner (move the mouse or tap the corner), or press **F1**. On a wide screen the pyramid layout stays visible beside the panel as a live preview.

On the very first start a short tutorial walks through setup: building the pyramid, loading videos, building scenes, assigning buttons and playing. Open it again any time with the **?** button at the top of the panel.

*Story → Load the volcano demo story* gives you a complete example to take apart.

1. **Videos → Add video…**: choose one clip, or drag individual video files onto the panel. Use plain, upright, unmirrored videos on a black background. The app rotates and flips each one for its face. Square videos fill the tiles best.
   To use a video, drag it from the library (or from the *Drag onto a slot* strip above the Story and Buttons tabs) onto any clip field, a scene header, a player's free play clips, or a pyramid face. Hover over a tab while dragging to switch to it. Clips from the bundled packs can be dragged too; they're added to the library on drop.
2. **Story**: add scenes in the order they should play. Click a scene to edit it; the stage jumps to it and shows what you type.

| Scene | What happens |
|---|---|
| **Animation** | A clip plays on all four faces, with an optional caption. Plays once, or loops for a set time. |
| **All together** | A ring fills only while every player holds their button (or keeps tapping it). The picture brightens and shakes as it fills. A second clip can play when they make it. |
| **Quiz** | Each press moves a player's marker to the next answer, and everyone sees where the others stand. The group decides by agreeing on one answer, or by majority when a timer runs out. An answer can jump to another scene, so a vote can branch the story. |
| **Take turns** | One player at a time is asked to press; each turn plays the next clip. Without a waiting clip the last frame stays, so turns can build something up. |

3. **Buttons**: give each player the color of their physical button and assign the button (see below). The hologram shows the four players as colored dots, arranged as each player sees them around the pyramid.
4. **Pyramid**: match the tile size and center hole to your pyramid. Turn on *Show alignment guides* while setting up.
   - *Small end on screen* is for phone/tablet pyramids.
   - *Big end on screen* is for apex-up pyramids over a large display.
   - *Build the pyramid* works out the cutting sizes for your screen (diagonal and aspect ratio, or the measured short side of the picture) from the current tile size and center hole. It prints a 1:1 cutting template (A4, or A3 for large screens) and gives step-by-step cutting and assembly instructions.
5. **Play fullscreen**: the screen stays awake and the cursor hides.

### How a story runs

- The start screen loops until someone presses a button. Others get a few seconds to join; a latecomer joins by pressing.
- Only players who joined are waited for. Someone who stops pressing for 15 seconds is no longer waited for, so a group is never stuck.
- When nobody presses during an interactive scene (45 s by default), the story goes back to the start screen.
- For a guide: the corner controls restart, step back, pause and skip. On a keyboard: **Home**, **←**, **P**, **→**.
- *Story → Timing and wording* holds the join and idle times and the few words the pyramid says itself, so you can put them in your language.

*Free play* (the switch at the top of *Story*) is the older behaviour: every player triggers their own clips, set up under *Buttons → Free play clips*. It also runs whenever the story has no scenes.

## Assign buttons

**Buttons → Assign button**, then press the physical button. It works with keyboard keys, USB/Bluetooth gamepads, arcade encoders and joystick directions. The *Live input* box shows what the app receives. Touching a tile on the screen presses that player's button, which is handy without hardware.

## Wiring physical buttons

All of these work without drivers, using the *Assign button* step above:

- **USB arcade encoder** ("zero delay" boards): shows up as a gamepad.
- **Arduino Leonardo / Pro Micro / Pi Pico**: set it up as a USB keyboard or gamepad, e.g. with `Keyboard.h`.
- **Bluetooth page-turner or media buttons**: send key presses.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | page and styles |
| `app.js` | storage, stage, button input |
| `story.js` | story engine and the prompts shown in the hologram |
| `ui.js` | setup panel and story editor |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA install and offline support |
| `demo/` | volcano demo clips |

Videos and settings are stored in the browser (IndexedDB). *Pyramid → Export story and settings* saves the story, players, buttons and layout as JSON. It doesn't include the videos. When you import on another device, clips are re-linked by file name.
