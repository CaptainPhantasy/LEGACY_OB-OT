# Legacy
## Or: You Were Only Supposed to Look Around

---

**DOCUMENT CLASSIFICATION:** Curiosity shop / questionable use of your afternoon  
**LOCATION:** Somewhere between a garage and a rabbit hole  
**BEVERAGE:** Coffee that tastes like motor oil. Still works.  
**CURRENT STATE:** The lamps are on. Make of that what you will.

---

A little shop full of old things. Some familiar. Some that raise more questions than their labels answer.

Walk in. Look around. Pick something that catches your eye. Follow it somewhere you weren't planning to go.

**[Step inside Legacy →](https://sundays-old-books.captainphantasy.chatgpt.site/)**

The street carries on outside. Inside, you can take your time.

## Have a wander (Or: Curiosity doesn't need a productivity target)

Legacy is a place you explore in your browser. Move through the room, look closely at the shelves, and choose your own detours. Objects lead to real places on the wider internet; those open in another tab, so the shop stays where you left it.

No required order. No quiz at the end. Nobody needs a quarterly report on what you found.

- **Phone or tablet:** use the movement circle to walk. Drag the room with your other hand to look around.
- **Keyboard and mouse:** use W A S D or the arrow keys to walk, and drag to look.
- **Prefer named choices?** Open **Look around** and choose a place. Tab and Enter work too.
- **Make yourself comfortable:** sound is optional. Settings include gentler movement, brighter lighting, and a still view.

That's enough of a map. Something on a shelf can handle the next introduction.

## From the garage (Or: Because “I could make that” keeps getting out of hand)

This is Floyd Labs territory: Douglas building things because an idea wouldn't leave him alone, questionable coffee doing its best, and absolutely no need for a boardroom.

A little *Meddle* energy. A lot of attention to the person on the other side of the screen.

Bella, the larger of the two black cats, would like her workspace back. Bowser, the skinny one, would probably get there first. Neither has submitted a PowerPoint.

## Run your own copy (Or: The useful bit under the dust)

From the project folder, serve the `dist/` directory:

```sh
python3 -m http.server 8080 --directory dist
```

Then open [localhost:8080](http://localhost:8080/). Keep the asset paths relative so the shop can also live inside a larger website.

Run the checks with:

```sh
node --test --test-reporter=spec scripts/*.test.mjs
```

## Work on the room (Or: Mind where you put the screwdriver)

Read `AGENTS.md` before editing. Preserve the authored material, keep discoveries optional, and leave visitors room to find things for themselves.

The editable Blender scenes are stored with Git LFS, which handles the repository's larger files. After installing Git LFS and cloning the repository, download them with:

```sh
git lfs pull
```

The scenes and supporting records are in `art/`; checks and supporting scripts are in `scripts/`. The existing scene files are earlier building blocks, not a promise that they contain every later runtime improvement.

Use a separate working copy for rebuilding. Keep replaced working files in quarantine rather than deleting them.

---

**DOCUMENT ENDS**

*— Floyd Labs, Department of “What Happens If I Touch This?”*

**Coffee quality:** disputed.  
**Curiosity:** encouraged.  
**Corporate polish:** misplaced somewhere in the garage.

The door's there. Have a look.
