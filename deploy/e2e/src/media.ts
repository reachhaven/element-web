// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { readdirSync } from "node:fs";
import path from "node:path";

import { settings, suiteDir } from "./env";

export const generatedMediaDir = path.resolve(suiteDir, "media");

const kinds = { png: [".png"], jpeg: [".jpg", ".jpeg"], mp4: [".mp4"], gif: [".gif"] } as const;

type MediaKind = keyof typeof kinds;

type MediaFile = { path: string; name: string };

export const mediaFile = (kind: MediaKind): MediaFile => {
    const dir = settings.mediaDir ?? generatedMediaDir;
    const name = readdirSync(dir)
        .sort()
        .find((file) => (kinds[kind] as readonly string[]).includes(path.extname(file).toLowerCase()));
    if (!name) throw new Error(`No ${kind.toUpperCase()} file in ${dir}`);
    const file = path.resolve(dir, name);
    return { path: file, name: path.basename(file) };
};
