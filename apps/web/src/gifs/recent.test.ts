/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import SettingsStore from "../settings/SettingsStore";
import { SettingLevel } from "../settings/SettingLevel";
import { addRecentGif, getRecentGifs, type RecentGif } from "./recent";
import type { GifResult } from "./types";

function gif(id: string): GifResult {
    return {
        id,
        title: `${id} title`,
        preview: { url: `https://media.example.net/${id}/small.gif`, width: 100, height: 80 },
        full: { url: `https://media.example.net/${id}/full.gif`, width: 400, height: 320, mimetype: "image/gif" },
    };
}

describe("recent GIFs", () => {
    let stored: unknown;

    beforeEach(() => {
        stored = [];
        vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string) =>
            name === "recent_gifs" ? stored : undefined) as typeof SettingsStore.getValue);
        vi.spyOn(SettingsStore, "setValue").mockImplementation(async (name, roomId, level, value) => {
            stored = value;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have no recent GIFs at first", () => {
        expect(getRecentGifs("giphy")).toEqual([]);
    });

    it("should keep the most recently sent GIF first, without duplicates", () => {
        addRecentGif("giphy", gif("a"));
        addRecentGif("giphy", gif("b"));
        addRecentGif("giphy", gif("a"));

        expect(getRecentGifs("giphy").map(({ id }) => id)).toEqual(["a", "b"]);
        expect(SettingsStore.setValue).toHaveBeenLastCalledWith(
            "recent_gifs",
            null,
            SettingLevel.DEVICE,
            expect.any(Array),
        );
    });

    it("should keep at most 24 GIFs", () => {
        for (let i = 0; i < 30; i++) addRecentGif("giphy", gif(`gif${i}`));

        const recent = getRecentGifs("giphy");
        expect(recent).toHaveLength(24);
        expect(recent[0].id).toBe("gif29");
        expect(recent[23].id).toBe("gif6");
    });

    it("should keep the GIFs of each provider apart", () => {
        addRecentGif("giphy", gif("same-id"));
        addRecentGif("klipy", gif("same-id"));
        addRecentGif("klipy", gif("other"));

        expect(getRecentGifs("giphy").map(({ id }) => id)).toEqual(["same-id"]);
        expect(getRecentGifs("klipy").map(({ id }) => id)).toEqual(["other", "same-id"]);
    });

    it("should ignore stored values that are not recent GIFs", () => {
        const good: RecentGif = { ...gif("good"), provider: "giphy" };
        const withStill: RecentGif = {
            ...gif("still"),
            previewStillUrl: "https://media.example.net/s.gif",
            provider: "giphy",
        };
        stored = [
            null,
            "junk",
            { id: "no-media", provider: "giphy" },
            { ...gif("bad-still"), previewStillUrl: 7, provider: "giphy" },
            good,
            withStill,
        ];
        expect(getRecentGifs("giphy")).toEqual([good, withStill]);

        stored = { not: "an array" };
        expect(getRecentGifs("giphy")).toEqual([]);
    });
});
