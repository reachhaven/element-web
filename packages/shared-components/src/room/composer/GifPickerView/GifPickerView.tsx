/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React, { type Dispatch, type JSX, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, ChatFilter, Form, InlineSpinner, Search, Text } from "@vector-im/compound-web";
import classNames from "classnames";

import { _t } from "../../../core/i18n/i18n";
import { type ViewModel, useViewModel } from "../../../core/viewmodel";
import { AutoHideScrollbar } from "../../../core/utils/Scrollbar";
import { Flex } from "../../../core/utils/Flex";
import {
    type IAction as RovingAction,
    type IState as RovingState,
    RovingAction as RovingKeyAction,
    RovingStateActionType,
    RovingTabIndexProvider,
    useRovingTabIndex,
} from "../../../core/roving";
import styles from "./GifPickerView.module.css";
import poweredByGiphy from "./powered-by-giphy.svg";

const COLUMN_COUNT = 2;
const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/**
 * A category of GIFs offered as a shortcut to a search.
 */
export type GifPickerViewCategory = "celebrate" | "love" | "thumbs_up" | "surprised" | "excited" | "sad" | "angry";

/**
 * The attribution mark of a GIF provider whose terms ask for its mark rather than a "Powered by" line.
 */
export type GifPickerViewAttributionMark = "giphy";

const ATTRIBUTION_MARKS: Record<GifPickerViewAttributionMark, string> = {
    giphy: poweredByGiphy,
};

/**
 * A GIF shown in the picker.
 */
export interface GifPickerViewItem {
    /** Identifier of the GIF, passed to {@link GifPickerViewActions.sendGif}. */
    id: string;
    /** Description of the GIF, used as its accessible name. May be empty. */
    title: string;
    /** URL of the animated preview. */
    previewUrl: string;
    /** URL of a still image of the preview, shown instead of it unless GIFs play automatically. */
    stillUrl?: string;
    /** Width of the preview in pixels. */
    width: number;
    /** Height of the preview in pixels. */
    height: number;
}

/**
 * The state of the GIF picker.
 */
export interface GifPickerViewSnapshot {
    /** Name of the GIF provider, shown in the search field and the attribution line. */
    providerName: string;
    /** The provider's attribution mark, shown in place of the attribution line, or `null` for the line. */
    attributionMark: GifPickerViewAttributionMark | null;
    /** The text in the search field. */
    query: string;
    /** Longest query the search field accepts, in characters. */
    maxQueryLength: number;
    /** Categories offered as shortcuts to a search. */
    categories: GifPickerViewCategory[];
    /** The selected category, if any. */
    selectedCategory: GifPickerViewCategory | null;
    /** Whether previews play on their own. Otherwise a GIF plays while it is hovered or focused. */
    autoplay: boolean;
    /** GIFs recently sent from this device, most recent first. Shown above the trending GIFs. */
    recent: GifPickerViewItem[];
    /** What {@link items} are: the trending GIFs, the results of the search, or the GIFs of the selected category. */
    section: "trending" | "search" | "category";
    /** The GIFs to show. */
    items: GifPickerViewItem[];
    /** Whether the first page of {@link items} is loading, is loaded, or failed to load. */
    status: "loading" | "ready" | "error";
    /** Whether there are more GIFs to load. */
    hasMore: boolean;
    /** Whether more GIFs are loading. */
    loadingMore: boolean;
    /** Whether loading more GIFs failed. */
    loadMoreFailed: boolean;
    /** Identifier of the GIF being sent, if any. */
    sendingId: string | null;
    /** Whether sending the last chosen GIF failed. */
    sendFailed: boolean;
}

/**
 * What the GIF picker can ask its view model to do.
 */
export interface GifPickerViewActions {
    /** Change the search query. */
    setQuery: (query: string) => void;
    /** Select a category, or unselect it if it is selected. */
    selectCategory: (category: GifPickerViewCategory) => void;
    /** Load the next page of GIFs. */
    loadMore: () => void;
    /** Load the GIFs again after loading failed. */
    retry: () => void;
    /** Send a GIF of {@link GifPickerViewSnapshot.items} or {@link GifPickerViewSnapshot.recent}. */
    sendGif: (id: string) => void;
}

/**
 * The view model for {@link GifPickerView}.
 */
export type GifPickerViewModel = ViewModel<GifPickerViewSnapshot, GifPickerViewActions>;

interface GifPickerViewProps {
    /** The view model for the GIF picker. */
    vm: GifPickerViewModel;
}

function categoryLabel(category: GifPickerViewCategory): string {
    switch (category) {
        case "celebrate":
            return _t("composer|gif_picker|category_celebrate");
        case "love":
            return _t("composer|gif_picker|category_love");
        case "thumbs_up":
            return _t("composer|gif_picker|category_thumbs_up");
        case "surprised":
            return _t("composer|gif_picker|category_surprised");
        case "excited":
            return _t("composer|gif_picker|category_excited");
        case "sad":
            return _t("composer|gif_picker|category_sad");
        case "angry":
            return _t("composer|gif_picker|category_angry");
    }
}

