// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { outputDir } from "./env";

export const clientConfigFile = path.resolve(outputDir, "client-config.json");

const clientConfigSchema = z.looseObject({
    gif_provider: z.looseObject({ provider: z.string() }).nullish(),
});

type ClientConfig = z.infer<typeof clientConfigSchema>;

export const parseClientConfig = (json: unknown): ClientConfig => clientConfigSchema.parse(json);

export const clientConfig = (): ClientConfig => parseClientConfig(JSON.parse(readFileSync(clientConfigFile, "utf8")));
