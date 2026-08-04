import { test, expect } from "@playwright/test";
import { openFreshBoard } from "./helpers";

/**
 * These three tests each make a real OpenRouter call, so they are the slowest
 * and least predictable in the suite. Assertions stay on what the feature
 * guarantees -- a reply arrives, a requested move lands and survives a reload --
 * rather than on the model's exact wording, which is not ours to control.
 */

const AI_TIMEOUT = 45_000;

const openSidebar = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "AI assistant" }).click();
  await expect(page.getByLabel("Message the AI")).toBeVisible();
};

const ask = async (page: import("@playwright/test").Page, message: string) => {
  const answered = page.waitForResponse(
    (response) => response.url().includes("/api/ai/chat"),
    { timeout: AI_TIMEOUT }
  );
  await page.getByLabel("Message the AI").fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  return answered;
};

test.describe("AI sidebar", () => {
  test("opens, closes, and keeps the board reachable", async ({ page }) => {
    await openFreshBoard(page);

    await openSidebar(page);
    await expect(page.getByText("Align roadmap themes")).toBeVisible();

    await page.getByRole("button", { name: "Close the AI assistant" }).click();
    await expect(page.getByLabel("Message the AI")).toBeHidden();
  });

  test("answers a question without touching the board", async ({ page }) => {
    await openFreshBoard(page);
    await openSidebar(page);

    const response = await ask(page, "How many cards are on the board? Answer with the number.");
    expect(response.status()).toBe(200);
    expect((await response.json()).board_updated).toBe(false);

    // The user's turn and a reply, so two message bubbles in the thread.
    await expect(page.getByText("Thinking")).toBeHidden({ timeout: AI_TIMEOUT });
    await expect(page.getByText("Align roadmap themes")).toBeVisible();
  });

  test("moves a card on request and the change survives a reload", async ({ page }) => {
    await openFreshBoard(page);
    await expect(page.getByTestId("column-col-done")).not.toContainText(
      "Prototype analytics view"
    );
    await openSidebar(page);

    const response = await ask(
      page,
      "Move the card titled 'Prototype analytics view' to the Done column."
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.board_updated, `the model declined to change the board: ${body.reply}`).toBe(
      true
    );

    // No reload: the board re-renders from the response alone.
    await expect(page.getByTestId("column-col-done")).toContainText(
      "Prototype analytics view",
      { timeout: AI_TIMEOUT }
    );

    await page.reload();
    await expect(page.getByTestId("column-col-done")).toContainText(
      "Prototype analytics view"
    );
  });
});
