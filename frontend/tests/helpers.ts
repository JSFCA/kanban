import { expect, type Page } from "@playwright/test";

export const COLUMNS = '[data-testid^="column-"]';

/**
 * The board every test starts from.
 *
 * Since Part 7 the board is persisted, so tests mutate shared state. Each test
 * resets to this fixture rather than assuming whatever the previous one left
 * behind, and the suite runs serially for the same reason.
 */
export const RESET_BOARD = {
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: [] },
    { id: "col-review", title: "Review", cardIds: [] },
    { id: "col-done", title: "Done", cardIds: [] },
  ],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Align roadmap themes",
      details: "Draft quarterly themes with impact statements and metrics.",
    },
    "card-2": {
      id: "card-2",
      title: "Gather customer signals",
      details: "Review support tags, sales notes, and churn feedback.",
    },
    "card-3": {
      id: "card-3",
      title: "Prototype analytics view",
      details: "Sketch initial dashboard layout and key drill-downs.",
    },
  },
};

export const signIn = async (page: Page, password = "password") => {
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

/** Signs in through the UI, resets the stored board, and waits for it to render. */
export const openFreshBoard = async (page: Page) => {
  await page.goto("/");
  await signIn(page);
  await expect(page.locator(COLUMNS).first()).toBeVisible();

  const response = await page.request.put("/api/board", { data: RESET_BOARD });
  expect(response.status()).toBe(200);

  await page.reload();
  await expect(page.getByText("Align roadmap themes")).toBeVisible();
};

/** Runs an action and waits for the save it triggers to reach the server. */
export const savedAfter = async (page: Page, action: () => Promise<void>) => {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/api/board") &&
      response.request().method() === "PUT" &&
      response.status() === 200
  );
  await action();
  await saved;
};
