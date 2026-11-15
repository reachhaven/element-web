/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import SettingsStore from "../settings/SettingsStore";
import { SettingLevel } from "../settings/SettingLevel";
import type { GifMedia, GifResult } from "./types";

const SETTING_NAME = "recent_gifs";
const LIMIT = 24;

/**
 * A GIF sent from this device, as kept in the `recent_gifs` setting.
 */
export type RecentGif = GifResult & {
    /** {@link GifProvider.name} of the provider the GIF came from. */
    provider: string;
};

function isMedia(value: unknown): value is GifMedia {
    const media = value as Partial<GifMedia> | null;
    return typeof media?.url === "string" && typeof media.width === "number" && typeof media.height === "number";
}

function isRecentGif(value: unknown): value is RecentGif {
    const gif = value as Partial<RecentGif> | null;
    return (
        typeof gif?.provider === "string" &&
        typeof gif.id === "string" &&
        typeof gif.title === "string" &&
        isMedia(gif.preview) &&
        (gif.previewStillUrl === undefined || typeof gif.previewStillUrl === "string") &&
        isMedia(gif.full) &&
        typeof gif.full.mimetype === "string"
    );
}

function getStoredGifs(): RecentGif[] {
    const stored: unknown = SettingsStore.getValue(SETTING_NAME);
    return Array.isArray(stored) ? stored.filter(isRecentGif) : [];
}

/**
 * Get the GIFs recently sent from this device through a provider.
 *
 * @param provider - {@link GifProvider.name} of the provider.
 * @returns The GIFs, most recently sent first.
 */
export function getRecentGifs(provider: string): GifResult[] {
    return getStoredGifs().filter((gif) => gif.provider === provider);
}

/**
 * Remember that a GIF was sent from this device. The 24 most recently sent GIFs are kept.
 *
 * @param provider - {@link GifProvider.name} of the provider the GIF came from.
 * @param gif - The GIF that was sent.
 */
export function addRecentGif(provider: string, gif: GifResult): void {
    const others = getStoredGifs().filter((recent) => recent.provider !== provider || recent.id !== gif.id);
    const recentGif: RecentGif = { ...gif, provider };
    void SettingsStore.setValue(SETTING_NAME, null, SettingLevel.DEVICE, [recentGif, ...others].slice(0, LIMIT));
}
