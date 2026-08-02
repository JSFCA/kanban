# Frontend

The Kanban board UI. Statically exported and served by FastAPI at `/`. All state is still in React —
nothing is persisted and there is no auth yet. Parts 4, 7 and 10 of [../docs/PLAN.md](../docs/PLAN.md)
change that.

## Stack

- Next 16.1.6, App Router, React 19.2.3
- TypeScript, `@/*` aliased to `./src/*` (set in both `tsconfig.json` and `vitest.config.ts`)
- Tailwind v4 via `@tailwindcss/postcss` (no `tailwind.config`; theme lives in CSS)
- `@dnd-kit/core` + `@dnd-kit/sortable` for drag and drop
- `clsx` for conditional classes

## Layout

```
src/app/          layout.tsx (fonts, metadata), page.tsx (renders AuthGate), globals.css
src/components/   AuthGate, LoginForm, KanbanBoard, KanbanColumn, KanbanCard,
                  KanbanCardPreview, NewCardForm
src/lib/kanban.ts types, seed data, moveCard(), updateCard(), createId()
src/lib/api.ts    typed calls to /api: fetchMe, login, logout
src/test/setup.ts imports @testing-library/jest-dom
tests/            Playwright specs
```

## Auth

`AuthGate` is the root component. It calls `fetchMe()` on mount and renders a loading state, then either
`LoginForm` or `KanbanBoard`. Signing out clears the cookie via `logout()` and drops back to the form.

`fetchMe()` returns `null` for 401 rather than throwing, so the gate can branch without a try/catch.
Requests use `credentials: "same-origin"` — the site is served by the same process that owns `/api`, so
the session cookie rides along.

This gate is presentation only. The HTML is a static export served to everyone; what actually protects
data is `require_user` on the API.

`test-results/` is stray Playwright output, not source.

## Data model

[src/lib/kanban.ts](src/lib/kanban.ts) defines the shape the whole app uses:

```ts
type Card = { id: string; title: string; details: string };
type Column = { id: string; title: string; cardIds: string[] };
type BoardData = { columns: Column[]; cards: Record<string, Card> };
```

Cards are stored flat in `cards` and referenced by id from `column.cardIds` — ordering lives on the column.
`initialData` seeds five columns (`col-backlog`, `col-discovery`, `col-progress`, `col-review`, `col-done`)
and eight cards.

`moveCard(columns, activeId, overId)` is a pure function covering reorder-within-column, move-to-another-
column, and drop-on-empty-column (when `overId` is a column id). `updateCard(cards, cardId, fields)` is the
same idea for card content: it patches title and/or details, returns the input untouched for an unknown id,
and never mutates. Both are directly unit tested in [src/lib/kanban.test.ts](src/lib/kanban.test.ts). Keep
them pure and keep them as the seam — backend integration should call them and send the result, not
reimplement the logic.

`createId(prefix)` returns `prefix-<random><timestamp>`, base36. Once the backend owns ids, this is the
thing to replace.

## State

[src/components/KanbanBoard.tsx](src/components/KanbanBoard.tsx) is the only stateful component: one
`useState<BoardData>` seeded from `initialData`, plus `activeCardId` for the drag overlay. It is a client
component (`"use client"`); everything below it is presentational and takes callbacks.

The four mutation points, all in `KanbanBoard.tsx`:

| Handler | Triggered by |
|---|---|
| `handleRenameColumn` | column title input in `KanbanColumn` |
| `handleAddCard` | `NewCardForm` submit |
| `handleUpdateCard` | inline edit on `KanbanCard`, delegates to `updateCard` |
| `handleDeleteCard` | Remove button on `KanbanCard` |
| `handleDragEnd` | dnd-kit, delegates to `moveCard` |

Every one of them goes through `apply(next, delay)`, which sets local state and then saves via
`PUT /api/board`. The pure reducers stay the single source of truth for what a change *means*; the server
only stores the result. Column rename passes a 400ms delay so a burst of keystrokes collapses into one
request — `apply` clears any pending timer, so the latest board always wins.

The board is loaded from `GET /api/board` on mount. `board` is `null` until it arrives, which is why every
handler starts with a `if (!board) return` guard.

## Inline card editing

Click a card's title or details to edit it. `KanbanCard` holds the `editing` field and a `draft` string.
Title commits on Enter or blur; details is a textarea, so Enter inserts a newline and only blur commits.
Escape cancels either. A title cleared to whitespace is discarded rather than saved, which would leave the
card unlabelled.

