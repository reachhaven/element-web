/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
    GifPickerView,
    type GifPickerViewActions,
    type GifPickerViewItem,
    type GifPickerViewSnapshot,
} from "./GifPickerView";
import { useMockedViewModel } from "../../../core/viewmodel";
import { withViewDocs } from "../../../../.storybook/withViewDocs";
import tallImage from "../../../../static/tallImage.png";
import wideImage from "../../../../static/wideImage.png";
import squareImage from "../../../../static/image-body/install-spinner.png";

const sizes = [
    { previewUrl: tallImage, width: 220, height: 275 },
    { previewUrl: wideImage, width: 500, height: 333 },
    { previewUrl: squareImage, width: 320, height: 320 },
];

function makeItems(count: number, prefix: string): GifPickerViewItem[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `${prefix}${i}`,
        title: `${prefix} ${i}`,
        ...sizes[i % sizes.length],
    }));
}

type GifPickerViewProps = GifPickerViewSnapshot & GifPickerViewActions;

const GifPickerViewWrapperImpl = ({
    setQuery,
    selectCategory,
    loadMore,
    retry,
    sendGif,
    ...rest
}: GifPickerViewProps): JSX.Element => {
    const vm = useMockedViewModel(rest, { setQuery, selectCategory, loadMore, retry, sendGif });
    return <GifPickerView vm={vm} />;
};
const GifPickerViewWrapper = withViewDocs(GifPickerViewWrapperImpl, GifPickerView);

const meta = {
    title: "Room/Composer/GifPickerView",
    component: GifPickerViewWrapper,
    tags: ["autodocs"],
    args: {
        providerName: "GIPHY",
        attributionMark: "giphy",
        query: "",
        maxQueryLength: 50,
        categories: ["celebrate", "love", "thumbs_up", "surprised", "excited", "sad", "angry"],
        selectedCategory: null,
        autoplay: true,
        recent: [],
        section: "trending",
        items: makeItems(8, "Trending"),
        status: "ready",
        hasMore: false,
        loadingMore: false,
        loadMoreFailed: false,
        sendingId: null,
        sendFailed: false,
        setQuery: fn(),
        selectCategory: fn(),
        loadMore: fn(),
        retry: fn(),
        sendGif: fn(),
    },
} satisfies Meta<typeof GifPickerViewWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithRecent: Story = {
    args: {
        recent: makeItems(5, "Recent"),
    },
};

export const SearchResults: Story = {
    args: {
        query: "cats",
        section: "search",
        items: makeItems(6, "Cat"),
    },
};

export const Category: Story = {
    args: {
        selectedCategory: "celebrate",
        section: "category",
        items: makeItems(6, "Party"),
    },
};

export const Loading: Story = {
    args: {
        status: "loading",
        items: [],
    },
};

// Two low GIFs, so that the end of the list, where more GIFs load, is in view
const shortList = makeItems(3, "Trending").slice(1);

export const LoadingMore: Story = {
    args: {
        items: shortList,
        hasMore: true,
        loadingMore: true,
    },
};

export const Empty: Story = {
    args: {
        query: "zzzzzz",
        section: "search",
        items: [],
    },
};

export const LoadFailed: Story = {
    args: {
        status: "error",
        items: [],
    },
};

export const LoadMoreFailed: Story = {
    args: {
        items: shortList,
        hasMore: true,
        loadMoreFailed: true,
    },
};

export const Sending: Story = {
    args: {
        sendingId: "Trending1",
    },
};

export const SendFailed: Story = {
    args: {
        sendFailed: true,
    },
};

export const Klipy: Story = {
    args: {
        providerName: "KLIPY",
        attributionMark: null,
    },
};
