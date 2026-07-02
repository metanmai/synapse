import { expect, test } from "@playwright/test";

// Phase 2 Plan 02-06: browser-driven e2e for the LinkPicker UI states.
// Targets the test-only fixture route at /__e2e/link-picker, which mounts the
// real LinkPicker component with mock props (no Supabase auth, no backend).
// Asserts the locked copy strings from 02-UI-SPEC.md so future copy edits
// don't silently regress the contract.

test.describe("LinkPicker — IDENT-02 manual link UI (states A-F)", () => {
  test("State A — idle: trigger button visible with locked copy", async ({ page }) => {
    await page.goto("/__e2e/link-picker?scenario=basic");

    await expect(page.getByRole("heading", { name: "Linked Projects" })).toBeVisible();
    await expect(page.getByText(/Link this project to another one of your projects/)).toBeVisible();

    const trigger = page.getByRole("button", { name: "+ Link to existing project" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeEnabled();

    // Picker is collapsed in State A — Continue button + radios not in the DOM yet.
    await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  });

  test("State A — disabled when no other projects exist (empty scenario)", async ({ page }) => {
    await page.goto("/__e2e/link-picker?scenario=empty");

    const trigger = page.getByRole("button", { name: "+ Link to existing project" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeDisabled();
    await expect(page.getByText("(You need at least 2 projects to link.)")).toBeVisible();
  });

  test("State B — picker open: candidates render with Matched badges", async ({ page }) => {
    await page.goto("/__e2e/link-picker?scenario=with-match");

    await page.getByRole("button", { name: "+ Link to existing project" }).click();

    // Suggested matches section appears for the candidate
    await expect(page.getByText("Suggested matches")).toBeVisible();
    await expect(page.getByText("Same git remote")).toBeVisible();

    // Matched badge with accessible label
    const matchedBadge = page.getByLabel("Matched: same git remote URL");
    await expect(matchedBadge).toBeVisible();
    await expect(matchedBadge).toHaveText("Matched");

    // "Your other projects" heading present
    await expect(page.getByText("Your other projects")).toBeVisible();

    // Body copy from UI-SPEC §Surfaces 1 (State B)
    await expect(
      page.getByText(/Select a project to link this one into\. Events from this project will be moved/),
    ).toBeVisible();

    // Continue is disabled until a target is picked
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  test("State C — type-to-confirm: submit disabled until source name matches", async ({ page }) => {
    await page.goto("/__e2e/link-picker?scenario=basic");

    await page.getByRole("button", { name: "+ Link to existing project" }).click();
    // Pick the only target radio
    await page.locator('input[type="radio"][name="targetProjectId"]').first().check();
    await page.getByRole("button", { name: "Continue" }).click();

    // Confirm prompt + locked copy
    await expect(page.getByText(/This is irreversible\. Type the source project name to confirm\./)).toBeVisible();

    const submit = page.getByRole("button", { name: "Link projects & delete source" });
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();

    // One char off — still disabled
    const input = page.getByPlaceholder('Type "source-project" to confirm');
    await input.fill("source-projec");
    await expect(submit).toBeDisabled();

    // Exact match — enabled
    await input.fill("source-project");
    await expect(submit).toBeEnabled();

    // Cancel button is present + enabled in State C
    await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  test("State D — loading: spinner appears + button disabled during submit", async ({ page }) => {
    await page.goto("/__e2e/link-picker?scenario=basic&next=loading");

    await page.getByRole("button", { name: "+ Link to existing project" }).click();
    await page.locator('input[type="radio"][name="targetProjectId"]').first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder('Type "source-project" to confirm').fill("source-project");

    // Submit and immediately assert loading state (action sleeps 1500ms)
    const submit = page.getByRole("button", { name: "Link projects & delete source" });
    await submit.click();

    await expect(page.getByText("Linking…")).toBeVisible();
    await expect(page.locator(".spinner.spinner-sm")).toBeVisible();
  });

  test("State E — success: redirect lands on the target URL", async ({ page }) => {
    await page.goto("/__e2e/link-picker?scenario=basic&next=success");

    await page.getByRole("button", { name: "+ Link to existing project" }).click();
    await page.locator('input[type="radio"][name="targetProjectId"]').first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder('Type "source-project" to confirm').fill("source-project");
    await page.getByRole("button", { name: "Link projects & delete source" }).click();

    // 303 redirect → ?landed=1 marker on the fixture route (proxies prod's
    // /projects/<target>/settings redirect target — the contract is "successful
    // submit triggers a navigation", not "the URL string matches a specific path")
    await page.waitForURL("**/__e2e/link-picker?landed=1", { timeout: 5000 });

    // The fresh load is back in State A — trigger button visible again
    await expect(page.getByRole("button", { name: "+ Link to existing project" })).toBeVisible();
  });

  test("State F — error 403: locked copy renders inside role=alert; form re-enabled for retry", async ({ page }) => {
    await page.goto("/__e2e/link-picker?scenario=basic&next=403");

    await page.getByRole("button", { name: "+ Link to existing project" }).click();
    await page.locator('input[type="radio"][name="targetProjectId"]').first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder('Type "source-project" to confirm').fill("source-project");
    await page.getByRole("button", { name: "Link projects & delete source" }).click();

    // Locked UI-SPEC §State F copy for 403
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      /You're not the owner of one of these projects\. Only the owner can link projects\./,
    );

    // Form is re-enabled for retry — submit button is reachable + clickable again
    // (still gated by confirmInput exact-match; here input is filled so it's enabled)
    await expect(page.getByRole("button", { name: "Link projects & delete source" })).toBeEnabled();
  });
});