**The card is its own drag handle** — `attributes` and `listeners` are spread on the `<article>`. Drag
listeners are therefore withheld while `editing` is set, otherwise dnd-kit swallows pointer events and the
fields cannot be focused or selected. jsdom cannot detect this; the Playwright test asserts `toBeFocused()`
after the click, which is what actually guards it.

## Drag and drop

`DndContext` with `closestCorners`, a `DragOverlay` rendering `KanbanCardPreview`, and a `PointerSensor`
with `activationConstraint: { distance: 6 }`. Columns are `useDroppable`; cards are `useSortable` inside a
`SortableContext` with `verticalListSortingStrategy`.

The 6px activation distance matters for tests: a drag must move at least 6px before dnd-kit starts
tracking. The Playwright drag test uses `mouse.move` / `down` / `move({ steps: 12 })` / `up` for this
reason. jsdom cannot do real pointer drags, so drag behaviour is unit tested through `moveCard` and
end-to-end through Playwright, never through Testing Library.

## Styling

Colors are CSS custom properties on `:root` in [src/app/globals.css](src/app/globals.css) and match the
palette in [../CLAUDE.md](../CLAUDE.md):

`--accent-yellow` `--primary-blue` `--secondary-purple` `--navy-dark` `--gray-text`
plus `--surface`, `--surface-strong`, `--stroke`, `--shadow`.

Components reference `var(--name)` in Tailwind arbitrary values, e.g.
`text-[var(--navy-dark)]`. Do not hardcode hex in components — add a variable instead.

Fonts are Space Grotesk (`--font-display`, applied via the `.font-display` class) and Manrope
(`--font-body`, the default), loaded with `next/font/google` in `layout.tsx`. This downloads at build time,
so the Docker build stage needs network access.

Stable selectors for tests: `data-testid="column-<columnId>"`, `data-testid="card-<cardId>"`,
`aria-label="Column title"`, `aria-label="Card title"`, `aria-label="Card details"`,
`aria-label="Delete <card title>"`.

Gotchas when writing selectors:

- Both `LoginForm` and `KanbanBoard` render an `<h1>Kanban Studio</h1>`, so that heading cannot tell them
  apart. Assert on `data-testid^="column-"` instead.
- Next injects its own route-announcer element with `role="alert"`, so a bare `getByRole("alert")` matches
  two nodes and trips Playwright's strict mode. Scope it, e.g. `page.locator("form").getByRole("alert")`.
- dnd-kit gives each card `role="button"`, and its accessible name concatenates all the inner text —
  including the delete button's label. **Playwright matches `name` by substring, Testing Library matches it
  exactly**, so a locator can pass in vitest and be ambiguous in Playwright. Scope to the card and pass
  `exact: true`.
- The delete button's accessible name is its `aria-label` (`Delete <title>`), not its visible text
  ("Remove"). `aria-label` wins over content.

## Tests

```
npm run test        # vitest, src/**/*.{test,spec}.{ts,tsx}
npm run test:e2e    # playwright, tests/
npm run test:all    # both
```

vitest runs in jsdom with globals enabled (`describe`/`it`/`expect` need no import) and explicitly excludes
`tests/` so Playwright specs are not picked up.

[playwright.config.ts](playwright.config.ts) runs against the **container**, not `next dev`, with `baseURL`
at `http://localhost:8000`. [global-setup.ts](global-setup.ts) runs `scripts/start.sh` before the suite, so
e2e exercises the real static export served by FastAPI. A cold run pays for a Docker build.

**Do not move this back to Playwright's `webServer` option.** It expects a long-lived foreground process
and fails with "Process from config.webServer exited early" when the command returns first — which
`start.sh` always does, since it launches a detached container and exits once `/api/health` answers. Under
`webServer` the suite failed intermittently on completely healthy starts, depending on whether Playwright's
URL poll landed before the script exited. Tracing showed the script exiting 0 with the app up while
Playwright still reported the error.

The container is left running afterwards; run `scripts/stop.sh` when you want a guaranteed-fresh build.

## Build

`output: "export"` in [next.config.ts](next.config.ts) makes `npm run build` emit a static bundle to `out/`.
The Dockerfile's node stage runs that build and copies `out/` to `/app/static` in the runtime image. No
Node.js ships to production, and `out/` is gitignored — the build output never exists in the repo.

## Known gaps

- No persistence; a refresh resets to `initialData` (Parts 6-7)
- No auth (Part 4)
- No AI sidebar (Part 10)
- Column rename fires on every keystroke, so it will need debouncing or blur-commit once it writes to the API
