/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { buildUrl, fetchJson, toGifFile, toMedia, toStillUrl, toText, type UncheckedMedia } from "./provider-utils";
import type { GifPage, GifProvider, GifResult } from "./types";

const PAGE_SIZE = 24;
const RATING = "pg-13";
// Largest offsets accepted by https://developers.giphy.com/docs/api/endpoint#search and #trending
const MAX_SEARCH_OFFSET = 4999;
const MAX_TRENDING_OFFSET = 499;

/** An Images Object rendition, https://developers.giphy.com/docs/api/schema#image-object */
interface GiphyImage extends UncheckedMedia {
    size?: unknown;
}

/** A GIF Object, https://developers.giphy.com/docs/api/schema#gif-object */
interface GiphyGif {
    id?: unknown;
    title?: unknown;
    alt_text?: unknown;
    images?: {
        fixed_width_small?: GiphyImage;
        fixed_width_small_still?: GiphyImage;
        original?: GiphyImage;
    };
}

/** The response of the search and trending endpoints, https://developers.giphy.com/docs/api/endpoint */
interface GiphyListResponse {
    data?: unknown;
    /** https://developers.giphy.com/docs/api/schema#pagination-object */
    pagination?: {
        total_count?: unknown;
        count?: unknown;
    };
}

function toResult(value: unknown): GifResult | null {
    const gif = value as GiphyGif | null;
    const preview = toMedia(gif?.images?.fixed_width_small);
    const full = toMedia(gif?.images?.original);
    if (typeof gif?.id !== "string" || !gif.id || !preview || !full) return null;

    const previewStillUrl = toStillUrl(gif.images?.fixed_width_small_still?.url);
    return {
        id: gif.id,
        title: toText(gif.alt_text) || toText(gif.title),
        preview,
        ...(previewStillUrl && { previewStillUrl }),
        full: toGifFile(full, gif.images?.original?.size),
    };
}

function toCount(value: unknown): number | undefined {
    const count = Number(value);
    return Number.isInteger(count) && count >= 0 ? count : undefined;
}

/**
 * Client for the GIPHY API, https://developers.giphy.com/docs/api/endpoint
 *
 * Previews are the `fixed_width_small` rendition, with `fixed_width_small_still` as their still image, and the GIF
 * to send is the `original` rendition.
 */
export class GiphyProvider implements GifProvider {
    public readonly name = "giphy";
    public readonly attribution = "GIPHY";
    /** The API terms ask for the "Powered By GIPHY" mark, https://developers.giphy.com/docs/api/ (Attribution) */
    public readonly attributionMark = "giphy";
    /** The limit of the `q` parameter, https://developers.giphy.com/docs/api/endpoint#search */
    public readonly maxQueryLength = 50;

    /**
     * @param baseUrl - Root URL of the GIPHY API, or of a proxy in front of it.
     * @param apiKey - The GIPHY API key, or `undefined` if the proxy adds it.
     */
    public constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string | undefined,
    ) {}

    public search(query: string, cursor: string | null, signal: AbortSignal): Promise<GifPage> {
        return this.list(
            "v1/gifs/search",
            { q: query.slice(0, this.maxQueryLength) },
            cursor,
            MAX_SEARCH_OFFSET,
            signal,
        );
    }

    public trending(cursor: string | null, signal: AbortSignal): Promise<GifPage> {
        return this.list("v1/gifs/trending", {}, cursor, MAX_TRENDING_OFFSET, signal);
    }

    private async list(
        path: string,
        params: Record<string, string>,
        cursor: string | null,
        maxOffset: number,
        signal: AbortSignal,
    ): Promise<GifPage> {
        const offset = cursor === null ? 0 : Number(cursor);
        const url = buildUrl(this.baseUrl, path, {
            api_key: this.apiKey,
            ...params,
            limit: String(PAGE_SIZE),
            offset: String(offset),
            rating: RATING,
        });

        const body = (await fetchJson(url, signal)) as GiphyListResponse | null;
        const data: unknown = body?.data;
        if (!Array.isArray(data)) throw new Error("GIPHY response has no data");

        const results = data.map(toResult).filter((result) => result !== null);
        const count = toCount(body?.pagination?.count) ?? data.length;
        const total = toCount(body?.pagination?.total_count);
        const next = offset + count;
        const hasMore = count > 0 && (total === undefined ? count >= PAGE_SIZE : next < total) && next <= maxOffset;
        return { results, next: hasMore ? String(next) : null };
    }
}
