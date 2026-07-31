# Frontend

A Next.js demo of the Kanban board. Frontend-only: all state is in React, nothing is persisted, there is no
auth and no backend. Parts 3, 4, 7 and 10 of [../docs/PLAN.md](../docs/PLAN.md) change that.

## Stack

- Next 16.1.6, App Router, React 19.2.3
- TypeScript, `@/*` aliased to `./src/*` (set in both `tsconfig.json` and `vitest.config.ts`)
- Tailwind v4 via `@tailwindcss/postcss` (no `tailwind.config`; theme lives in CSS)
- `@dnd-kit/core` + `@dnd-kit/sortable` for drag and drop
- `clsx` for conditional classes

## Layout

```
src/app/          layout.tsx (fonts, metadata), page.tsx (renders KanbanBoard), globals.css
src/components/   KanbanBoard, KanbanColumn, KanbanCard, KanbanCardPreview, NewCardForm
src/lib/kanban.ts types, seed data, moveCard(), createId()
src/test/setup.ts imports @testing-library/jest-dom
tests/            Playwright specs
```

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
column, and drop-on-empty-column (when `overId` is a column id). It is directly unit tested in
[src/lib/kanban.test.ts](src/lib/kanban.test.ts). Keep it pure and keep it as the seam — backend
integration should call it and send the result, not reimplement the ordering logic.

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
| `handleDeleteCard` | Remove button on `KanbanCard` |
| `handleDragEnd` | dnd-kit, delegates to `moveCard` |

These are the functions that become API calls in Part 7. There is no card-edit handler yet — Part 3 adds
one.

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
`aria-label="Column title"`, `aria-label="Delete <card title>"`.

## Tests

```
npm run test        # vitest, src/**/*.{test,spec}.{ts,tsx}
npm run test:e2e    # playwright, tests/
npm run test:all    # both
```

vitest runs in jsdom with globals enabled (`describe`/`it`/`expect` need no import) and explicitly excludes
`tests/` so Playwright specs are not picked up.

[playwright.config.ts](playwright.config.ts) currently boots `next dev` on `127.0.0.1:3000` via `webServer`
and uses that as `baseURL`. Part 2/3 must repoint both at the FastAPI container.

## Known gaps

- No card editing — cards can be added, deleted and moved, but title/details cannot be changed (Part 3)
- No persistence; a refresh resets to `initialData` (Parts 6-7)
- No auth (Part 4)
- No AI sidebar (Part 10)
- [next.config.ts](next.config.ts) is empty; static serving needs `output: "export"` (Part 3)
- Column rename fires on every keystroke, so it will need debouncing or blur-commit once it writes to the API
