/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";
import fetchMock from "@fetch-mock/vitest";

import { GiphyProvider } from "./GiphyProvider";

const BASE_URL = "https://gifs.example.org/giphy";

function giphyGif(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: "gif",
        id,
        title: `${id} GIF by someone`,
        alt_text: "",
        images: {
            fixed_width_small: { url: `https://media.example.net/${id}/100w.gif`, width: "100", height: "75" },
            fixed_width_small_still: {
                url: `https://media.example.net/${id}/100w_s.gif`,
                width: "100",
                height: "75",
            },
            original: {
                url: `https://media.example.net/${id}/giphy.gif`,
                width: "480",
                height: "360",
                size: "123456",
            },
        },
        ...overrides,
    };
}

function listResponse(ids: string[], offset: number, totalCount?: number): Record<string, unknown> {
    return {
        data: ids.map((id) => giphyGif(id)),
        pagination: { total_count: totalCount, count: ids.length, offset },
        meta: { status: 200, msg: "OK" },
    };
}

function ids(count: number, from = 0): string[] {
    return Array.from({ length: count }, (_, i) => `gif${from + i}`);
}

function lastRequestUrl(): URL {
    return new URL(fetchMock.callHistory.lastCall()!.url);
}

describe("GiphyProvider", () => {
    it("should request trending GIFs with the key, page size, offset and rating", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, listResponse(ids(2), 0, 2));
        const provider = new GiphyProvider(BASE_URL, "secret-key");

        await provider.trending(null, new AbortController().signal);

        const url = lastRequestUrl();
        expect(`${url.origin}${url.pathname}`).toBe(`${BASE_URL}/v1/gifs/trending`);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            api_key: "secret-key",
            limit: "24",
            offset: "0",
            rating: "pg-13",
        });
    });

    it("should map the small preview and the original rendition", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, {
            data: [giphyGif("abc", { alt_text: "A cat waving" }), giphyGif("def")],
            pagination: { total_count: 2, count: 2, offset: 0 },
        });
        const provider = new GiphyProvider(BASE_URL, "secret-key");

        const page = await provider.trending(null, new AbortController().signal);

        expect(page.results).toEqual([
            {
                id: "abc",
                title: "A cat waving",
                preview: { url: "https://media.example.net/abc/100w.gif", width: 100, height: 75 },
                previewStillUrl: "https://media.example.net/abc/100w_s.gif",
                full: {
                    url: "https://media.example.net/abc/giphy.gif",
                    width: 480,
                    height: 360,
                    size: 123456,
                    mimetype: "image/gif",
                },
            },
            expect.objectContaining({ id: "def", title: "def GIF by someone" }),
        ]);
    });

    it("should skip GIFs which lack a usable rendition", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, {
            data: [
                giphyGif("no-preview", { images: { original: { url: "https://media.example.net/o.gif" } } }),
                giphyGif("no-size", {
                    images: {
                        fixed_width_small: { url: "https://media.example.net/p.gif", width: "0", height: "75" },
                        original: { url: "https://media.example.net/o.gif", width: "480", height: "360" },
                    },
                }),
                giphyGif("good"),
            ],
            pagination: { total_count: 3, count: 3, offset: 0 },
        });
        const provider = new GiphyProvider(BASE_URL, "secret-key");

        const page = await provider.trending(null, new AbortController().signal);

        expect(page.results.map((result) => result.id)).toEqual(["good"]);
    });

    it("should only accept well-formed GIFs with absolute http(s) URLs", async () => {
        const images = (url: string): Record<string, unknown> => ({
            fixed_width_small: { url, width: "100", height: "75" },
            original: { url, width: "480", height: "360" },
        });
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, {
            data: [
                null,
                "junk",
                giphyGif("relative", { images: images("/media/relative.gif") }),
                giphyGif("javascript", { images: images("javascript:alert(1)") }),
                { ...giphyGif("x"), id: 42 },
                giphyGif("no-still", {
                    images: { ...images("https://media.example.net/ok.gif"), fixed_width_small_still: { url: "/s" } },
                    title: ["not", "a", "string"],
                }),
            ],
            pagination: { total_count: "6", count: "6", offset: 0 },
        });
        const provider = new GiphyProvider(BASE_URL, "secret-key");

        const page = await provider.trending(null, new AbortController().signal);

        expect(page.results).toEqual([
            {
                id: "no-still",
                title: "",
                preview: { url: "https://media.example.net/ok.gif", width: 100, height: 75 },
                full: { url: "https://media.example.net/ok.gif", width: 480, height: 360, mimetype: "image/gif" },
            },
        ]);
        expect(page.next).toBeNull();
    });

    it("should search for the query capped at 50 characters", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/search`, listResponse(ids(1), 0, 1));
        const provider = new GiphyProvider(BASE_URL, "secret-key");

        await provider.search("x".repeat(60), null, new AbortController().signal);

        const url = lastRequestUrl();
        expect(url.pathname).toBe("/giphy/v1/gifs/search");
        expect(url.searchParams.get("q")).toBe("x".repeat(50));
        expect(provider.maxQueryLength).toBe(50);
    });

    it("should page through the results by offset", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/search`, listResponse(ids(24), 0, 30), {
            query: { offset: "0" },
        });
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/search`, listResponse(ids(6, 24), 24, 30), {
            query: { offset: "24" },
        });
        const provider = new GiphyProvider(BASE_URL, "secret-key");
        const signal = new AbortController().signal;

        const first = await provider.search("cats", null, signal);
        expect(first.next).toBe("24");

        const second = await provider.search("cats", first.next, signal);
        expect(lastRequestUrl().searchParams.get("offset")).toBe("24");
        expect(second.results.map((result) => result.id)).toEqual(ids(6, 24));
        expect(second.next).toBeNull();
    });

    it("should read a count given as a string", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, {
            data: ids(24).map((id) => giphyGif(id)),
            pagination: { total_count: "48", count: "24", offset: "0" },
        });
        const provider = new GiphyProvider(BASE_URL, "secret-key");

        const page = await provider.trending(null, new AbortController().signal);

        expect(page.next).toBe("24");
    });

    it("should treat a full page as having more when the total count is missing", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, listResponse(ids(24), 0), { query: { offset: "0" } });
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, listResponse(ids(10, 24), 24), { query: { offset: "24" } });
        const provider = new GiphyProvider(BASE_URL, "secret-key");
        const signal = new AbortController().signal;

        const first = await provider.trending(null, signal);
        const second = await provider.trending(first.next, signal);

        expect(first.next).toBe("24");
        expect(second.next).toBeNull();
    });

    it("should stop paging at the largest offset the endpoint accepts", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, listResponse(ids(24, 480), 480, 1000));
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/search`, listResponse(ids(24, 4980), 4980, 10000));
        const provider = new GiphyProvider(BASE_URL, "secret-key");
        const signal = new AbortController().signal;

        expect((await provider.trending("480", signal)).next).toBeNull();
        expect((await provider.search("cats", "4980", signal)).next).toBeNull();
    });

    it("should leave the key out when none is configured", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, listResponse(ids(1), 0, 1));
        const provider = new GiphyProvider(BASE_URL, undefined);

        await provider.trending(null, new AbortController().signal);

        expect(lastRequestUrl().searchParams.has("api_key")).toBe(false);
    });

    it("should ignore a trailing slash on the base URL", async () => {
        fetchMock.get("begin:https://api.giphy.com/v1/gifs/trending", listResponse(ids(1), 0, 1));
        const provider = new GiphyProvider("https://api.giphy.com/", "secret-key");

        await provider.trending(null, new AbortController().signal);

        expect(lastRequestUrl().pathname).toBe("/v1/gifs/trending");
    });

    it("should contact no host other than the base URL", async () => {
        fetchMock.get(`begin:${BASE_URL}/`, listResponse(ids(24), 0, 100));
        const provider = new GiphyProvider(BASE_URL, "secret-key");
        const signal = new AbortController().signal;

        const page = await provider.trending(null, signal);
        await provider.trending(page.next, signal);
        await provider.search("cats", null, signal);

        const calls = fetchMock.callHistory.calls();
        expect(calls).toHaveLength(3);
        for (const call of calls) {
            expect(call.url.startsWith(`${BASE_URL}/`)).toBe(true);
        }
    });

    it("should reject when the request fails, without the key in the error", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, 429);
        const provider = new GiphyProvider(BASE_URL, "secret-key");

        const error = await provider.trending(null, new AbortController().signal).catch((e: Error) => e);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("429");
        expect((error as Error).message).not.toContain("secret-key");
    });

    it("should reject when the request cannot be made, without the URL in the error", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, {
            throws: new TypeError(`Failed to fetch ${BASE_URL}/v1/gifs/trending?api_key=secret-key`),
        });
        const provider = new GiphyProvider(BASE_URL, "secret-key");

        const error = await provider.trending(null, new AbortController().signal).catch((e: Error) => e);

        expect(error).toEqual(new Error("GIF request failed"));
    });

    it("should reject when the response has no data", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, { meta: { status: 200 } });
        const provider = new GiphyProvider(BASE_URL, "secret-key");

        await expect(provider.trending(null, new AbortController().signal)).rejects.toThrow("no data");
    });

    it("should pass the abort signal to the request", async () => {
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, listResponse(ids(1), 0, 1), { delay: 1000 });
        const provider = new GiphyProvider(BASE_URL, "secret-key");
        const controller = new AbortController();

        const promise = provider.trending(null, controller.signal);
        controller.abort();

        await expect(promise).rejects.toThrow();
        expect(fetchMock.callHistory.lastCall()!.signal).toBe(controller.signal);
    });
});
