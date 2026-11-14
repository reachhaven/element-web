/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { act, render, screen, waitFor } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import userEvent from "@testing-library/user-event";
import { describe, it, vi, expect } from "vitest";

import * as stories from "./GifPickerView.stories";
import {
    GifPickerView,
    type GifPickerViewActions,
    type GifPickerViewItem,
    type GifPickerViewSnapshot,
} from "./GifPickerView";
import { MockViewModel } from "../../../core/viewmodel/MockViewModel";

const { Default, WithRecent, Loading, Empty, LoadFailed } = composeStories(stories);

class TestViewModel extends MockViewModel<GifPickerViewSnapshot> implements GifPickerViewActions {
    public setQuery = vi.fn();
    public selectCategory = vi.fn();
    public loadMore = vi.fn();
    public retry = vi.fn();
    public sendGif = vi.fn();
}

function makeItems(heights: number[]): GifPickerViewItem[] {
    return heights.map((height, i) => ({
        id: `gif${i}`,
        title: `GIF ${i}`,
        previewUrl: `data:image/gif;base64,R0lGODlhAQABAAAAACw=`,
        width: 100,
        height,
    }));
}

function makeSnapshot(overrides: Partial<GifPickerViewSnapshot> = {}): GifPickerViewSnapshot {
    return {
        providerName: "GIPHY",
        attributionMark: "giphy",
        query: "",
        maxQueryLength: 50,
        categories: ["celebrate", "love", "thumbs_up", "surprised", "excited", "sad", "angry"],
        selectedCategory: null,
        autoplay: true,
        recent: [],
        section: "trending",
        items: makeItems([125, 67, 100, 125, 67, 100, 125, 67]),
        status: "ready",
        hasMore: false,
        loadingMore: false,
        loadMoreFailed: false,
        sendingId: null,
        sendFailed: false,
        ...overrides,
    };
}

function renderView(overrides: Partial<GifPickerViewSnapshot> = {}, dir?: "rtl"): TestViewModel {
    const vm = new TestViewModel(makeSnapshot(overrides));
    render(
        <div dir={dir}>
            <GifPickerView vm={vm} />
        </div>,
    );
    return vm;
}

function imageOf(name: string): string | null {
    return screen.getByRole("button", { name }).querySelector("img")!.getAttribute("src");
}

