/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

import type { IConfigOptions } from "../IConfigOptions";
import { GiphyProvider } from "./GiphyProvider";
import { KlipyProvider } from "./KlipyProvider";
import { isHttpUrl } from "./provider-utils";
import type { GifProvider } from "./types";

/**
 * Resolve the `base_url` of the `gif_provider` config option.
 *
 * @param value - An absolute http(s) URL, or a path on the client's own origin such as `/gifs`.
 * @returns The absolute URL, or `null` if the value is neither, or has a query, a fragment or credentials.
 */
function resolveBaseUrl(value: unknown): string | null {
    // The endpoint paths are appended to the base URL, so it cannot carry a query or a fragment
    if (typeof value !== "string" || /[?#]/.test(value)) return null;

    let url: URL;
    if (value.startsWith("/")) {
        const { origin } = window.location;
        try {
            url = new URL(value, origin);
        } catch {
            return null;
        }
        // "//host/path" and "/\host/path" are URLs on another host, not paths on this one
        if (url.origin !== origin) return null;
    } else if (isHttpUrl(value)) {
        url = new URL(value);
    } else {
        return null;
    }
    // fetch() refuses URLs with credentials, with an error that shows the URL and so the API key
    if (!isHttpUrl(url.href) || url.username || url.password) return null;
    return url.href;
}

/**
 * Create the GIF provider that the `gif_provider` config option describes.
 *
 * @param config - The value of the `gif_provider` config option.
 * @returns The provider, or `null` if the option is not set or not valid.
 */
export function createGifProvider(config: IConfigOptions["gif_provider"]): GifProvider | null {
    if (!config) return null;
    const baseUrl = resolveBaseUrl(config.base_url);
    if (!baseUrl) {
        logger.warn(
            "Ignoring gif_provider: base_url is neither an http(s) URL nor a path, or has a query, fragment or credentials",
        );
        return null;
    }

    const apiKey = config.api_key || undefined;
    switch (config.provider) {
        case "giphy":
            return new GiphyProvider(baseUrl, apiKey);
        case "klipy":
            return new KlipyProvider(baseUrl, apiKey);
    }
    logger.warn(`Ignoring gif_provider: unknown provider ${String(config.provider)}`);
    return null;
}
