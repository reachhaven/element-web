/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";
import fetchMock from "@fetch-mock/vitest";

import { KlipyProvider } from "./KlipyProvider";

const BASE_URL = "https://gifs.example.org/klipy";

function media(slug: string, size: string, width: number, bytes: number, format = "gif"): Record<string, unknown> {
    return { url: `https://static.example.net/${slug}/${size}.${format}`, width, height: width, size: bytes };
}

function klipyItem(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 8041071659142944,
        slug,
        title: `${slug} title`,
        file: {
            hd: { gif: media(slug, "hd", 498, 4001918) },
            md: { gif: media(slug, "md", 498, 3721260) },
            sm: { gif: media(slug, "sm", 220, 314884), jpg: media(slug, "sm", 220, 8560, "jpg") },
            xs: { gif: media(slug, "xs", 90, 71468) },
        },
        tags: [],
        type: "gif",
        ...overrides,
    };
}

function listResponse(slugs: string[], page: number, hasNext: boolean): Record<string, unknown> {
    return {
        result: true,
        data: { data: slugs.map((slug) => klipyItem(slug)), current_page: page, per_page: 24, has_next: hasNext },
    };
}

function lastRequestUrl(): URL {
    return new URL(fetchMock.callHistory.lastCall()!.url);
}

describe("KlipyProvider", () => {
    it("should request trending GIFs with the app key in the path", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/trending`, listResponse(["hello"], 1, false));
        const provider = new KlipyProvider(BASE_URL, "app-key");

        await provider.trending(null, new AbortController().signal);

        const url = lastRequestUrl();
        expect(`${url.origin}${url.pathname}`).toBe(`${BASE_URL}/api/v1/app-key/gifs/trending`);
        expect(Object.fromEntries(url.searchParams)).toEqual({ page: "1", per_page: "24", format_filter: "gif,jpg" });
    });

    it("should map the sm preview and the hd GIF", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/trending`, listResponse(["hello-hi-662"], 1, false));
        const provider = new KlipyProvider(BASE_URL, "app-key");

        const page = await provider.trending(null, new AbortController().signal);

        expect(page.results).toEqual([
            {
                id: "hello-hi-662",
                title: "hello-hi-662 title",
                preview: { url: "https://static.example.net/hello-hi-662/sm.gif", width: 220, height: 220 },
                previewStillUrl: "https://static.example.net/hello-hi-662/sm.jpg",
                full: {
                    url: "https://static.example.net/hello-hi-662/hd.gif",
                    width: 498,
                    height: 498,
                    size: 4001918,
                    mimetype: "image/gif",
                },
            },
        ]);
    });

    it("should fall back to the xs preview and the md GIF, and to the numeric id", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/trending`, {
            result: true,
            data: {
                data: [
                    klipyItem("", {
                        id: 42,
                        file: { md: { gif: media("x", "md", 498, 1000) }, xs: { gif: media("x", "xs", 90, 10) } },
                    }),
                ],
                has_next: false,
            },
        });
        const provider = new KlipyProvider(BASE_URL, "app-key");

        const [result] = (await provider.trending(null, new AbortController().signal)).results;

        expect(result.id).toBe("42");
        expect(result.preview.url).toBe("https://static.example.net/x/xs.gif");
        expect(result.previewStillUrl).toBeUndefined();
        expect(result.full.url).toBe("https://static.example.net/x/md.gif");
    });

    it("should only accept items with absolute http(s) URLs and a usable id", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/trending`, {
            result: true,
            data: {
                data: [
                    null,
                    klipyItem("", { id: { not: "an id" } }),
                    klipyItem("relative", {
                        file: {
                            hd: { gif: { url: "/hd.gif", width: 498, height: 498 } },
                            sm: { gif: { url: "/sm.gif", width: 220, height: 220 } },
                        },
                    }),
                    klipyItem("good", { title: 7 }),
                ],
                has_next: false,
            },
        });
        const provider = new KlipyProvider(BASE_URL, "app-key");

        const page = await provider.trending(null, new AbortController().signal);

        expect(page.results.map(({ id, title }) => ({ id, title }))).toEqual([{ id: "good", title: "" }]);
    });

    it("should not offer another page after an empty one", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/search`, listResponse([], 3, true));
        const provider = new KlipyProvider(BASE_URL, "app-key");

        const page = await provider.search("cats", "3", new AbortController().signal);

        expect(page).toEqual({ results: [], next: null });
    });

    it("should skip items without GIF renditions", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/trending`, {
            result: true,
            data: {
                data: [
                    { id: 1, type: "ad", content: "<div></div>" },
                    klipyItem("no-full", { file: { sm: { gif: media("n", "sm", 220, 10) } } }),
                    klipyItem("good"),
                ],
                has_next: false,
            },
        });
        const provider = new KlipyProvider(BASE_URL, "app-key");

        const page = await provider.trending(null, new AbortController().signal);

        expect(page.results.map((result) => result.id)).toEqual(["good"]);
    });

    it("should search for the query capped at 50 characters", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/search`, listResponse(["cat"], 1, false));
        const provider = new KlipyProvider(BASE_URL, "app-key");

        await provider.search("y".repeat(80), null, new AbortController().signal);

        expect(lastRequestUrl().searchParams.get("q")).toBe("y".repeat(50));
        expect(provider.maxQueryLength).toBe(50);
    });

    it("should page through the results", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/search`, listResponse(["a", "b"], 1, true), {
            query: { page: "1" },
        });
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/search`, listResponse(["c"], 2, false), {
            query: { page: "2" },
        });
        const provider = new KlipyProvider(BASE_URL, "app-key");
        const signal = new AbortController().signal;

        const first = await provider.search("cats", null, signal);
        expect(first.next).toBe("2");

        const second = await provider.search("cats", first.next, signal);
        expect(lastRequestUrl().searchParams.get("page")).toBe("2");
        expect(second.results.map((result) => result.id)).toEqual(["c"]);
        expect(second.next).toBeNull();
    });

    it("should leave the app key out of the path when none is configured", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/gifs/search`, listResponse(["cat"], 1, false));
        const provider = new KlipyProvider(BASE_URL, undefined);

        await provider.search("cat", null, new AbortController().signal);

        expect(lastRequestUrl().pathname).toBe("/klipy/api/v1/gifs/search");
    });

    it("should contact no host other than the base URL", async () => {
        fetchMock.get(`begin:${BASE_URL}/`, listResponse(["a", "b"], 1, true));
        const provider = new KlipyProvider(BASE_URL, "app-key");
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
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/trending`, 401);
        const provider = new KlipyProvider(BASE_URL, "app-key");

        const error = await provider.trending(null, new AbortController().signal).catch((e: Error) => e);

        expect((error as Error).message).toContain("401");
        expect((error as Error).message).not.toContain("app-key");
    });

    it("should reject when the response reports no result", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/trending`, { result: false });
        const provider = new KlipyProvider(BASE_URL, "app-key");

        await expect(provider.trending(null, new AbortController().signal)).rejects.toThrow("no data");
    });

    it("should pass the abort signal to the request", async () => {
        fetchMock.get(`begin:${BASE_URL}/api/v1/app-key/gifs/trending`, listResponse(["a"], 1, false), {
            delay: 1000,
        });
        const provider = new KlipyProvider(BASE_URL, "app-key");
        const controller = new AbortController();

        const promise = provider.trending(null, controller.signal);
        controller.abort();

        await expect(promise).rejects.toThrow();
        expect(fetchMock.callHistory.lastCall()!.signal).toBe(controller.signal);
    });
});
