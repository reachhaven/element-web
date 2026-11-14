// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { chromium, type FullConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { clientConfigFile, parseClientConfig } from "./client-config";
import { outputDir, settings, suiteDir } from "./env";
import { generatedMediaDir } from "./media";
import { saveLog } from "./steps";

const readClientConfig = async (config: FullConfig): Promise<void> => {
    const { launchOptions, ignoreHTTPSErrors } = config.projects[0]?.use ?? {};
    const browser = await chromium.launch(launchOptions);
    try {
        const page = await browser.newPage({ ignoreHTTPSErrors });
        const response = await page.goto(new URL("config.json", settings.baseUrl).href);
        if (!response?.ok()) throw new Error(`${page.url()} answered ${response?.status() ?? "nothing"}`);
        const clientConfig = parseClientConfig(await response.json());
        writeFileSync(clientConfigFile, `${JSON.stringify(clientConfig, null, 4)}\n`);
    } finally {
        await browser.close();
    }
};

export default async function globalSetup(config: FullConfig): Promise<void> {
    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    saveLog();
    mkdirSync(path.resolve(outputDir, "screenshots"));
    const generated = ["landscape.png", "photo.jpg", "clip.mp4", "animation.gif"];
    if (!settings.mediaDir && !generated.every((file) => existsSync(path.resolve(generatedMediaDir, file)))) {
        execFileSync(path.resolve(suiteDir, "media.sh"), [generatedMediaDir], { stdio: "inherit" });
    }
    await readClientConfig(config);
}
