# inlay — design

inlay helps you learn the fretboard of a stringed instrument. It shows you a note,
an interval or a scale; you find it on the neck, or name what's already marked. It
times every answer and builds a picture of where on the neck you are slow or unsure.

It is a sibling of [millitap](https://github.com/tehClayton/millitap) and shares its
platform, its storage and backup model, and its visual design, so the two read as one
publisher's work.

This document is the product and architecture reference. Work is planned against the
[milestones](#milestones) at the end.

## Principles

- **Static and dependency-free.** Plain HTML, CSS and JavaScript served from the
  repo root by GitHub Pages. No build step, no packages, no backend.
- **Your data stays on your device.** Everything lives in `localStorage`. No
  accounts, analytics or network calls. Export and import are the only way data
  moves, and the user starts both.
- **Works offline once loaded.** A service worker caches the app, and it installs to
  the home screen as a PWA.
- **Tap to answer.** The fretboard is the input, the way millitap's pads are. Every
  drill can be answered silently, without the instrument in hand.
- **Measure, then show.** Every answer is timed and scored. The history screen turns
  that into a heatmap of the neck and trends over time.

## Platform

### Target devices

The primary target is a **phone in landscape or a tablet**: a horizontal fretboard
across the screen, answered by touch. Desktop with a mouse and keyboard should work
but is not what layouts are tuned for. Phone portrait is out of scope for v1.

### Files

Served as-is from the repo root, following millitap's layout:

| File | Role |
| --- | --- |
| `index.html` | The practice screen: instrument, drill picker, fretboard, readouts |
| `history.html` | Progress: heatmap, trends, breakdowns, session table, backup |
| `theory.js` | Pitch, spelling, intervals, the scale and chord library. Pure functions |
| `fretboard.js` | SVG fretboard rendering and hit-testing |
| `drills.js` | Prompt generation, answer checking, adaptive weighting |
| `store.js` | All `localStorage` access, schema versions, migrations, export and import |
| `audio.js` | The optional plucked-string synth |
| `ui.js` | Shared UI: modals, toasts, the settings panel, footer |
| `sw.js` | Service worker. `VERSION` is bumped on every deploy |
| `manifest.webmanifest`, icons | PWA install |

Logic modules are **ES modules** (`<script type="module">`). millitap uses classic
scripts, but modules let the pure logic (`theory.js`, `drills.js`, `store.js`) be
unit-tested with Node's built-in test runner (`node --test`) without adding a single
dependency. Tests live in `test/` and are not deployed. Node is a development-only
requirement.

### Sharing an origin with millitap

Both apps are served from `tehclayton.github.io`, one origin, so they share storage.
This shapes three rules:

- **Every `localStorage` key is prefixed `inlay.`.** Nothing ever calls
  `localStorage.clear()`, and "delete all data" removes only `inlay.*` keys.
- **Cache names are prefixed `inlay-`.** The service worker deletes only old
  `inlay-*` caches, just as millitap's deletes only `millitap-*`.
- **The storage quota is shared.** Browsers give an origin about 5 MB of
  `localStorage`, and millitap uses some of it. inlay keeps its records compact (see
  [Storage](#storage)) and handles a full quota gracefully.

### Service worker

This is the same as millitap's: cache-first, with a `VERSION` constant that must be
bumped on every change pushed. The new worker installs in the background and a toast
offers to reload. Scope is `/inlay/`.

The `scripts/dev/pre-push-check.sh` seam should enforce the bump: if the pushed
range touches a deployed file and `sw.js`'s `VERSION` line is unchanged, the push
fails.

## Instruments

An instrument is a named, saved configuration. Users can keep several, such as
"Strat, standard", "Bass, 5-string" and "Banjo, open G". Each has its own history, so
practice on one never shows up in another's heatmap.

| Field | Meaning |
| --- | --- |
| `id` | Random UUID |
| `name` | User-chosen label |
| `strings` | One entry per string, in physical order from the string nearest the player's face to the one nearest the floor. Each is `{ open, start }`: `open` is the open pitch as a MIDI number, and `start` is the first playable fret (normally 0; 5 for a banjo's short fifth string) |
| `frets` | Highest fret, 1–36 |
| `leftHanded` | Mirrors the neck so the nut is on the right |
| `tabView` | Off: the string nearest the player's face is drawn at the top, as seen looking down at the neck. On: flipped, with the floor-side string at the top, as in tab. Named for physical position rather than pitch, because on re-entrant tunings the face-side string isn't the lowest |
| `created`, `updated` | Timestamps, used to resolve conflicts on import |

- **Physical order, not pitch order.** Re-entrant tunings like a ukulele's high G,
  or a banjo's drone string, have strings out of pitch order. The model stores them
  as they sit on the neck.
- **Any string count and any tuning.** The editor lets you add, remove and retune
  strings freely. Tunings are entered as note plus octave (`E2`, `D#3`).
- **Changing tuning after practice.** Retuning or restringing an instrument that
  already has history asks first. The user either starts a new instrument (the
  default) or keeps the history, which is then keyed by string and fret, not by pitch.
- **Inlay markers.** The fretboard draws dot markers at 3, 5, 7, 9, 12 (double),
  15, 17, 19, 21 and 24.

Capo support and a vertical, portrait fretboard are out of scope for v1.

## Notes and spelling

- Pitches are MIDI numbers internally. A **pitch class** (0–11) is what "find C"
  means.
- **Accidental preference** is a setting: sharps (`C#`), flats (`D♭`), or both
  (`C#/D♭`). It governs note-finding and note-naming drills. Answers are always
  accepted enharmonically, so `C#` is right when the target is `D♭`.
- **Theory drills spell by key.** Scale and chord drills spell notes correctly for
  their root regardless of the preference. F major has B♭, not A#.
- **Scale-degree labels.** Wherever a root is in play, notes can be labelled by
  interval from it: `1 ♭2 2 ♭3 3 4 ♯4/♭5 5 ♭6 6 ♭7 7`. This is a display toggle
  in study mode and theory drills, and an answer format in name-the-note.

## Drills

Every drill runs in the same loop:

1. A prompt appears: a note name, a highlighted fret, a root and an interval, or a
   scale to fill in.
2. You answer by tapping the fretboard, or the answer buttons in naming drills.
3. Feedback is immediate. A correct answer flashes green. A wrong answer flashes the
   tapped spot red and reveals the correct one, counts as a miss, and moves on.
   There are no retries.
4. The next prompt appears.

The loop runs **until you stop it**, the way millitap plays until you press stop.
One run is one **session**, saved on stop.

### Drill types

| Drill | Prompt | Answer |
| --- | --- | --- |
| **Find the note** | A note name and a string ("F# on the A string") | Tap the fret |
| **Find every** | A note name ("every G in frets 0–12") | Tap every occurrence in the window, any order |
| **Name the note** | A highlighted fret | Choose from 12 note buttons, or interval buttons when a root is set |
| **Interval** | A highlighted root and an interval ("major 3rd above") | Tap any position of the target note inside the window |
| **Chord tones** | A chord ("A minor") | Tap every chord tone in the window, any order |
| **Scale** | A root and scale type ("D dorian, frets 5–8") | Tap every scale tone, in ascending pitch order or any order |

"Find every", "Chord tones" and "Scale" share one **find-all** mechanic. The prompt
stays up until every target in the window is found. Each correct tap is timed from
the previous one, and each wrong tap is a miss.

### Drill options

Each drill is configured by the same filters. A saved combination is a
[set](#sets):

- **Strings.** Any subset.
- **Fret window.** A start and end fret, such as 0–5 or 5–8. The fretboard dims
  everything outside it.
- **Notes.** All twelve, naturals only, or a custom list.
- **Root and type** for theory drills, from the built-in library. The root can be
  fixed or random.
- **Order** for scales: ascending, or any order.
- **Adaptive.** Toggle, described below.

### Theory library

The built-in library is fixed in v1; there is no custom formula builder.

- **Scales:** major, natural minor, harmonic minor, melodic minor, the seven modes,
  major and minor pentatonic, and blues.
- **Chords:** major, minor, diminished and augmented triads; major 7, dominant 7,
  minor 7, half-diminished and diminished 7; sus2 and sus4.
- **Intervals:** minor 2nd to octave.

### Adaptive weighting

When adaptive is on, prompts favour the spots you are slow or wrong on. This is a
plain weighted random choice, not spaced repetition, so it has no hidden schedule
and needs no extra stored state.

Each candidate prompt gets a weight from the instrument's recent history, the last
20 sessions of that drill type:

```
w = 1 + slow + missed + unseen
    slow   = max(0, typical time here / typical time overall − 1)
    missed = 2 × miss rate here
    unseen = 1 if never answered here, else 0
w is clamped to [1, 4]
```

The floor of 1 means no candidate is ever starved, and the ceiling of 4 means no
single weak spot dominates. The same prompt never comes up twice in a row. With
adaptive off, every candidate has weight 1.

### Study mode

This is an unscored way to explore, like millitap's listen mode. Tap any fret to see
its note name, or its interval from a chosen root. You can also label the whole
board, or highlight a scale or chord shape across the neck. Nothing is recorded.

### Sets

A set is a saved drill configuration with a name, such as "Naturals on the low E,
frets 0–12". A set can also be a **playlist**: an ordered list of drills that each
run for a fixed number of prompts before advancing to the next. This mirrors
millitap's sets.

Sets belong to one instrument, because their string choices only make sense for
that instrument's strings.

## Measurement

### Timing

Response time runs from when a prompt is painted (the first animation frame after
render) to the `pointerdown` event's `timeStamp`. Answers take hundreds of
milliseconds to seconds, so browser timer precision doesn't matter. millitap's
timestamp diagnostics are not needed.

Answers slower than **15 s** still count toward accuracy but not toward timing. They
are treated as a distraction, not a slow find.

### Metrics

- **Accuracy:** correct answers over all answers.
- **Typical time:** the geometric mean of correct response times. Response times are
  skewed with a long slow tail, and their logarithms are close to normally
  distributed, so the geometric mean sits near the median. Unlike the median, it can
  be pooled across sessions from running sums.
- **Spread:** the standard deviation of log response time, shown as a ratio (×1.4
  means most answers fall within 1.4× either side of typical). This is the analogue
  of millitap's spread: how consistent you are, not just how fast.

These are computed per **position** (string and fret), per **pitch class**, per
**string**, and overall.

## Storage

`store.js` owns all persistence, and nothing else touches `localStorage`. It follows
millitap's pattern: versioned keys, transparent migrations, and an empty result if
storage is blocked.

| Key | Contents |
| --- | --- |
| `inlay.instruments.v1` | Array of instruments |
| `inlay.sessions.v1` | Array of session records, append-only |
| `inlay.sets.v1` | Array of sets, editable |
| `inlay.settings.v1` | Device preferences: accidentals, audio, last instrument |

### Session record

As in millitap, a session stores **aggregates, not raw answers**. This keeps a
record small enough for thousands to fit in a shared quota:

```js
{
  t: 1790000000000,          // start time, ms
  inst: "uuid",              // instrument id
  drill: "find",             // drill type
  key: "find:s0-5:f0-12:nat",// canonical config, groups sessions of the same drill
  label: "Find the note — naturals, frets 0–12",
  dur: 184000,               // ms from start to stop
  pos: {                     // per position touched, "string:fret"
    "0:3": [n, miss, sumLn, sumLn2],
    ...
  }
}
```

- **Only positions touched are stored.** Typical time and spread for any grouping
  (position, pitch class, string or overall) are computed from `n`, `sumLn` and
  `sumLn2` by summing.
- **Size and cap.** A typical session of about 50 answers is roughly 1 KB, and at
  most **2,000** sessions are kept, oldest pruned first.
- **Minimum length.** Sessions with fewer than 5 answers are not saved.
- **A full quota.** If a write hits `QuotaExceededError`, the store prunes the oldest
  10% of sessions, retries, and shows a toast suggesting an export.

### Durability

Safari can clear the storage of a site that hasn't been visited for 7 days, unless
it is installed to the home screen. inlay:

- calls `navigator.storage.persist()` where available;
- recommends installing to the home screen, as millitap does;
- shows the date of the last export and nudges for a new one after 30 days of
  practice without a backup.

### Export and import

- **Export** writes one JSON file:
  `{ app: "inlay", schema: 1, exported, instruments, sessions, sets }`. Device
  settings are not included.
- **Import merges, never replaces.** Sessions are deduplicated on
  instrument + `t` + `key`. Instruments and sets with the same `id` keep whichever
  copy has the newer `updated`.
- **Validation first.** The file is fully checked before anything is written, and a
  file from a newer schema is refused rather than partly understood.
- **Danger zone.** "Delete all data" removes every `inlay.*` key after a typed
  confirmation. Deleting an instrument deletes its sessions and sets, with its own
  confirmation.

## Screens

### Practice (`index.html`)

- **Header:** instrument switcher, drill picker, settings, and a link to history.
- **Prompt strip:** the current prompt in large type.
- **Readouts:** accuracy, typical time and answer count for the running session, in
  millitap's readout style.
- **Fretboard:** fills the width, with the drill's fret window lit and the rest
  dimmed.
- **Answer buttons:** shown only in naming drills. Twelve notes, or interval labels.
- **Transport:** start/stop, plus a study-mode toggle.

### History (`history.html`)

These adapt millitap's charts to the fretboard. Everything is filtered by instrument,
and optionally by drill:

- **Fretboard heatmap:** each position coloured by typical time or miss rate, with a
  toggle between the two. It is the headline chart. Positions with too few answers
  are drawn hollow, like millitap's faint under-practised dots.
- **Trend over sessions:** typical time and accuracy per session, as an individuals
  control chart with moving-range limits, the same method as millitap's spread chart.
- **By note and by string:** bars for the 12 pitch classes and for each string, the
  analogue of millitap's "By position".
- **Session table:** date, drill, duration, answers, accuracy and typical time.
- **Backup:** export, import, last-export date, and the danger zone.
- **Save as PDF:** a print stylesheet that restates the tokens for paper, as
  millitap's does.

### Settings

Accidental preference, audio on/off, handedness and string order for the current
instrument, the instrument editor, and the footer.

**Footer.** Plain text links, not buttons, in millitap's order: source on GitHub,
[Buy me a coffee](https://buymeacoffee.com/ditherstudio),
[Patreon](https://www.patreon.com/DitherStudio), and the app version.

## Audio

Audio is **off by default**. When it's on, tapping a fret plays that pitch through a
Karplus–Strong plucked-string synth built on Web Audio, and correct and wrong
answers get a short cue. There are no sample files, so audio works offline. The
audio context is unlocked on the first user gesture, which iOS requires.

## Visual design

inlay uses millitap's design tokens unchanged, so the two apps sit side by side:

| Token | Value |
| --- | --- |
| Ground | `#0E1419` |
| Panel (recessed) | `#1A232C` |
| Raised face | `#2A3743` → `#1E2933` gradient |
| Rule | `#2B3743` |
| Ink / dim / muted | `#EAF0F6` / `#93A4B7` / `#66788C` |
| Spacing | 4, 8, 12, 16, 24 px |
| Radii | 6, 10, 14 px |
| UI font | `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` |
| Mono font | `ui-monospace, "SF Mono", Menlo, monospace` |
| Type scale | 10 / 11 / 13 / 15 / 19 / 30 px |

It is **dark only**; print styles cover paper.

The **semantic colours are inlay's own**. Values are settled in M1 against the
ground:

- **Correct** and **wrong** reuse millitap's on-beat green `#7FCB8F` and missed rose
  `#C2566B`, which already mean right and wrong in the family.
- **Target**: the highlight on a prompted fret or root.
- **Fretboard:** a dark, low-saturation wood that sits on the ground rather than
  competing with it; muted fret wire and strings; pale mother-of-pearl inlay dots.
- **Heatmap:** a single-hue sequential ramp from the panel colour (fast, or never
  missed) to a warm highlight (slow, or often missed). Hollow cells mark too-little
  data.

## Accessibility

- **Keyboard.** Space starts and stops, and Escape closes modals. In naming drills,
  `A`–`G` plus `#` or `b` answer. Arrow keys move a focus cursor over the fretboard
  and Enter taps it, so every drill works without touch.
- **Focus-visible** outlines on all controls.
- **ARIA.** The prompt is an `aria-live` region, so screen readers announce each new
  prompt and the result.
- **Colour is never the only signal.** Correct and wrong also differ in shape (a
  check and a cross).
- **`prefers-reduced-motion`** removes the flash animations.

## Milestones

Each milestone is a stack of small branches, `m<N>/<NN>-<desc>`. See
[CLAUDE.md](CLAUDE.md).

**M1 — Core loop.** A usable app you can install and practise with.
- Scaffold: `index.html` with tokens, `manifest.webmanifest`, `sw.js` with the
  update toast, icons, and the footer
- `theory.js`: pitch, pitch class, spelling, parsing `E2`-style tunings
- Instruments: model, editor, save/switch/delete, handedness and string order
- `fretboard.js`: rendering, fret window dimming, and hit-testing
- Drills: find the note and name the note, with the continuous loop and feedback
- Sessions: aggregation and save-on-stop
- Backup: export, import, and delete all
- Keyboard and ARIA basics
- Dev tooling: Node in the dev container, `node --test` for pure modules, and the
  `VERSION`-bump pre-push check

**M2 — Progress.** `history.html`: heatmap, trend chart, by-note and by-string, and
session table. Study mode.

**M3 — Theory.** The interval, chord-tone and scale drills; the find-all mechanic
(including "find every"); scale-degree labels; and the scale and chord library.

**M4 — Practice tools.** Sets and playlists, adaptive weighting, and audio.

**M5 — Polish.** Save as PDF, the backup nudge, an accessibility pass, and install
guidance.

## Open questions

- **License.** Deferred. Until one is added, the code is all rights reserved by
  default.
- **Starter instruments.** Presets were not chosen for v1, so every instrument
  starts blank. Offering templates (guitar standard, bass 4 and 5, ukulele, banjo
  open G, mandolin) in the "new instrument" dialog would save typing without
  limiting anything.
- **Typical time.** The geometric mean is proposed over the true median because it
  pools across sessions from three numbers. A true median would mean storing every
  answer time, several times the storage.
- **Playlist advance.** A fixed number of prompts per drill is proposed. Alternatives
  are a time limit, or advancing only when you choose.
- **Icon and logo.** These need designing to sit beside millitap's.
