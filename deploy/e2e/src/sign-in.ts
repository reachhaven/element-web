// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";

import { closeDialog, dialog, openUserSettings, userMenu } from "./element";
import { settings, suiteDir, type Person } from "./env";
import type { Session } from "./session";

type ProviderLogin = { loginThroughProvider: (page: Page, person: Person) => Promise<void> };

const keysFile = path.resolve(suiteDir, ".recovery-keys.json");
const clientOrigin = new URL(settings.baseUrl).origin;
const signedInTimeout = 180_000;

const account = (person: Person): string => person.matrixUserId ?? `${person.username ?? person.id} at ${clientOrigin}`;

const keysSchema = z.record(z.string(), z.string());

const storedKeys = (): Record<string, string> => {
    if (!existsSync(keysFile)) return {};
    const parsed = keysSchema.safeParse(JSON.parse(readFileSync(keysFile, "utf8")));
    if (!parsed.success) throw new Error(`${keysFile} is not a map of accounts to recovery keys`);
    return parsed.data;
};

const storeKey = (person: Person, key: string): void => {
    const keys = `${JSON.stringify({ ...storedKeys(), [account(person)]: key }, null, 4)}\n`;
    writeFileAtomic.sync(keysFile, keys, { mode: 0o600 });
};

export const knownRecoveryKey = (session: Session): string | undefined =>
    session.recoveryKey ?? storedKeys()[account(session.person)];

const isConsent = (url: URL, authOrigin: string): boolean =>
    url.origin === authOrigin && url.pathname.split("/").includes("consent");

