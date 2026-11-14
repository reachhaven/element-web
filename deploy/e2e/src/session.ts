// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import path from "node:path";

import { outputDir, settings, type Person } from "./env";
import { recording, recordingSaved } from "./steps";

export type Session = {
    person: Person;
    name: string;
    context: BrowserContext;
    page: Page;
    recoveryKey?: string;
};

const toasts: { title: string; button: string }[] = [
    { title: "Notifications", button: "Dismiss" },
    { title: "Don't miss a reply", button: "Dismiss" },
    { title: "Back up your chats", button: "Not now" },
    { title: "You have unverified devices", button: "Later" },
];

const press = async (button: Locator): Promise<void> => {
    try {
        await button.click({ timeout: 5_000 });
    } catch {
        await expect(button).toBeHidden();
    }
};

const dismissInterruptions = async (page: Page): Promise<void> => {
    for (const { title, button } of toasts) {
        const toast = page
            .getByRole("alert")
            .filter({ has: page.getByTestId("toast-buttons") })
            .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
            .first();
        await page.addLocatorHandler(toast, () => press(toast.getByRole("button", { name: button, exact: true })));
    }
    const announcement = page.getByRole("dialog").filter({ hasText: "Introducing Sections" }).first();
    await page.addLocatorHandler(announcement, () =>
        press(announcement.getByRole("button", { name: "Ok", exact: true })),
    );
};

export const openSession = async (browser: Browser, person: Person): Promise<Session> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent("<!doctype html><title>Waiting</title><body></body>");
    recording({ person: person.key, name: person.displayName, file: "", startedAt: Date.now() }, page);
    await dismissInterruptions(page);
    return { person, name: person.displayName, context, page };
};

export const closeSession = async (session: Session): Promise<void> => {
    const video = session.page.video();
    await session.context.close();
    if (!video) return;
    const file = `person-${session.person.key}.webm`;
    await video.saveAs(path.resolve(outputDir, file));
    await video.delete();
    recordingSaved(session.person.key, file);
};

export const openSessions = async (browser: Browser): Promise<[Session, Session]> => {
    const [personA, personB] = settings.people;
    const a = await openSession(browser, personA);
    const b = await openSession(browser, personB);
    return [a, b];
};

export const closeSessions = async (...sessions: (Session | undefined)[]): Promise<void> => {
    let failure: { error: unknown } | undefined;
    for (const session of sessions) {
        try {
            if (session) await closeSession(session);
        } catch (error) {
            failure ??= { error };
        }
    }
    if (failure) throw failure.error;
};