interface Column {
    /** Position of the column, from the start of the line. */
    index: number;
    /** The GIFs in the column, from the top. */
    items: GifPickerViewItem[];
}

/**
 * Lay the GIFs out as a waterfall: each GIF goes into the column that is the shortest so far.
 * GIFs keep their column when more are appended.
 */
function splitIntoColumns(items: GifPickerViewItem[]): Column[] {
    const columns = Array.from({ length: COLUMN_COUNT }, (_, index): Column => ({ index, items: [] }));
    const heights = new Array<number>(COLUMN_COUNT).fill(0);
    for (const item of items) {
        const shortest = heights.indexOf(Math.min(...heights));
        columns[shortest].items.push(item);
        heights[shortest] += item.height / item.width;
    }
    return columns;
}

function verticalCentre(node: HTMLElement): number {
    const { top, bottom } = node.getBoundingClientRect();
    return (top + bottom) / 2;
}

/**
 * Find the GIF of the grid that an arrow key moves to from the focused one: the GIF above or below in the same
 * column, or the GIF in the neighbouring column whose centre is nearest.
 */
function findGridTarget(key: string, nodes: HTMLElement[], active: HTMLElement): HTMLElement | undefined {
    switch (key) {
        case "ArrowUp":
            return (active.previousElementSibling as HTMLElement | null) ?? undefined;
        case "ArrowDown":
            return (active.nextElementSibling as HTMLElement | null) ?? undefined;
        case "ArrowLeft":
        case "ArrowRight": {
            const towardsStart = (key === "ArrowLeft") === (getComputedStyle(active).direction !== "rtl");
            const column = Number(active.dataset.column) + (towardsStart ? -1 : 1);
            const centre = verticalCentre(active);
            let target: HTMLElement | undefined;
            for (const node of nodes) {
                if (node.dataset.column !== String(column)) continue;
                if (!target || Math.abs(verticalCentre(node) - centre) < Math.abs(verticalCentre(target) - centre)) {
                    target = node;
                }
            }
            return target;
        }
    }
}

/**
 * The roving action of a key in the row of recent GIFs. The left and right arrow keys follow the layout, so they swap
 * in right-to-left layouts, as they do in the grid.
 */
function getRecentRowAction(ev: React.KeyboardEvent): RovingKeyAction | undefined {
    const rtl = getComputedStyle(ev.currentTarget).direction === "rtl";
    switch (ev.key) {
        case "Home":
            return RovingKeyAction.Home;
        case "End":
            return RovingKeyAction.End;
        case "ArrowLeft":
            return rtl ? RovingKeyAction.ArrowRight : RovingKeyAction.ArrowLeft;
        case "ArrowRight":
            return rtl ? RovingKeyAction.ArrowLeft : RovingKeyAction.ArrowRight;
    }
}

/** The GIF of a roving group that takes part in the tab order. */
function findTabStop(container: HTMLElement | null): HTMLElement | null {
    return container?.querySelector<HTMLElement>(`.${styles.tile}[tabindex="0"]`) ?? null;
}

interface GifTileProps {
    /** The GIF to show. */
    item: GifPickerViewItem;
    /** Column of the grid that the GIF is in, if it is in the grid. */
    column?: number;
    /** Whether previews play on their own. */
    autoplay: boolean;
    /** Whether the GIF is being sent. */
    sending: boolean;
    /** Called with the GIF's identifier when it is chosen. */
    onSend: (id: string) => void;
}

/**
 * A GIF which sends itself when chosen. Unless previews play on their own, it plays while hovered or focused.
 */
