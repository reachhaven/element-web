/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { buildUrl, fetchJson, toGifFile, toMedia, toStillUrl, toText, type UncheckedMedia } from "./provider-utils";
import type { GifPage, GifProvider, GifResult } from "./types";

const PAGE_SIZE = 24;

/** One format of a rendition, https://docs.klipy.com/gifs-api/gifs-format-sizes */
interface KlipyMedia extends UncheckedMedia {
    size?: unknown;
}

/** One size of an item, in the formats asked for with `format_filter`. */
interface KlipyRendition {
    gif?: KlipyMedia;
    jpg?: KlipyMedia;
}

/** An item of https://docs.klipy.com/gifs-api/gifs-search-api and https://docs.klipy.com/gifs-api/gifs-trending-api */
interface KlipyItem {
    id?: unknown;
    slug?: unknown;
    title?: unknown;
    file?: {
        hd?: KlipyRendition;
        md?: KlipyRendition;
        sm?: KlipyRendition;
        xs?: KlipyRendition;
    };
}

/** The response of the search and trending endpoints. */
interface KlipyListResponse {
    result?: unknown;
    data?: {
        data?: unknown;
        has_next?: unknown;
    };
}

/** The first of the renditions which has a usable GIF. */
function firstWithGif(...renditions: Array<KlipyRendition | undefined>): KlipyRendition | undefined {
    return renditions.find((rendition) => toMedia(rendition?.gif) !== null);
}

function toId(item: KlipyItem): string {
    if (typeof item.slug === "string" && item.slug) return item.slug;
    return typeof item.id === "number" || typeof item.id === "string" ? String(item.id) : "";
}

function toResult(value: unknown): GifResult | null {
    const item = value as KlipyItem | null;
    const small = firstWithGif(item?.file?.sm, item?.file?.xs);
    const large = firstWithGif(item?.file?.hd, item?.file?.md);
    const preview = toMedia(small?.gif);
    const full = toMedia(large?.gif);
    const id = item ? toId(item) : "";
    if (!id || !preview || !full) return null;

    const previewStillUrl = toStillUrl(small?.jpg?.url);
    return {
        id,
        title: toText(item?.title),
        preview,
        ...(previewStillUrl && { previewStillUrl }),
        full: toGifFile(full, large?.gif?.size),
    };
}

/**
 * Client for the KLIPY GIF API, https://docs.klipy.com/gifs-api
 *
 * Previews are the `sm` rendition, with its `jpg` format as their still image, and the GIF to send is the `hd`
 * rendition.
 */
export class KlipyProvider implements GifProvider {
    public readonly name = "klipy";
    public readonly attribution = "KLIPY";
    /**
     * No mark: https://docs.klipy.com/attribution asks for the "Search KLIPY" placeholder and makes a
     * "Powered by KLIPY" line optional.
     */
    public readonly attributionMark = null;
    /** Longest query sent to KLIPY, a limit of this client's choosing. */
    public readonly maxQueryLength = 50;

    /**
     * @param baseUrl - Root URL of the KLIPY API, or of a proxy in front of it.
     * @param apiKey - The KLIPY app key, or `undefined` if the proxy adds it.
     */
    public constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string | undefined,
    ) {}

    public search(query: string, cursor: string | null, signal: AbortSignal): Promise<GifPage> {
        return this.list("gifs/search", { q: query.slice(0, this.maxQueryLength) }, cursor, signal);
    }

    public trending(cursor: string | null, signal: AbortSignal): Promise<GifPage> {
        return this.list("gifs/trending", {}, cursor, signal);
    }

    private async list(
        endpoint: string,
        params: Record<string, string>,
        cursor: string | null,
        signal: AbortSignal,
    ): Promise<GifPage> {
        const page = cursor === null ? 1 : Number(cursor);
        const path =
            this.apiKey === undefined ? `api/v1/${endpoint}` : `api/v1/${encodeURIComponent(this.apiKey)}/${endpoint}`;
        const url = buildUrl(this.baseUrl, path, {
            ...params,
            page: String(page),
            per_page: String(PAGE_SIZE),
            format_filter: "gif,jpg",
        });

        const body = (await fetchJson(url, signal)) as KlipyListResponse | null;
        const items: unknown = body?.data?.data;
        if (body?.result !== true || !Array.isArray(items)) throw new Error("KLIPY response has no data");

        return {
            results: items.map(toResult).filter((result) => result !== null),
            next: body.data?.has_next === true && items.length > 0 ? String(page + 1) : null,
        };
    }
}