describe("GifPickerView", () => {
    describe("Storybook snapshots", () => {
        it.each([
            ["the trending GIFs", Default],
            ["the recent GIFs", WithRecent],
            ["loading", Loading],
            ["no results", Empty],
            ["a failure to load", LoadFailed],
        ])("renders %s", (_name, Story) => {
            const { container } = render(<Story />);
            expect(container).toMatchSnapshot();
        });
    });

    it("should credit the provider and name it in the search field", () => {
        renderView({ providerName: "KLIPY", attributionMark: null });

        expect(screen.getByText("Powered by KLIPY")).toBeInTheDocument();
        expect(screen.queryByRole("img", { name: "Powered by KLIPY" })).not.toBeInTheDocument();
        expect(screen.getByRole("searchbox", { name: "Search GIFs" })).toHaveAttribute("placeholder", "Search KLIPY");
    });

    it("should credit the provider with its attribution mark when it has one", () => {
        renderView({ providerName: "GIPHY", attributionMark: "giphy" });

        const mark = screen.getByRole("img", { name: "Powered by GIPHY" });
        expect(mark.getAttribute("src")).toMatch(/powered-by-giphy\.svg|^data:image\/svg\+xml/);
        expect(screen.queryByText("Powered by GIPHY")).not.toBeInTheDocument();
        expect(screen.getByRole("searchbox", { name: "Search GIFs" })).toHaveAttribute("placeholder", "Search GIPHY");
    });

    it("should focus the search field, which takes no more than the longest query", () => {
        renderView();

        const search = screen.getByRole("searchbox", { name: "Search GIFs" });
        expect(search).toHaveFocus();
        expect(search).toHaveAttribute("maxlength", "50");
        expect(search).toHaveAttribute("tabindex", "0");
    });

    it("should show still previews until a GIF is hovered or focused", async () => {
        const still = "data:image/png;base64,c3RpbGw=";
        const [item] = makeItems([100]);
        renderView({ autoplay: false, items: [{ ...item, stillUrl: still }] });
        expect(imageOf("GIF 0")).toBe(still);

        await userEvent.hover(screen.getByRole("button", { name: "GIF 0" }));
        expect(imageOf("GIF 0")).toBe(item.previewUrl);

        await userEvent.unhover(screen.getByRole("button", { name: "GIF 0" }));
        expect(imageOf("GIF 0")).toBe(still);

        act(() => screen.getByRole("button", { name: "GIF 0" }).focus());
        expect(imageOf("GIF 0")).toBe(item.previewUrl);
    });

    it("should play previews when GIFs play automatically or there is no still image", () => {
        const [first, second] = makeItems([100, 100]);
        renderView({ autoplay: true, items: [{ ...first, stillUrl: "data:image/png;base64,c3RpbGw=" }] });
        expect(imageOf("GIF 0")).toBe(first.previewUrl);

        renderView({ autoplay: false, items: [{ ...second, title: "No still" }] });
        expect(imageOf("No still")).toBe(second.previewUrl);
    });

    it("should set the query as the person types", async () => {
        const vm = renderView();

        await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "c");

        expect(vm.setQuery).toHaveBeenCalledWith("c");
    });

    it("should select a category", async () => {
        const vm = renderView({ selectedCategory: "love", section: "category" });

        expect(screen.getByRole("option", { name: "Love" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("heading", { name: "Love" })).toBeInTheDocument();

        await userEvent.click(screen.getByRole("option", { name: "Thumbs up" }));
        expect(vm.selectCategory).toHaveBeenCalledWith("thumbs_up");
    });

    it("should send the chosen GIF", async () => {
        const vm = renderView({ recent: makeItems([100]).map((item) => ({ ...item, id: "recent0" })) });

        await userEvent.click(screen.getByRole("button", { name: "GIF 2" }));
        expect(vm.sendGif).toHaveBeenCalledWith("gif2");

        await userEvent.click(screen.getAllByRole("button", { name: "GIF 0" })[0]);
        expect(vm.sendGif).toHaveBeenCalledWith("recent0");
    });

    it("should name a GIF without a title", () => {
        renderView({ items: [{ ...makeItems([100])[0], title: "" }] });

        expect(screen.getByRole("button", { name: "GIF" })).toBeInTheDocument();
    });

    it("should show the recent GIFs with the trending GIFs only", () => {
        const recent = makeItems([100, 100]).map((item) => ({ ...item, id: `recent-${item.id}` }));
        renderView({ recent });
        expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Trending" })).toBeInTheDocument();
    });

    it("should hide the recent GIFs while searching", () => {
        const recent = makeItems([100]).map((item) => ({ ...item, id: "recent0" }));
        renderView({ recent, query: "cats", section: "search" });

        expect(screen.queryByRole("heading", { name: "Recent" })).not.toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    });

    it("should show that GIFs are loading", () => {
        renderView({ status: "loading", items: [] });

        expect(screen.getByRole("progressbar", { name: "Loading GIFs" })).toBeInTheDocument();
    });

    it("should say when no GIFs were found", () => {
        renderView({ items: [], section: "search", query: "zzz" });

        expect(screen.getAllByText("No GIFs found.")).toHaveLength(2);
        expect(screen.getByRole("status")).toHaveTextContent("No GIFs found.");
    });

    it("should not say that no GIFs were found while more can be loaded", () => {
        renderView({ items: [], hasMore: true });

        expect(screen.queryByText("No GIFs found.")).not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("");
    });

    it("should offer to try again when loading fails", async () => {
        const vm = renderView({ status: "error", items: [] });

        expect(screen.getByRole("status")).toHaveTextContent("Couldn't load GIFs.");
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(vm.retry).toHaveBeenCalled();
    });

    it("should offer to try again when loading more fails", async () => {
        const vm = renderView({ hasMore: true, loadMoreFailed: true });

        expect(screen.getByRole("status")).toHaveTextContent("Couldn't load more GIFs.");
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(vm.retry).toHaveBeenCalled();
    });

    it("should mark the GIF being sent as busy", () => {
        renderView({ sendingId: "gif1" });

        expect(screen.getByRole("button", { name: "GIF 1" })).toHaveAttribute("aria-busy", "true");
        expect(screen.getByRole("button", { name: "GIF 0" })).not.toHaveAttribute("aria-busy");
    });

    it("should say when a GIF could not be sent", () => {
        renderView({ sendFailed: true });

        expect(screen.getByRole("alert")).toHaveTextContent("Couldn't send that GIF. Try again.");
    });

    it("should put each GIF in the shortest column", () => {
        renderView();

        const columnOf = (name: string): string | null =>
            screen.getByRole("button", { name }).getAttribute("data-column");
        expect(["GIF 0", "GIF 3", "GIF 6"].map(columnOf)).toEqual(["0", "0", "0"]);
        expect(["GIF 1", "GIF 2", "GIF 4", "GIF 5", "GIF 7"].map(columnOf)).toEqual(["1", "1", "1", "1", "1"]);
    });

    it("should move between the GIFs with the arrow keys", async () => {
        renderView();

        await userEvent.click(screen.getByRole("searchbox", { name: "Search GIFs" }));
        await userEvent.keyboard("{ArrowDown}");
        expect(screen.getByRole("button", { name: "GIF 0" })).toHaveFocus();

        await userEvent.keyboard("{ArrowDown}");
        expect(screen.getByRole("button", { name: "GIF 3" })).toHaveFocus();

        await userEvent.keyboard("{ArrowRight}");
        expect(screen.getByRole("button", { name: "GIF 4" })).toHaveFocus();

        await userEvent.keyboard("{ArrowLeft}");
        expect(screen.getByRole("button", { name: "GIF 3" })).toHaveFocus();

        await userEvent.keyboard("{ArrowUp}");
        expect(screen.getByRole("button", { name: "GIF 0" })).toHaveFocus();

        await userEvent.keyboard("{End}");
        expect(screen.getByRole("button", { name: "GIF 7" })).toHaveFocus();
        expect(screen.getByRole("button", { name: "GIF 7" })).toHaveAttribute("tabindex", "0");
        expect(screen.getByRole("button", { name: "GIF 0" })).toHaveAttribute("tabindex", "-1");
    });

    it("should move between the search field, the recent GIFs and the grid with the arrow keys", async () => {
        const recent = makeItems([100, 100]).map((item) => ({
            ...item,
            id: `r${item.id}`,
            title: `Recent ${item.title}`,
        }));
        renderView({ recent });

        await userEvent.click(screen.getByRole("searchbox", { name: "Search GIFs" }));
        await userEvent.keyboard("{ArrowDown}");
        expect(screen.getByRole("button", { name: "Recent GIF 0" })).toHaveFocus();

        await userEvent.keyboard("{ArrowRight}");
        expect(screen.getByRole("button", { name: "Recent GIF 1" })).toHaveFocus();

        await userEvent.keyboard("{ArrowDown}");
        expect(screen.getByRole("button", { name: "GIF 0" })).toHaveFocus();

        await userEvent.keyboard("{ArrowUp}");
        expect(screen.getByRole("button", { name: "Recent GIF 1" })).toHaveFocus();

        await userEvent.keyboard("{ArrowUp}");
        expect(screen.getByRole("searchbox", { name: "Search GIFs" })).toHaveFocus();
    });

    it("should mirror the left and right arrow keys in the recent GIFs in right-to-left layouts", async () => {
        const recent = makeItems([100, 100]).map((item) => ({
            ...item,
            id: `r${item.id}`,
            title: `Recent ${item.title}`,
        }));
        renderView({ recent }, "rtl");

        await userEvent.click(screen.getByRole("searchbox", { name: "Search GIFs" }));
        await userEvent.keyboard("{ArrowDown}");
        expect(screen.getByRole("button", { name: "Recent GIF 0" })).toHaveFocus();

        await userEvent.keyboard("{ArrowLeft}");
        expect(screen.getByRole("button", { name: "Recent GIF 1" })).toHaveFocus();

        await userEvent.keyboard("{ArrowRight}");
        expect(screen.getByRole("button", { name: "Recent GIF 0" })).toHaveFocus();
    });

    it("should move up from the top of the grid to the search field", async () => {
        renderView();

        await userEvent.click(screen.getByRole("searchbox", { name: "Search GIFs" }));
        await userEvent.keyboard("{ArrowDown}");
        await userEvent.keyboard("{ArrowUp}");

        expect(screen.getByRole("searchbox", { name: "Search GIFs" })).toHaveFocus();
    });

    it("should mirror the left and right arrow keys in right-to-left layouts", async () => {
        renderView({}, "rtl");

        await userEvent.click(screen.getByRole("searchbox", { name: "Search GIFs" }));
        await userEvent.keyboard("{ArrowDown}{ArrowDown}");
        expect(screen.getByRole("button", { name: "GIF 3" })).toHaveFocus();

        await userEvent.keyboard("{ArrowLeft}");
        expect(screen.getByRole("button", { name: "GIF 4" })).toHaveFocus();

        await userEvent.keyboard("{ArrowRight}");
        expect(screen.getByRole("button", { name: "GIF 3" })).toHaveFocus();
    });

    it("should load more GIFs when the end of the list comes into view", async () => {
        const vm = renderView({ hasMore: true, items: makeItems([100, 100]) });

        await waitFor(() => expect(vm.loadMore).toHaveBeenCalled());
    });

    it("should not load more GIFs until scrolled to the end", async () => {
        const vm = renderView({ hasMore: true, items: makeItems(Array.from({ length: 24 }, () => 100)) });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(vm.loadMore).not.toHaveBeenCalled();

        const lastGif = screen.getByRole("button", { name: "GIF 23" });
        lastGif.scrollIntoView();
        await waitFor(() => expect(vm.loadMore).toHaveBeenCalled());
    });

    it("should not load more GIFs while loading more", async () => {
        const vm = renderView({ hasMore: true, loadingMore: true, items: makeItems([100, 100]) });

        expect(screen.getAllByRole("progressbar", { name: "Loading GIFs" })).toHaveLength(1);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(vm.loadMore).not.toHaveBeenCalled();
    });
});