function GifTile({ item, column, autoplay, sending, onSend }: GifTileProps): JSX.Element {
    const [onFocus, isActive, ref] = useRovingTabIndex<HTMLButtonElement>();
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const playing = autoplay || hovered || focused || !item.stillUrl;

    return (
        <button
            ref={ref}
            type="button"
            className={classNames(styles.tile, { [styles.tileSending]: sending })}
            style={{ aspectRatio: `${item.width} / ${item.height}` }}
            tabIndex={isActive ? 0 : -1}
            onFocus={() => {
                onFocus();
                setFocused(true);
            }}
            onBlur={() => setFocused(false)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={() => onSend(item.id)}
            aria-label={item.title || _t("composer|gif_picker|untitled")}
            aria-busy={sending || undefined}
            data-column={column}
        >
            <img src={playing ? item.previewUrl : item.stillUrl} alt="" loading="lazy" decoding="async" />
            {sending && <InlineSpinner className={styles.tileSpinner} />}
        </button>
    );
}

/**
 * A picker to search for GIFs and send one. It shows the trending GIFs and the GIFs recently sent while the search
 * is empty, offers categories as shortcuts to a search, loads more GIFs as it is scrolled, and credits the provider.
 *
 * @example
 * ```tsx
 * <GifPickerView vm={gifPickerViewModel} />
 * ```
 */
export function GifPickerView({ vm }: Readonly<GifPickerViewProps>): JSX.Element {
    const {
        providerName,
        attributionMark,
        query,
        maxQueryLength,
        categories,
        selectedCategory,
        autoplay,
        recent,
        section,
        items,
        status,
        hasMore,
        loadingMore,
        loadMoreFailed,
        sendingId,
        sendFailed,
    } = useViewModel(vm);

    const recentHeadingId = useId();
    const resultsHeadingId = useId();
    const searchRef = useRef<HTMLInputElement>(null);
    const recentRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

    const columns = useMemo(() => splitIntoColumns(items), [items]);
    const canLoadMore = status === "ready" && hasMore && !loadingMore && !loadMoreFailed;
    const showRecent = section === "trending" && recent.length > 0;

    useEffect(() => {
        searchRef.current?.focus();
    }, []);

    // observe() queues an initial notification, https://www.w3.org/TR/intersection-observer/#observe-target-element
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!canLoadMore || !sentinel || !scrollElement) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) vm.loadMore();
            },
            { root: scrollElement, rootMargin: "0px 0px 200px 0px" },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [vm, canLoadMore, scrollElement, items.length]);

    const onSearchKeyDown = useCallback((ev: React.KeyboardEvent): void => {
        if (ev.key !== "ArrowDown") return;
        const firstGif = findTabStop(recentRef.current) ?? findTabStop(gridRef.current);
        if (!firstGif) return;
        ev.preventDefault();
        firstGif.focus();
    }, []);

    const onRecentKeyDown = useCallback((ev: React.KeyboardEvent): void => {
        let target: HTMLElement | null = null;
        if (ev.key === "ArrowUp") target = searchRef.current;
        if (ev.key === "ArrowDown") target = findTabStop(gridRef.current);
        if (!target) return;
        ev.preventDefault();
        ev.stopPropagation();
        target.focus();
    }, []);

    const onGridKeyDown = useCallback(
        (ev: React.KeyboardEvent, state: RovingState, dispatch: Dispatch<RovingAction>): void => {
            if (!state.activeNode || !ARROW_KEYS.includes(ev.key)) return;
            ev.preventDefault();
            ev.stopPropagation();

            const target = findGridTarget(ev.key, state.nodes, state.activeNode);
            if (target) {
                target.focus();
                dispatch({ type: RovingStateActionType.SetFocus, payload: { node: target } });
                target.scrollIntoView({ block: "nearest" });
            } else if (ev.key === "ArrowUp") {
                (findTabStop(recentRef.current) ?? searchRef.current)?.focus();
            }
        },
        [],
    );

    let sectionLabel: string;
    if (section === "trending") {
        sectionLabel = _t("composer|gif_picker|trending");
    } else if (section === "category" && selectedCategory) {
        sectionLabel = categoryLabel(selectedCategory);
    } else {
        sectionLabel = _t("composer|gif_picker|results");
    }

    let announcement = "";
    let content: JSX.Element | null = null;
    if (status === "loading") {
        announcement = _t("composer|gif_picker|loading");
        content = (
            <Flex direction="column" align="center" className={styles.status}>
                <InlineSpinner role="progressbar" aria-label={_t("composer|gif_picker|loading")} />
            </Flex>
        );
    } else if (status === "error") {
        announcement = _t("composer|gif_picker|error_loading");
        content = (
            <Flex direction="column" align="center" gap="var(--cpd-space-2x)" className={styles.status}>
                <Text size="sm">{_t("composer|gif_picker|error_loading")}</Text>
                <Button kind="secondary" size="md" onClick={vm.retry}>
                    {_t("action|retry")}
                </Button>
            </Flex>
        );
    } else if (items.length === 0) {
        if (!hasMore) {
            announcement = _t("composer|gif_picker|no_results");
            content = (
                <Flex direction="column" align="center" className={styles.status}>
                    <Text size="sm">{_t("composer|gif_picker|no_results")}</Text>
                </Flex>
            );
        }
    } else {
        content = (
            <RovingTabIndexProvider handleHomeEnd onKeyDown={onGridKeyDown}>
                {({ onKeyDownHandler }) => (
                    <Flex ref={gridRef} gap="var(--cpd-space-1x)" onKeyDown={onKeyDownHandler}>
                        {columns.map((column) => (
                            <Flex
                                key={column.index}
                                direction="column"
                                align="stretch"
                                gap="var(--cpd-space-1x)"
                                className={styles.column}
                            >
                                {column.items.map((item) => (
                                    <GifTile
                                        key={item.id}
                                        item={item}
                                        column={column.index}
                                        autoplay={autoplay}
                                        sending={item.id === sendingId}
                                        onSend={vm.sendGif}
                                    />
                                ))}
                            </Flex>
                        ))}
                    </Flex>
                )}
            </RovingTabIndexProvider>
        );
    }
    if (loadMoreFailed) announcement = _t("composer|gif_picker|error_loading_more");

    const attribution = _t("composer|gif_picker|attribution", { provider: providerName });

    return (
        <Flex
            as="section"
            direction="column"
            align="stretch"
            className={styles.picker}
            aria-label={_t("composer|gif_picker|label")}
        >
            <Flex direction="column" align="stretch" gap="var(--cpd-space-2x)" className={styles.header}>
                <Form.Root onSubmit={(ev) => ev.preventDefault()}>
                    <Search
                        ref={searchRef}
                        name="gif_search"
                        // mx_no_textinput opts the field out of Element Web's global text input styles
                        className={classNames(styles.search, "mx_no_textinput")}
                        placeholder={_t("composer|gif_picker|search_placeholder", { provider: providerName })}
                        aria-label={_t("composer|gif_picker|search_label")}
                        tabIndex={0}
                        value={query}
                        maxLength={maxQueryLength}
                        onChange={(ev) => vm.setQuery(ev.currentTarget.value)}
                        onKeyDown={onSearchKeyDown}
                    />
                </Form.Root>
                <Flex
                    wrap="wrap"
                    gap="var(--cpd-space-2x)"
                    className={styles.categories}
                    role="listbox"
                    aria-label={_t("composer|gif_picker|categories")}
                >
                    {categories.map((category) => (
                        <ChatFilter
                            key={category}
                            role="option"
                            aria-selected={category === selectedCategory}
                            selected={category === selectedCategory}
                            onClick={() => vm.selectCategory(category)}
                        >
                            {categoryLabel(category)}
                        </ChatFilter>
                    ))}
                </Flex>
            </Flex>
            <AutoHideScrollbar className={styles.body} wrappedRef={setScrollElement}>
                {showRecent && (
                    <section aria-labelledby={recentHeadingId}>
                        <Text as="h3" size="sm" weight="semibold" id={recentHeadingId} className={styles.heading}>
                            {_t("composer|gif_picker|recent")}
                        </Text>
                        <RovingTabIndexProvider
                            handleLeftRight
                            handleHomeEnd
                            onKeyDown={onRecentKeyDown}
                            getAction={getRecentRowAction}
                        >
                            {({ onKeyDownHandler }) => (
                                <Flex
                                    ref={recentRef}
                                    gap="var(--cpd-space-1x)"
                                    className={styles.recent}
                                    onKeyDown={onKeyDownHandler}
                                >
                                    {recent.map((item) => (
                                        <GifTile
                                            key={item.id}
                                            item={item}
                                            autoplay={autoplay}
                                            sending={item.id === sendingId}
                                            onSend={vm.sendGif}
                                        />
                                    ))}
                                </Flex>
                            )}
                        </RovingTabIndexProvider>
                    </section>
                )}
                <section aria-labelledby={resultsHeadingId} aria-busy={status === "loading" || loadingMore}>
                    <Text as="h3" size="sm" weight="semibold" id={resultsHeadingId} className={styles.heading}>
                        {sectionLabel}
                    </Text>
                    {content}
                    {loadingMore && (
                        <Flex direction="column" align="center" className={styles.status}>
                            <InlineSpinner role="progressbar" aria-label={_t("composer|gif_picker|loading")} />
                        </Flex>
                    )}
                    {loadMoreFailed && (
                        <Flex direction="column" align="center" gap="var(--cpd-space-2x)" className={styles.status}>
                            <Text size="sm">{_t("composer|gif_picker|error_loading_more")}</Text>
                            <Button kind="secondary" size="md" onClick={vm.retry}>
                                {_t("action|retry")}
                            </Button>
                        </Flex>
                    )}
                    {canLoadMore && <div ref={sentinelRef} className={styles.sentinel} />}
                </section>
            </AutoHideScrollbar>
            <div role="status" className={styles.visuallyHidden}>
                {announcement}
            </div>
            {sendFailed && (
                <Text size="sm" role="alert" className={styles.sendError}>
                    {_t("composer|gif_picker|error_sending")}
                </Text>
            )}
            {attributionMark ? (
                <div className={styles.attribution}>
                    <img
                        className={styles.attributionMark}
                        src={ATTRIBUTION_MARKS[attributionMark]}
                        alt={attribution}
                    />
                </div>
            ) : (
                <Text size="xs" className={styles.attribution}>
                    {attribution}
                </Text>
            )}
        </Flex>
    );
}
