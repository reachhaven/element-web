/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import fetchMock from "@fetch-mock/vitest";

import { createGifProvider } from "./createGifProvider";
import { GiphyProvider } from "./GiphyProvider";
import { KlipyProvider } from "./KlipyProvider";
import type { IConfigOptions } from "../IConfigOptions";

describe("createGifProvider", () => {
    it("should return null when no provider is configured", () => {
        expect(createGifProvider(undefined)).toBeNull();
    });

    it("should create a GIPHY provider", () => {
        const provider = createGifProvider({ provider: "giphy", base_url: "https://api.giphy.com", api_key: "k" });
        expect(provider).toBeInstanceOf(GiphyProvider);
    });

    it("should create a KLIPY provider", () => {
        const provider = createGifProvider({ provider: "klipy", base_url: "https://api.klipy.com", api_key: "k" });
        expect(provider).toBeInstanceOf(KlipyProvider);
    });

    it("should treat an empty API key as no key", async () => {
        fetchMock.get("begin:https://api.giphy.com/v1/gifs/trending", { data: [], pagination: { count: 0 } });
        const provider = createGifProvider({ provider: "giphy", base_url: "https://api.giphy.com", api_key: "" });

        await provider!.trending(null, new AbortController().signal);

        expect(new URL(fetchMock.callHistory.lastCall()!.url).searchParams.has("api_key")).toBe(false);
    });

    it.each([
        ["giphy", "/gifs", "/gifs/v1/gifs/trending", { data: [], pagination: { count: 0 } }],
        ["klipy", "/gifs/", "/gifs/api/v1/gifs/trending", { result: true, data: { data: [], has_next: false } }],
    ] as const)(
        "should resolve a base URL that is a path against the origin of the client for %s",
        async (provider, baseUrl, path, answer) => {
            // A client served below a path must not change where the path base URL points
            window.history.replaceState(null, "", "/web/#/home");
            fetchMock.get(`begin:${window.location.origin}${path}`, answer);

            await createGifProvider({ provider, base_url: baseUrl })!.trending(null, new AbortController().signal);

            const url = new URL(fetchMock.callHistory.lastCall()!.url);
            expect(url.origin + url.pathname).toBe(window.location.origin + path);
        },
    );

    it.each([
        "not a url",
        "gifs",
        "gifs/v1",
        "./gifs",
        "ftp://gifs.example.org",
        "javascript:alert(1)",
        "//gifs.example.org/giphy",
        "/\\gifs.example.org/giphy",
        "https://gifs.example.org/giphy?token=abc",
        "https://gifs.example.org/giphy?",
        "https://gifs.example.org/giphy#fragment",
        "/gifs?token=abc",
        "/gifs#fragment",
        "https://user:secret@gifs.example.org/giphy",
        "https://user@gifs.example.org/giphy",
    ])("should return null for the base URL %s", (baseUrl) => {
        expect(createGifProvider({ provider: "giphy", base_url: baseUrl })).toBeNull();
    });

    it("should return null for an unknown provider", () => {
        const config = { provider: "tenor", base_url: "https://tenor.example.org" } as unknown as NonNullable<
            IConfigOptions["gif_provider"]
        >;
        expect(createGifProvider(config)).toBeNull();
    });
});
