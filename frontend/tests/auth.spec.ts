import { expect, test } from "@playwright/test";

import { COLUMNS as columns, signIn } from "./helpers";

test("shows the login form instead of the board", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.locator(columns)).toHaveCount(0);
});

test("rejects bad credentials", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "wrong");

  // Scoped to the form: Next injects its own role="alert" route announcer.
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Invalid username or password"
  );
  await expect(page.locator(columns)).toHaveCount(0);
});

test("opens the board with good credentials", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "password");

  await expect(page.locator(columns)).toHaveCount(5);
});

test("keeps the session across a reload", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "password");
  await expect(page.locator(columns)).toHaveCount(5);

  await page.reload();

  await expect(page.locator(columns)).toHaveCount(5);
  await expect(page.getByLabel("Username")).toBeHidden();
});

test("signing out returns to the form and the board stays closed", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "password");
  await expect(page.locator(columns)).toHaveCount(5);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();

  await page.goto("/");

  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.locator(columns)).toHaveCount(0);
});

test("the API refuses to identify a signed-out visitor", async ({ request }) => {
  const response = await request.get("/api/me");

  expect(response.status()).toBe(401);
});
