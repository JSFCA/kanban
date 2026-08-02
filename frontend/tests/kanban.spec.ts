import { expect, test } from "@playwright/test";
import { COLUMNS, openFreshBoard, savedAfter } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openFreshBoard(page);
});

test("loads the kanban board", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator(COLUMNS)).toHaveCount(5);
});

test("adds a card and keeps it after a reload", async ({ page }) => {
  const firstColumn = page.locator(COLUMNS).first();

  await savedAfter(page, async () => {
    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
    await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
    await firstColumn.getByRole("button", { name: /add card/i }).click();
  });

  await page.reload();

  await expect(page.getByText("Playwright card")).toBeVisible();
});

test("edits a card title and keeps it after a reload", async ({ page }) => {
  const card = page.getByTestId("card-card-1");

  await savedAfter(page, async () => {
    await card.getByText("Align roadmap themes").click();
    const input = card.getByLabel("Card title");
    await expect(input).toBeFocused();
    await input.fill("Edited in the browser");
    await input.press("Enter");
  });

  await page.reload();

  await expect(page.getByText("Edited in the browser")).toBeVisible();
  await expect(page.getByText("Align roadmap themes")).toBeHidden();
});

test("deletes a card and keeps it deleted after a reload", async ({ page }) => {
  await savedAfter(page, async () => {
    // dnd-kit makes the card itself role="button", and its accessible name
    // concatenates the inner text including the delete label. Playwright matches
    // names by substring, so this needs both a scope and exact: true. The
    // button's own name is its aria-label, not the visible word "Remove".
    await page
      .getByTestId("card-card-2")
      .getByRole("button", { name: "Delete Gather customer signals", exact: true })
      .click();
  });

  await page.reload();

  await expect(page.getByText("Gather customer signals")).toBeHidden();
});

test("renames a column and keeps it after a reload", async ({ page }) => {
  const title = page.getByTestId("column-col-review").getByLabel("Column title");

  await savedAfter(page, async () => {
    await title.fill("Needs review");
  });

  await page.reload();

  await expect(
    page.getByTestId("column-col-review").getByLabel("Column title")
  ).toHaveValue("Needs review");
});

test("moves a card between columns and keeps it there after a reload", async ({
  page,
}) => {
  const card = page.getByTestId("card-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await savedAfter(page, async () => {
    await page.mouse.move(
      cardBox.x + cardBox.width / 2,
      cardBox.y + cardBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 120, {
      steps: 12,
    });
    await page.mouse.up();
  });
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();

  await page.reload();

  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1")
  ).toBeVisible();
});
