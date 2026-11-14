/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import SdkConfig, { DEFAULTS } from "./SdkConfig.ts";

const ELEMENT_BRAND = "Element";

/**
 * Returns whether the app is currently branded.
 * This is currently a naive check of whether the `brand` config starts with the substring `Element ` or is the literal `Element`,
 * which correctly covers `Element` (release), `Element Nightly` & `Element Pro`.
 */
export const isElementBranded = (): boolean => {
    const brand = SdkConfig.get("brand");
    return brand === ELEMENT_BRAND || brand.startsWith(ELEMENT_BRAND + " ");
};

/**
 * Returns the brand name of the app, from the `brand` config.
 * This is safe to call before the config has loaded, such as on the error pages shown while the app starts, in which
 * case it returns the default brand.
 */
export const getBrand = (): string => SdkConfig.get().brand ?? DEFAULTS.brand;
