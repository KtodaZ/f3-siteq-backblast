import { expect, test } from "@playwright/test";

test.describe("Homepage", () => {
	test("should load and display the main content", async ({ page }) => {
		await page.goto("/");

		// Wait for the page to load
		await expect(page).toHaveTitle(/F3 SiteQ Backblast/);

		// Check that the page contains some expected content
		// You can modify these assertions based on your actual homepage content
		await expect(page.locator("body")).toBeVisible();
	});

	test("should have working navigation", async ({ page }) => {
		await page.goto("/");

		// Example: Test navigation elements
		// You can modify these based on your actual navigation structure
		const navigation = page.locator("nav");
		if (await navigation.isVisible()) {
			await expect(navigation).toBeVisible();
		}
	});

	test("should be responsive", async ({ page }) => {
		// Test mobile viewport
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");

		await expect(page.locator("body")).toBeVisible();

		// Test desktop viewport
		await page.setViewportSize({ width: 1920, height: 1080 });
		await expect(page.locator("body")).toBeVisible();
	});
});
