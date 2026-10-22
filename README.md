# LEGACY_OB-OT

Sunday's Old Books & Odd Things — an explorable curiosity shop and the home of Douglas's book.

Live site: https://sundays-old-books.captainphantasy.chatgpt.site/

The repository preserves the original GitHub commit and the complete Sites history through version 9, source commit `945d960b852455e105146fa99a9449ed99952da9`. The site identity remains `appgprj_6ad8807dd7f881919dec6e1a28881f9e`.

## Run locally

Serve `dist/` with any static HTTP server. For example:

```sh
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080/. Asset URLs remain relative so the site can also live in a subdirectory.

## Check the experience

```sh
node --test --test-reporter=spec scripts/room-*.test.mjs
```

Version 9 passed 36 automated checks and inspection of 36 rendered stills. See `art/v9-verification.md` for evidence and limitations. Those stills are not live browser screenshots.

## Editable 3D source

Install Git LFS, then run `git lfs pull` after cloning to download the native Blender scenes:

- `art/room-rabbit-holes.blend`: completed version 9 scene.
- `art/room-curiosities.blend`: preceding scene used by the shelf-generation script.

Both were checked in Blender 4.5.7: all 19 file images are packed and no linked libraries are required. `art/native-scene-manifest.json` records their sizes and hashes. The generation, baking, export, and verification scripts are retained in `art/` and `scripts/`.

The reproduction sequence is documented in `art/v9-verification.md`. Use a separate working copy for a fresh rebuild: the shelf builder intentionally refuses to overwrite an existing final scene. Intermediate EXRs, quarantine copies, and render logs are not needed to open the packed scenes.

Read `AGENTS.md` before editing. Douglas's authored book content must remain unchanged unless he supplies a revision.