const passwordLogin = async (page: Page, person: Person): Promise<void> => {
    const username = page.getByRole("textbox", { name: "Username" });
    const hasForm = await username
        .waitFor({ timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
    if (!hasForm || !person.username || !person.password) {
        throw new Error(
            `No password form or no password for ${person.displayName} at ${page.url()}: set E2E_PROVIDER_LOGIN, or E2E_USER_${person.key.toUpperCase()} and E2E_PASS_${person.key.toUpperCase()}`,
        );
    }
    await username.pressSequentially(person.username, settings.typing);
    await page.getByLabel("Password").pressSequentially(person.password, settings.typing);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
};

const providerLogin = async (page: Page, person: Person): Promise<void> => {
    if (!settings.providerLogin) return passwordLogin(page, person);
    const provider = (await import(pathToFileURL(path.resolve(settings.providerLogin)).href)) as ProviderLogin;
    await provider.loginThroughProvider(page, person);
};

type Arrival = "home" | "confirm identity";

const confirmIdentityHeading = (page: Page): Locator =>
    page.getByRole("heading", { name: "Confirm your digital identity", exact: true });

export const signIn = async (session: Session): Promise<Arrival> => {
    const { page, person } = session;
    await page.goto("./", { waitUntil: "commit" });
    await page.waitForURL((url) => url.origin !== clientOrigin, { timeout: 120_000, waitUntil: "domcontentloaded" });
    const authOrigin = new URL(page.url()).origin;
    if (!isConsent(new URL(page.url()), authOrigin)) await providerLogin(page, person);
    await page.waitForURL((url) => url.origin === clientOrigin || isConsent(url, authOrigin), {
        timeout: signedInTimeout,
    });
    if (isConsent(new URL(page.url()), authOrigin)) {
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await page.waitForURL((url) => url.origin === clientOrigin, { timeout: signedInTimeout });
    }
    await expect(userMenu(page).or(confirmIdentityHeading(page))).toBeVisible({ timeout: signedInTimeout });
    return (await confirmIdentityHeading(page).isVisible()) ? "confirm identity" : "home";
};

const recoveryKeyFormat = /^[1-9A-HJ-NP-Za-km-z]{4}( [1-9A-HJ-NP-Za-km-z]{4})+$/;

export const hasRecovery = async (page: Page): Promise<boolean> => {
    const encryption = await openUserSettings(page, "Encryption");
    const create = encryption.getByRole("button", { name: "Create recovery key", exact: true });
    const change = encryption.getByRole("button", { name: "Change recovery key", exact: true });
    await expect(create.or(change)).toBeVisible({ timeout: 60_000 });
    return change.isVisible();
};

export const setUpRecovery = async (session: Session): Promise<void> => {
    const { page, person } = session;
    const encryption = dialog(page);
    const keyStorage = encryption.getByRole("switch", { name: "Allow key storage", exact: true });
    await expect(keyStorage).toBeChecked();
    await page.addStyleTag({ content: ".mx_KeyPanel_key { filter: blur(6px); }" });
    await encryption.getByRole("button", { name: "Create recovery key", exact: true }).click();
    await expect(encryption.getByText("Save your recovery key somewhere safe", { exact: true })).toBeVisible();
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await encryption.getByRole("button", { name: "Copy", exact: true }).click();
    const key = (await page.evaluate(() => navigator.clipboard.readText())).trim();
    expect(key).toMatch(recoveryKeyFormat);
    await expect(encryption.getByText(key, { exact: true })).toBeVisible();
    await encryption.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(encryption.getByText("Enter your recovery key to confirm", { exact: true })).toBeVisible();
    await encryption.getByRole("textbox").fill(key);
    await encryption.getByRole("button", { name: "Finish set up", exact: true }).click();
    await expect(page.getByText("Backup is now fully set up", { exact: true })).toBeVisible();
    await expect(encryption.getByRole("button", { name: "Change recovery key", exact: true })).toBeVisible();
    session.recoveryKey = key;
    storeKey(person, key);
    await closeDialog(page);
};

const resetRefused = (person: Person, why: string): Error =>
    new Error(
        `${person.displayName} has a digital identity already and ${why}. Start from new accounts, store the key for ${account(person)} in ${keysFile}, or set E2E_ALLOW_IDENTITY_RESET=1.`,
    );

export const confirmIdentity = async (session: Session): Promise<boolean> => {
    const { page, person } = session;
    const key = knownRecoveryKey(session);
    if (!key) throw resetRefused(person, `${keysFile} holds no recovery key of it`);
    await page.getByRole("button", { name: "Use recovery key", exact: true }).click();
    const enterKey = dialog(page);
    await expect(enterKey.getByRole("heading", { name: "Enter your recovery key", exact: true })).toBeVisible();
    await enterKey.getByPlaceholder("Recovery key", { exact: true }).fill(key);
    const proceed = enterKey.getByRole("button", { name: "Continue", exact: true });
    const wrong = enterKey.getByText("The recovery key you entered is not correct.", { exact: true });
    await expect(async () => {
        if (await wrong.isVisible()) return;
        await expect(proceed).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    if (await wrong.isVisible()) {
        if (!settings.allowIdentityReset) throw resetRefused(person, "the stored recovery key no longer fits it");
        await enterKey.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(enterKey).toBeHidden();
        return false;
    }
    await proceed.click();
    await expect(page.getByText(/^Your new device is now verified/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(userMenu(page)).toBeVisible({ timeout: signedInTimeout });
    return true;
};

export const resetIdentity = async (session: Session): Promise<void> => {
    const { page, person } = session;
    if (!settings.allowIdentityReset) throw resetRefused(person, `${keysFile} holds no recovery key of it`);
    await page.getByRole("button", { name: "Can't confirm?", exact: true }).click();
    await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
    const opened = page.waitForEvent("popup");
    await dialog(page).getByRole("button", { name: "Continue to account", exact: true }).click();
    const provider = await opened;
    await provider.getByRole("button", { name: "Finish reset", exact: true }).click();
    const done = provider.getByRole("heading", { name: /^Identity reset successfully/ });
    await expect(done).toBeVisible();
    await provider.close();
    const retry = dialog(page).getByRole("button", { name: "Retry", exact: true });
    await expect(async () => {
        if (await retry.isVisible()) await retry.click();
        await expect(userMenu(page)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: signedInTimeout });
};

export const signOut = async (session: Session): Promise<void> => {
    const { page } = session;
    const settingsDialog = await openUserSettings(page);
    await settingsDialog.getByRole("button", { name: "Remove this device", exact: true }).click();
    await page
        .getByRole("dialog")
        .filter({ has: page.getByRole("heading", { name: /remov(e|ing) this device/ }) })
        .getByRole("button", { name: /^(Remove this device|Continue to remove this device)$/ })
        .click();
    await expect(userMenu(page)).toBeHidden({ timeout: 60_000 });
};
