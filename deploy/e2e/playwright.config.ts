// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

import { outputDir, settings } from "./src/env";

const viewport = { width: 1280, height: 800 };

export default defineConfig({
    testDir: "./tests",
    outputDir: path.resolve(outputDir, "test-results"),
    globalSetup: "./src/global-setup.ts",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 15 * 60_000,
    expect: { timeout: 30_000 },
    reporter: [["list"], ["html", { open: "never", outputFolder: path.resolve(outputDir, "report") }]],
    use: {
        ...devices["Desktop Chrome"],
        baseURL: settings.baseUrl,
        viewport,
        locale: "en-US",
        timezoneId: "UTC",
        ignoreHTTPSErrors: settings.ignoreHttpsErrors,
        launchOptions: { args: settings.ignoreHttpsErrors ? ["--ignore-certificate-errors"] : [] },
        permissions: ["clipboard-read", "clipboard-write"],
        actionTimeout: 30_000,
        navigationTimeout: 60_000,
        trace: "on",
        contextOptions: { recordVideo: { dir: path.resolve(outputDir, "videos"), size: viewport } },
    },
});
