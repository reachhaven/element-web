/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import type { GifFile, GifMedia } from "./types";

/**
 * A rendition as it appears in a provider's answer, before it is checked.
 */
export interface UncheckedMedia {
    url?: unknown;
    width?: unknown;
    height?: unknown;
}

/**
 * Whether a string is an absolute http or https URL.
 *
 * @param value - The string to check.
 */
export function isHttpUrl(value: string): boolean {
    try {
        const { protocol } = new URL(value);
        return protocol === "https:" || protocol === "http:";
    } catch {
        return false;
    }
}

/**
 * Build the URL of an API endpoint below a base URL.
 *
 * @param baseUrl - Root URL of the API. A trailing slash is ignored.
 * @param path - Path of the endpoint relative to `baseUrl`, without a leading slash.
 * @param params - Query parameters. Parameters whose value is `undefined` are left out.
 * @returns The endpoint's URL.
 */
export function buildUrl(baseUrl: string, path: string, params: Record<string, string | undefined>): URL {
    const url = new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
    for (const [name, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(name, value);
    }
    return url;
}

/**
 * Fetch a JSON document.
 *
 * @param url - URL of the document.
 * @param signal - Aborts the request.
 * @returns The parsed document.
 * @throws Error if the request fails, the response status is not 2xx or the body is not JSON. The error leaves out
 *     the URL, which may contain an API key. An aborted request rejects with the abort's reason.
 */
export async function fetchJson(url: URL, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(url, { signal });
    } catch (error) {
        if (signal.aborted) throw error;
        // The error of a failed fetch() may name the URL
        throw new Error("GIF request failed");
    }
    if (!response.ok) throw new Error(`GIF request failed with status ${response.status}`);
    return response.json();
}

/**
 * Read a string from a provider's answer.
 *
 * @param value - The value in the answer.
 * @returns The value if it is a string, otherwise an empty string.
 */
export function toText(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/**
 * Read a rendition from a provider's answer.
 *
 * @param media - The rendition in the answer.
 * @returns The rendition, or `null` unless it has an absolute http(s) URL and a positive width and height.
 */
export function toMedia(media: UncheckedMedia | undefined): GifMedia | null {
    const width = Number(media?.width);
    const height = Number(media?.height);
    if (typeof media?.url !== "string" || !isHttpUrl(media.url) || !(width > 0) || !(height > 0)) return null;
    return { url: media.url, width, height };
}

/**
 * Read the URL of a still image from a provider's answer.
 *
 * @param url - The URL in the answer.
 * @returns The URL if it is an absolute http(s) URL, otherwise `undefined`.
 */
export function toStillUrl(url: unknown): string | undefined {
    return typeof url === "string" && isHttpUrl(url) ? url : undefined;
}

/**
 * Describe a rendition as the GIF file to send.
 *
 * @param media - The rendition.
 * @param size - The size in bytes from the provider's answer, if any.
 * @returns The file, with its size if the answer gave a positive one.
 */
export function toGifFile(media: GifMedia, size: unknown): GifFile {
    const bytes = Number(size);
    return { ...media, ...(bytes > 0 && { size: bytes }), mimetype: "image/gif" };
}
