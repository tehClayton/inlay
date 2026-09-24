# CLAUDE.md

Guidance for working in this repository.

inlay is a static, dependency-free web app for learning the fretboard of a stringed
instrument, served from the repo root by GitHub Pages. [DESIGN.md](DESIGN.md) is the
product and architecture reference and defines the milestones.

## Branching & pull requests

Never commit directly to `main` — always branch first.

### Milestone work (stacked branches)

Work that maps to a milestone in [DESIGN.md](DESIGN.md#milestones) is split into a
stack of small branches:

```
m<N>/<NN>-<short-desc>
```

- `<N>` — milestone number (e.g. `m1`, `m2`)
- `<NN>` — zero-padded sequence number giving the **stack order** (`01`, `02`, …)
- `<short-desc>` — kebab-case summary

Example stack:

```
m1/01-setup → m1/02-models → m1/03-migrations → m1/04-auth → m1/05-docs
```

Each branch is cut from the previous one. Open **one PR per branch**, each targeting
the branch below it; only the first (`*/01-*`) targets `main`. Merge bottom-up.

### Non-milestone work (type-prefixed branches)

One-off changes use a conventional type prefix:

```
<type>/<short-desc>
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `experiment`.
Examples: `fix/dedup-null-id`, `chore/bump-deps`, `docs/api-examples`.

These are normally a single branch targeting `main` directly. If a non-milestone
change is large enough to warrant splitting, reuse the stacked `<NN>-` numbering
within the prefix (e.g. `refactor/01-extract-ingest`, `refactor/02-rewire-callers`).

## Commits

- One logical change per commit; keep them small and tidy with descriptive messages.
- End each commit message with a `Co-Authored-By` trailer for the model that wrote it.
