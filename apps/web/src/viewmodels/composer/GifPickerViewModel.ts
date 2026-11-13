/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import {
    BaseViewModel,
    type GifPickerViewCategory,
    type GifPickerViewItem,
    type GifPickerViewModel as GifPickerViewModelInterface,
    type GifPickerViewSnapshot,
} from "@element-hq/web-shared-components";
import { logger } from "matrix-js-sdk/src/logger";
import { type IEventRelation, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import sanitizeFilename from "sanitize-filename";

import ContentMessages from "../../ContentMessages";
import SettingsStore from "../../settings/SettingsStore";
import { type TimelineRenderingType } from "../../contexts/RoomContext";
import { type MatrixDispatcher } from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { doMaybeLocalRoomAction } from "../../utils/local-room";
import { addRecentGif, getRecentGifs } from "../../gifs/recent";
import type { GifPage, GifProvider, GifResult } from "../../gifs/types";

const SEARCH_DELAY_MS = 300;
const MAX_FILE_NAME_LENGTH = 60;
// The signatures of GIF files, https://www.w3.org/Graphics/GIF/spec-gif89a.txt section 17
const GIF_SIGNATURES = ["GIF87a", "GIF89a"];

const CATEGORY_QUERIES: Record<GifPickerViewCategory, string> = {
    celebrate: "celebrate",
    love: "love",
    thumbs_up: "thumbs up",
    surprised: "surprised",
    excited: "excited",
    sad: "sad",
    angry: "angry",
};

const CATEGORIES = Object.keys(CATEGORY_QUERIES) as GifPickerViewCategory[];

interface Props {
    /** The GIF search service. */
    provider: GifProvider;
    /** The room to send the GIF to. */
    room: Room;
    /** The client to send the GIF with. */
    client: MatrixClient;
    /** The thread to send the GIF to, if any. */
    relation: IEventRelation | undefined;
    /** The event the GIF replies to, if any. */
    replyToEvent: MatrixEvent | undefined;
    /** The timeline of the composer that the picker belongs to. */
    timelineRenderingType: TimelineRenderingType;
    /** The dispatcher for the composer's actions. */
    dispatcher: MatrixDispatcher;
    /** Called once a GIF has been handed over for sending, to close the picker. */
    onFinished: () => void;
}

/** The GIFs shown below the search field: the trending ones, a search, or a category. */
interface Section {
    section: GifPickerViewSnapshot["section"];
    /** Identifies what is searched for, so that the same search is not loaded twice. */
    key: string;
    load: (cursor: string | null, signal: AbortSignal) => Promise<GifPage>;
}

function toViewItem(gif: GifResult): GifPickerViewItem {
    return {
        id: gif.id,
        title: gif.title,
        previewUrl: gif.preview.url,
        ...(gif.previewStillUrl && { stillUrl: gif.previewStillUrl }),
        width: gif.preview.width,
        height: gif.preview.height,
    };
}

function withoutDuplicates(known: GifResult[], added: GifResult[]): GifResult[] {
    const ids = new Set(known.map((gif) => gif.id));
    return added.filter((gif) => {
        if (ids.has(gif.id)) return false;
        ids.add(gif.id);
        return true;
    });
}

function fileName(gif: GifResult): string {
    const title = sanitizeFilename(gif.title.replace(/\.gif$/i, ""), { replacement: " " })
        .replace(/\s+/g, " ")
        .trim();
    const name = Array.from(title).slice(0, MAX_FILE_NAME_LENGTH).join("").trim();
    return `${name || sanitizeFilename(gif.id)}.gif`;
}

async function isGif(blob: Blob): Promise<boolean> {
    const signature = String.fromCharCode(...new Uint8Array(await blob.slice(0, 6).arrayBuffer()));
    return GIF_SIGNATURES.includes(signature);
}

/**
 * View model of the GIF picker in the message composer. It searches the GIF provider, pages through its results, and
 * sends the chosen GIF to the room as an image uploaded to the media repository, so that the message carries no URL
 * of the provider.
 */
export class GifPickerViewModel
    extends BaseViewModel<GifPickerViewSnapshot, Props>
    implements GifPickerViewModelInterface
{
    private readonly recentGifs: GifResult[];
    private results: GifResult[] = [];
    private next: string | null = null;
    private section: Section | null = null;
    private sectionController: AbortController | null = null;
    private sendController: AbortController | null = null;
    private searchTimer: ReturnType<typeof setTimeout> | undefined;

    public constructor(props: Props) {
        const recentGifs = getRecentGifs(props.provider.name);
        super(props, {
            providerName: props.provider.attribution,
            attributionMark: props.provider.attributionMark,
            query: "",
            maxQueryLength: props.provider.maxQueryLength,
            categories: CATEGORIES,
            selectedCategory: null,
            autoplay: SettingsStore.getValue("autoplayGifs"),
            recent: recentGifs.map(toViewItem),
            section: "trending",
            items: [],
            status: "loading",
            hasMore: false,
            loadingMore: false,
            loadMoreFailed: false,
            sendingId: null,
            sendFailed: false,
        });
        this.recentGifs = recentGifs;
        void this.loadSection();
    }

    public dispose(): void {
        clearTimeout(this.searchTimer);
        this.sectionController?.abort();
        this.sendController?.abort();
        super.dispose();
    }

    public setQuery = (query: string): void => {
        this.snapshot.merge({ query: query.slice(0, this.props.provider.maxQueryLength) });
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => void this.loadSection(), SEARCH_DELAY_MS);
    };

    public selectCategory = (category: GifPickerViewCategory): void => {
        clearTimeout(this.searchTimer);
        const selected = this.snapshot.current.selectedCategory === category ? null : category;
        this.snapshot.merge({ selectedCategory: selected, query: "" });
        void this.loadSection();
    };

    public loadMore = (): void => {
        void this.loadNextPage();
    };

    public retry = (): void => {
        if (this.snapshot.current.status === "error") {
            void this.loadSection(true);
        } else if (this.snapshot.current.loadMoreFailed) {
            void this.loadNextPage();
        }
    };

    public sendGif = (id: string): void => {
        void this.send(id);
    };

    private currentSection(): Section {
        const { provider } = this.props;
        const query = this.snapshot.current.query.trim();
        if (query) {
            return {
                section: "search",
                key: `search:${query}`,
                load: (cursor, signal) => provider.search(query, cursor, signal),
            };
        }

        const category = this.snapshot.current.selectedCategory;
        if (category) {
            return {
                section: "category",
                key: `category:${category}`,
                load: (cursor, signal) => provider.search(CATEGORY_QUERIES[category], cursor, signal),
            };
        }

        return { section: "trending", key: "trending", load: (cursor, signal) => provider.trending(cursor, signal) };
    }

    private async loadSection(reload = false): Promise<void> {
        const section = this.currentSection();
        if (!reload && section.key === this.section?.key) return;

        this.sectionController?.abort();
        const controller = new AbortController();
        this.sectionController = controller;
        this.section = section;
        this.results = [];
        this.next = null;
        this.snapshot.merge({
            section: section.section,
            ...(section.section === "search" && { selectedCategory: null }),
            status: "loading",
            items: [],
            hasMore: false,
            loadingMore: false,
            loadMoreFailed: false,
            // The failure was about a GIF which is no longer shown
            sendFailed: false,
        });

        try {
            const page = await section.load(null, controller.signal);
            if (controller.signal.aborted) return;
            this.results = withoutDuplicates([], page.results);
            this.next = page.next;
            this.snapshot.merge({
                status: "ready",
                items: this.results.map(toViewItem),
                hasMore: page.next !== null,
            });
        } catch (error) {
            if (controller.signal.aborted) return;
            logger.warn("Failed to load GIFs", error);
            this.snapshot.merge({ status: "error" });
        }
    }

    private async loadNextPage(): Promise<void> {
        const { section, sectionController: controller, next } = this;
        const { status, loadingMore } = this.snapshot.current;
        if (status !== "ready" || loadingMore || next === null || !section || !controller) return;

        this.snapshot.merge({ loadingMore: true, loadMoreFailed: false });
        try {
            const page = await section.load(next, controller.signal);
            if (controller.signal.aborted) return;
            const added = withoutDuplicates(this.results, page.results);
            this.results = [...this.results, ...added];
            this.next = added.length > 0 ? page.next : null;
            this.snapshot.merge({
                items: [...this.snapshot.current.items, ...added.map(toViewItem)],
                hasMore: this.next !== null,
                loadingMore: false,
            });
        } catch (error) {
            if (controller.signal.aborted) return;
            logger.warn("Failed to load more GIFs", error);
            this.snapshot.merge({ loadingMore: false, loadMoreFailed: true });
        }
    }

    private async send(id: string): Promise<void> {
        if (this.snapshot.current.sendingId !== null) return;
        const gif =
            this.results.find((result) => result.id === id) ?? this.recentGifs.find((recent) => recent.id === id);
        if (!gif) return;

        const { client, room, relation, replyToEvent, timelineRenderingType, dispatcher, provider } = this.props;
        if (client.isGuest()) {
            dispatcher.dispatch({ action: "require_registration" });
            return;
        }

        const controller = new AbortController();
        this.sendController = controller;
        this.snapshot.merge({ sendingId: id, sendFailed: false });

        let file: File;
        try {
            file = await this.download(gif, controller.signal);
        } catch (error) {
            if (controller.signal.aborted) return;
            logger.warn("Failed to download GIF", error);
            this.snapshot.merge({ sendingId: null, sendFailed: true });
            return;
        }
        if (controller.signal.aborted) return;

        addRecentGif(provider.name, gif);
        void doMaybeLocalRoomAction(
            room.roomId,
            (roomId) =>
                ContentMessages.sharedInstance().sendContentToRoom(file, roomId, relation, client, replyToEvent),
            client,
        ).catch((error) => logger.error("Failed to send GIF", error));

        if (replyToEvent) {
            dispatcher.dispatch({ action: "reply_to_event", event: null, context: timelineRenderingType });
        }
        dispatcher.dispatch({ action: Action.FocusSendMessageComposer, context: timelineRenderingType });
        this.snapshot.merge({ sendingId: null });
        this.props.onFinished();
    }

    private async download(gif: GifResult, signal: AbortSignal): Promise<File> {
        const response = await fetch(gif.full.url, { signal });
        if (!response.ok) throw new Error(`GIF download failed with status ${response.status}`);
        const blob = await response.blob();
        if (!(await isGif(blob))) throw new Error("GIF download is not a GIF file");
        return new File([blob], fileName(gif), { type: gif.full.mimetype });
    }
}
