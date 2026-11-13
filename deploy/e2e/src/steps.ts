// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

import { outputDir, settings } from "./env";

type Entry = {
    flow: string;
    title: string;
    at: number;
    end?: number;
    status: "passed" | "skipped" | "failed";
    reason?: string;
    note?: string;
    screenshots: string[];
    ariaSnapshots?: string[];
};

type Video = { person: string; name: string; file: string; startedAt: number };

type StepControl = {
    skip: (reason: string) => never;
    note: (text: string) => void;
};

const log = { title: settings.title ?? null, baseUrl: settings.baseUrl, videos: [] as Video[], steps: [] as Entry[] };
const witnesses: { person: string; page: Page }[] = [];
const crashed = new Set<Page>();
const minimumStepMs = 2000;
const skippedStepMs = 2500;

const save = (): void => writeFileSync(path.resolve(outputDir, "steps.json"), `${JSON.stringify(log, null, 2)}\n`);

const slug = (text: string): string =>
    text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);

export const recording = (video: Video, page: Page): void => {
    log.videos.push(video);
    witnesses.push({ person: video.person, page });
    page.on("crash", () => crashed.add(page));
    save();
};

export const recordingSaved = (person: string, file: string): void => {
    const video = log.videos.find((entry) => entry.person === person);
    if (video) video.file = file;
    save();
};

const pause = (ms: number): Promise<void> => setTimeout(ms);

const keepAriaSnapshots = async (entry: Entry, number: string): Promise<void> => {
    mkdirSync(path.resolve(outputDir, "aria"), { recursive: true });
    entry.ariaSnapshots = [];
    for (const { person, page } of witnesses) {
        if (crashed.has(page) || page.isClosed()) continue;
        const file = `aria/${number}-${slug(entry.title)}-${person}.yml`;
        try {
            writeFileSync(path.resolve(outputDir, file), await page.locator("body").ariaSnapshot({ timeout: 10_000 }));
            entry.ariaSnapshots.push(file);
        } catch {
            continue;
        }
    }
};

const takeScreenshots = async (entry: Entry, number: string): Promise<unknown> => {
    let failure: unknown;
    for (const { person, page } of witnesses) {
        if (crashed.has(page) || page.isClosed()) continue;
        const file = `screenshots/${number}-${slug(entry.title)}-${person}.png`;
        try {
            await page.screenshot({ path: path.resolve(outputDir, file), timeout: 15_000 });
            entry.screenshots.push(file);
        } catch (error) {
            failure ??= error;
        }
    }
    if (failure !== undefined && entry.status === "passed") {
        entry.status = "failed";
        entry.reason = failure instanceof Error ? `no screenshot: ${failure.message}` : "no screenshot";
        return failure;
    }
    return undefined;
};

export const step = <T>(title: string, body: (control: StepControl) => Promise<T>): Promise<T> =>
    test.step(title, async (info) => {
        const entry: Entry = { flow: test.info().title, title, at: Date.now(), status: "passed", screenshots: [] };
        log.steps.push(entry);
        save();
        const number = String(log.steps.length).padStart(3, "0");
        const control: StepControl = {
            skip: (reason) => {
                entry.status = "skipped";
                entry.reason = reason;
                info.skip(true, reason);
                throw new Error(reason);
            },
            note: (text) => {
                entry.note = entry.note ? `${entry.note} ${text}` : text;
                test.info().annotations.push({ type: "note", description: `${title}: ${text}` });
                save();
            },
        };
        let outcome: { value: T } | { error: unknown };
        try {
            outcome = { value: await body(control) };
        } catch (error) {
            outcome = { error };
            if (entry.status !== "skipped") {
                entry.status = "failed";
                await keepAriaSnapshots(entry, number);
            }
        }
        entry.end = Date.now();
        const screenshotError = await takeScreenshots(entry, number);
        save();
        const floor = entry.status === "skipped" ? skippedStepMs : minimumStepMs;
        await pause(Math.max(settings.pauseMs, floor - (Date.now() - entry.at)));
        if ("error" in outcome) throw outcome.error;
        if (screenshotError) throw screenshotError;
        return outcome.value;
    });
