/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

/**
 * A mark that a provider's terms ask apps to credit it with, rather than a "Powered by" line.
 */
export type GifAttributionMark = "giphy";

/**
 * One rendition of a GIF, as served by the provider.
 */
export type GifMedia = {
    /** Absolute URL of the file. */
    url: string;
    /** Width in pixels. */
    width: number;
    /** Height in pixels. */
    height: number;
};

/**
 * The rendition of a GIF that gets sent.
 */
export type GifFile = GifMedia & {
    /** Size in bytes, when the provider reports it. */
    size?: number;
    /** MIME type of the file. */
    mimetype: string;
};

/**
 * A GIF found through a {@link GifProvider}.
 */
export type GifResult = {
    /** Identifier of the GIF, unique within its provider. */
    id: string;
    /** Description of the GIF, used as its alternative text and file name. May be empty. */
    title: string;
    /** Small animated rendition for the picker. */
    preview: GifMedia;
    /** URL of a still image of {@link preview}, if the provider has one. */
    previewStillUrl?: string;
    /** Full-size GIF to send. */
    full: GifFile;
};

/**
 * One page of results from a {@link GifProvider}.
 */
export interface GifPage {
    /** The GIFs on this page, in the provider's order. */
    results: GifResult[];
    /** Cursor for the following page, or `null` when there are no more results. */
    next: string | null;
}

/**
 * A GIF search service.
 */
export interface GifProvider {
    /** Stable name of the provider, used to keep the GIFs of different providers apart. */
    readonly name: string;
    /** Name to credit the provider with, as in "Powered by GIPHY". */
    readonly attribution: string;
    /** The mark to credit the provider with instead of a "Powered by" line, if its terms ask for one. */
    readonly attributionMark: GifAttributionMark | null;
    /** Longest search query the provider accepts, in characters. */
    readonly maxQueryLength: number;

    /**
     * Search for GIFs.
     *
     * @param query - The search terms. Characters beyond {@link maxQueryLength} are dropped.
     * @param cursor - `null` for the first page, otherwise {@link GifPage.next} of the previous page.
     * @param signal - Aborts the request.
     */
    search(query: string, cursor: string | null, signal: AbortSignal): Promise<GifPage>;

    /**
     * Get the GIFs that are trending.
     *
     * @param cursor - `null` for the first page, otherwise {@link GifPage.next} of the previous page.
     * @param signal - Aborts the request.
     */
    trending(cursor: string | null, signal: AbortSignal): Promise<GifPage>;
}
