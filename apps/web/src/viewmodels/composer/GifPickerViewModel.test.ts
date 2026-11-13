/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from "vitest";
import fetchMock from "@fetch-mock/vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { createTestClient, mkStubRoom, mkMessage, tearDownAfterTest } from "test-utils";

import { GifPickerViewModel } from "./GifPickerViewModel";
import ContentMessages from "../../ContentMessages";
import SettingsStore from "../../settings/SettingsStore";
import { TimelineRenderingType } from "../../contexts/RoomContext";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { addRecentGif, getRecentGifs } from "../../gifs/recent";
import type { GifPage, GifProvider, GifResult } from "../../gifs/types";

vi.mock("../../gifs/recent", () => ({
    getRecentGifs: vi.fn(),
    addRecentGif: vi.fn(),
}));

const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);

function gif(id: string, title = `${id} title`): GifResult {
    return {
        id,
        title,
        preview: { url: `https://media.example.net/${id}/small.gif`, width: 100, height: 80 },
        full: {
            url: `https://media.example.net/${id}/full.gif`,
            width: 400,
            height: 320,
            size: GIF_BYTES.length,
            mimetype: "image/gif",
        },
    };
}

function page(ids: string[], next: string | null = null): GifPage {
    return { results: ids.map((id) => gif(id)), next };
}

class FakeProvider implements GifProvider {
    public readonly name = "fake";
    public readonly attribution = "FAKE";
    public readonly attributionMark = null;
    public readonly maxQueryLength = 10;
    public search = vi.fn<GifProvider["search"]>();
    public trending = vi.fn<GifProvider["trending"]>();
}

describe("GifPickerViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let provider: FakeProvider;
    let onFinished: Mock<() => void>;
    let sendContentToRoom: Mock<ContentMessages["sendContentToRoom"]>;

    beforeEach(() => {
        client = createTestClient();
        room = mkStubRoom("!room:example.org", "Room", client);
        provider = new FakeProvider();
        provider.trending.mockResolvedValue(page(["t1", "t2"], "2"));
        provider.search.mockResolvedValue(page(["s1"]));
        onFinished = vi.fn();
        sendContentToRoom = vi.fn<ContentMessages["sendContentToRoom"]>().mockResolvedValue(undefined);
        vi.spyOn(ContentMessages, "sharedInstance").mockReturnValue({
            sendContentToRoom,
        } as unknown as ContentMessages);
        vi.spyOn(defaultDispatcher, "dispatch");
        vi.mocked(getRecentGifs).mockReturnValue([]);
        fetchMock.get("begin:https://media.example.net/", {
            body: GIF_BYTES,
            headers: { "Content-Type": "image/gif" },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function createViewModel(
        overrides: Partial<ConstructorParameters<typeof GifPickerViewModel>[0]> = {},
    ): GifPickerViewModel {
        return tearDownAfterTest(
            new GifPickerViewModel({
                provider,
                room,
                client,
                relation: undefined,
                replyToEvent: undefined,
                timelineRenderingType: TimelineRenderingType.Room,
                dispatcher: defaultDispatcher,
                onFinished,
                ...overrides,
            }),
        );
    }

    async function createLoadedViewModel(
        overrides: Partial<ConstructorParameters<typeof GifPickerViewModel>[0]> = {},
    ): Promise<GifPickerViewModel> {
        const vm = createViewModel(overrides);
        await vi.waitFor(() => expect(vm.getSnapshot().status).toBe("ready"));
        return vm;
    }

    describe("loading", () => {
        it("should show the trending GIFs first", async () => {
            const vm = createViewModel();
            expect(vm.getSnapshot()).toMatchObject({
                providerName: "FAKE",
                attributionMark: null,
                maxQueryLength: 10,
                section: "trending",
                status: "loading",
            });

            await vi.waitFor(() => expect(vm.getSnapshot().status).toBe("ready"));
            expect(provider.trending).toHaveBeenCalledWith(null, expect.any(AbortSignal));
            expect(vm.getSnapshot().items).toEqual([
                {
                    id: "t1",
                    title: "t1 title",
                    previewUrl: "https://media.example.net/t1/small.gif",
                    width: 100,
                    height: 80,
                },
                expect.objectContaining({ id: "t2" }),
            ]);
            expect(vm.getSnapshot().hasMore).toBe(true);
            expect(vm.getSnapshot().categories).toEqual([
                "celebrate",
                "love",
                "thumbs_up",
                "surprised",
                "excited",
                "sad",
                "angry",
            ]);
        });

        it("should play previews automatically only when GIFs play automatically", () => {
            expect(createViewModel().getSnapshot().autoplay).toBe(false);

            vi.spyOn(SettingsStore, "getValue").mockImplementation(
                ((name: string) => name === "autoplayGifs") as typeof SettingsStore.getValue,
            );
            expect(createViewModel().getSnapshot().autoplay).toBe(true);
        });

        it("should pass on still images of the previews", async () => {
            provider.trending.mockResolvedValue({
                results: [{ ...gif("t1"), previewStillUrl: "https://media.example.net/t1/still.gif" }, gif("t2")],
                next: null,
            });
            const vm = await createLoadedViewModel();

            expect(vm.getSnapshot().items[0].stillUrl).toBe("https://media.example.net/t1/still.gif");
            expect(vm.getSnapshot().items[1]).not.toHaveProperty("stillUrl");
        });

        it("should show the GIFs recently sent through the provider", async () => {
            vi.mocked(getRecentGifs).mockReturnValue([gif("r1")]);

            const vm = createViewModel();

            expect(getRecentGifs).toHaveBeenCalledWith("fake");
            expect(vm.getSnapshot().recent.map(({ id }) => id)).toEqual(["r1"]);
        });

        it("should report a failure to load and load again on retry", async () => {
            provider.trending.mockRejectedValueOnce(new Error("offline"));
            const vm = createViewModel();
            await vi.waitFor(() => expect(vm.getSnapshot().status).toBe("error"));

            vm.retry();

            await vi.waitFor(() => expect(vm.getSnapshot().status).toBe("ready"));
            expect(provider.trending).toHaveBeenCalledTimes(2);
            expect(vm.getSnapshot().items).toHaveLength(2);
        });

        it("should load more GIFs, leaving out GIFs already shown", async () => {
            const vm = await createLoadedViewModel();
            provider.trending.mockResolvedValueOnce(page(["t2", "t3"]));

            vm.loadMore();

            await vi.waitFor(() => expect(vm.getSnapshot().loadingMore).toBe(false));
            expect(provider.trending).toHaveBeenLastCalledWith("2", expect.any(AbortSignal));
            expect(vm.getSnapshot().items.map(({ id }) => id)).toEqual(["t1", "t2", "t3"]);
            expect(vm.getSnapshot().hasMore).toBe(false);
        });

        it("should stop loading more when a page adds no new GIFs", async () => {
            const vm = await createLoadedViewModel();
            provider.trending.mockResolvedValueOnce(page(["t1", "t2"], "3"));

            vm.loadMore();
            await vi.waitFor(() => expect(vm.getSnapshot().loadingMore).toBe(false));
            vm.loadMore();

            expect(vm.getSnapshot().hasMore).toBe(false);
            expect(provider.trending).toHaveBeenCalledTimes(2);
        });

        it("should not load more GIFs when there are no more", async () => {
            provider.trending.mockResolvedValue(page(["t1"]));
            const vm = await createLoadedViewModel();

            vm.loadMore();

            expect(provider.trending).toHaveBeenCalledTimes(1);
            expect(vm.getSnapshot().loadingMore).toBe(false);
        });

        it("should load one page at a time", async () => {
            const vm = await createLoadedViewModel();
            provider.trending.mockReturnValue(new Promise(() => {}));

            vm.loadMore();
            vm.loadMore();

            expect(provider.trending).toHaveBeenCalledTimes(2);
            expect(vm.getSnapshot().loadingMore).toBe(true);
        });

        it("should report a failure to load more and load more again on retry", async () => {
            const vm = await createLoadedViewModel();
            provider.trending.mockRejectedValueOnce(new Error("offline"));

            vm.loadMore();
            await vi.waitFor(() => expect(vm.getSnapshot().loadMoreFailed).toBe(true));
            expect(vm.getSnapshot().items).toHaveLength(2);

            provider.trending.mockResolvedValueOnce(page(["t3"]));
            vm.retry();

            await vi.waitFor(() => expect(vm.getSnapshot().items).toHaveLength(3));
            expect(vm.getSnapshot().loadMoreFailed).toBe(false);
        });

        it("should stop loading when disposed", async () => {
            provider.trending.mockReturnValue(new Promise(() => {}));
            const vm = createViewModel();
            const signal = provider.trending.mock.calls[0][1];

            vm.dispose();

            expect(signal.aborted).toBe(true);
        });
    });

    describe("searching", () => {
        it("should search once the person stops typing", async () => {
            vi.useFakeTimers();
            const vm = createViewModel();

            vm.setQuery("c");
            vm.setQuery("ca");
            vm.setQuery("cat");
            expect(vm.getSnapshot().query).toBe("cat");
            await vi.advanceTimersByTimeAsync(299);
            expect(provider.search).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(provider.search).toHaveBeenCalledTimes(1);
            expect(provider.search).toHaveBeenCalledWith("cat", null, expect.any(AbortSignal));
            expect(vm.getSnapshot()).toMatchObject({ section: "search", status: "ready" });
            expect(vm.getSnapshot().items.map(({ id }) => id)).toEqual(["s1"]);
        });

        it("should cap the query at the provider's longest query", async () => {
            vi.useFakeTimers();
            const vm = createViewModel();

            vm.setQuery("abcdefghijklmnop");
            await vi.advanceTimersByTimeAsync(300);

            expect(vm.getSnapshot().query).toBe("abcdefghij");
            expect(provider.search).toHaveBeenCalledWith("abcdefghij", null, expect.any(AbortSignal));
        });

        it("should not search again when only surrounding spaces change", async () => {
            vi.useFakeTimers();
            const vm = createViewModel();
            vm.setQuery("cat");
            await vi.advanceTimersByTimeAsync(300);

            vm.setQuery("cat ");
            await vi.advanceTimersByTimeAsync(300);

            expect(provider.search).toHaveBeenCalledTimes(1);
        });

        it("should show the trending GIFs again when the search is cleared", async () => {
            vi.useFakeTimers();
            const vm = createViewModel();
            vm.setQuery("cat");
            await vi.advanceTimersByTimeAsync(300);

            vm.setQuery("");
            await vi.advanceTimersByTimeAsync(300);

            expect(provider.trending).toHaveBeenCalledTimes(2);
            expect(vm.getSnapshot()).toMatchObject({ section: "trending", status: "ready" });
        });

        it("should abort a load which is overtaken by a newer one", async () => {
            provider.trending.mockReturnValue(new Promise(() => {}));
            const vm = createViewModel();
            const signal = provider.trending.mock.calls[0][1];

            vm.selectCategory("sad");

            expect(signal.aborted).toBe(true);
            await vi.waitFor(() => expect(vm.getSnapshot().status).toBe("ready"));
            expect(vm.getSnapshot().section).toBe("category");
        });

        it("should ignore a first page which arrives after a newer load started", async () => {
            let resolveTrending!: (page: GifPage) => void;
            provider.trending.mockReturnValueOnce(new Promise((resolve) => (resolveTrending = resolve)));
            const vm = createViewModel();

            vm.selectCategory("sad");
            await vi.waitFor(() => expect(vm.getSnapshot().status).toBe("ready"));
            resolveTrending(page(["late"]));
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(vm.getSnapshot()).toMatchObject({ section: "category", status: "ready" });
            expect(vm.getSnapshot().items.map(({ id }) => id)).toEqual(["s1"]);
        });

        it("should ignore a next page which arrives after a newer load started", async () => {
            const vm = await createLoadedViewModel();
            let resolveNext!: (page: GifPage) => void;
            provider.trending.mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)));

            vm.loadMore();
            vm.selectCategory("sad");
            await vi.waitFor(() => expect(vm.getSnapshot().status).toBe("ready"));
            resolveNext(page(["late"]));
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(vm.getSnapshot().items.map(({ id }) => id)).toEqual(["s1"]);
            expect(vm.getSnapshot().loadingMore).toBe(false);
        });

        it("should search a category and unselect it again", async () => {
            const vm = await createLoadedViewModel();

            vm.selectCategory("thumbs_up");
            expect(vm.getSnapshot()).toMatchObject({ selectedCategory: "thumbs_up", section: "category" });
            expect(provider.search).toHaveBeenCalledWith("thumbs up", null, expect.any(AbortSignal));
            await vi.waitFor(() => expect(vm.getSnapshot().status).toBe("ready"));

            vm.selectCategory("thumbs_up");
            expect(vm.getSnapshot()).toMatchObject({ selectedCategory: null, section: "trending" });
            expect(provider.trending).toHaveBeenCalledTimes(2);
        });

        it("should keep the category until the search the person types starts", async () => {
            vi.useFakeTimers();
            const vm = createViewModel();
            vm.selectCategory("love");
            await vi.advanceTimersByTimeAsync(0);

            vm.setQuery("cats");
            expect(vm.getSnapshot()).toMatchObject({ query: "cats", selectedCategory: "love", section: "category" });
            await vi.advanceTimersByTimeAsync(300);

            expect(provider.search).toHaveBeenLastCalledWith("cats", null, expect.any(AbortSignal));
            expect(vm.getSnapshot()).toMatchObject({ selectedCategory: null, section: "search" });
        });
    });

    describe("sending", () => {
        it("should upload the chosen GIF and send it as an image", async () => {
            const vm = await createLoadedViewModel();

            vm.sendGif("t1");
            expect(vm.getSnapshot().sendingId).toBe("t1");

            await vi.waitFor(() => expect(sendContentToRoom).toHaveBeenCalled());
            const [file, roomId, relation, sentWith, replyToEvent] = sendContentToRoom.mock.calls[0];
            expect(file).toBeInstanceOf(File);
            expect(file.name).toBe("t1 title.gif");
            expect(file.type).toBe("image/gif");
            expect(file.size).toBe(GIF_BYTES.length);
            expect(roomId).toBe("!room:example.org");
            expect(relation).toBeUndefined();
            expect(sentWith).toBe(client);
            expect(replyToEvent).toBeUndefined();

            const download = fetchMock.callHistory.lastCall()!;
            expect(download.url).toBe("https://media.example.net/t1/full.gif");
            expect(download.signal).toBeInstanceOf(AbortSignal);
            expect(addRecentGif).toHaveBeenCalledWith("fake", gif("t1"));
            expect(defaultDispatcher.dispatch).toHaveBeenCalledWith({
                action: Action.FocusSendMessageComposer,
                context: TimelineRenderingType.Room,
            });
            expect(onFinished).toHaveBeenCalled();
            expect(vm.getSnapshot().sendingId).toBeNull();
        });

        it("should send to the room that a local room became", async () => {
            const localRoom = mkStubRoom("local+new-dm", "New DM", client);
            vi.mocked(client.getRoom).mockReturnValue({
                isCreated: true,
                actualRoomId: "!created:example.org",
            } as unknown as Room);
            const vm = await createLoadedViewModel({ room: localRoom });

            vm.sendGif("t1");

            await vi.waitFor(() => expect(sendContentToRoom).toHaveBeenCalled());
            expect(sendContentToRoom.mock.calls[0][1]).toBe("!created:example.org");
        });

        it("should send to the thread and reply, then stop replying", async () => {
            const replyToEvent = mkMessage({ room: room.roomId, user: "@alice:example.org", event: true });
            const relation = { rel_type: "m.thread", event_id: "$root" };
            const vm = await createLoadedViewModel({
                relation,
                replyToEvent,
                timelineRenderingType: TimelineRenderingType.Thread,
            });

            vm.sendGif("t2");

            await vi.waitFor(() => expect(sendContentToRoom).toHaveBeenCalled());
            expect(sendContentToRoom).toHaveBeenCalledWith(
                expect.any(File),
                room.roomId,
                relation,
                client,
                replyToEvent,
            );
            expect(defaultDispatcher.dispatch).toHaveBeenCalledWith({
                action: "reply_to_event",
                event: null,
                context: TimelineRenderingType.Thread,
            });
        });

        it("should send a recent GIF", async () => {
            vi.mocked(getRecentGifs).mockReturnValue([gif("r1")]);
            const vm = await createLoadedViewModel();

            vm.sendGif("r1");

            await vi.waitFor(() => expect(sendContentToRoom).toHaveBeenCalled());
            expect(fetchMock.callHistory.lastCall()!.url).toBe("https://media.example.net/r1/full.gif");
        });

        it("should name the file after the GIF's title", async () => {
            provider.trending.mockResolvedValue({ results: [gif("a", 'Cats / dogs: "yes"?.GIF')], next: null });
            const vm = await createLoadedViewModel();

            vm.sendGif("a");
            await vi.waitFor(() => expect(sendContentToRoom).toHaveBeenCalledTimes(1));
            expect(sendContentToRoom.mock.calls[0][0].name).toBe("Cats dogs yes.gif");
        });

        it("should cut a long title without splitting a character", async () => {
            provider.trending.mockResolvedValue({ results: [gif("a", `${"a".repeat(59)}😀 and more`)], next: null });
            const vm = await createLoadedViewModel();

            vm.sendGif("a");
            await vi.waitFor(() => expect(sendContentToRoom).toHaveBeenCalledTimes(1));
            const { name } = sendContentToRoom.mock.calls[0][0];
            expect(name).toBe(`${"a".repeat(59)}😀.gif`);
            expect(() => encodeURIComponent(name)).not.toThrow();
        });

        it("should name the file after the GIF's id when the title is a reserved name", async () => {
            provider.trending.mockResolvedValue({ results: [gif("b", "CON")], next: null });
            const vm = await createLoadedViewModel();

            vm.sendGif("b");
            await vi.waitFor(() => expect(sendContentToRoom).toHaveBeenCalledTimes(1));
            expect(sendContentToRoom.mock.calls[0][0].name).toBe("b.gif");
        });

        it("should name the file after the GIF's id when it has no title", async () => {
            provider.trending.mockResolvedValue({ results: [gif("b", "  ")], next: null });
            const vm = await createLoadedViewModel();

            vm.sendGif("b");
            await vi.waitFor(() => expect(sendContentToRoom).toHaveBeenCalledTimes(1));
            expect(sendContentToRoom.mock.calls[0][0].name).toBe("b.gif");
        });

        it("should stay open and report a GIF which could not be downloaded", async () => {
            fetchMock.removeRoutes();
            fetchMock.get("begin:https://media.example.net/", 404);
            const vm = await createLoadedViewModel();

            vm.sendGif("t1");

            await vi.waitFor(() => expect(vm.getSnapshot().sendFailed).toBe(true));
            expect(vm.getSnapshot().sendingId).toBeNull();
            expect(sendContentToRoom).not.toHaveBeenCalled();
            expect(addRecentGif).not.toHaveBeenCalled();
            expect(onFinished).not.toHaveBeenCalled();
        });

        it("should forget a failed send when other GIFs are shown", async () => {
            fetchMock.removeRoutes();
            fetchMock.get("begin:https://media.example.net/", 404);
            const vm = await createLoadedViewModel();
            vm.sendGif("t1");
            await vi.waitFor(() => expect(vm.getSnapshot().sendFailed).toBe(true));

            vm.selectCategory("love");

            expect(vm.getSnapshot().sendFailed).toBe(false);
        });

        it("should not send a download which is not a GIF", async () => {
            fetchMock.removeRoutes();
            fetchMock.get("begin:https://media.example.net/", {
                body: "<html>Not found</html>",
                headers: { "Content-Type": "text/html" },
            });
            const vm = await createLoadedViewModel();

            vm.sendGif("t1");

            await vi.waitFor(() => expect(vm.getSnapshot().sendFailed).toBe(true));
            expect(sendContentToRoom).not.toHaveBeenCalled();
            expect(onFinished).not.toHaveBeenCalled();
        });

        it("should send one GIF at a time", async () => {
            fetchMock.removeRoutes();
            fetchMock.get("begin:https://media.example.net/", { body: GIF_BYTES }, { delay: 50 });
            const vm = await createLoadedViewModel();

            vm.sendGif("t1");
            vm.sendGif("t2");

            await vi.waitFor(() => expect(sendContentToRoom).toHaveBeenCalled());
            expect(fetchMock.callHistory.calls()).toHaveLength(1);
        });

        it("should ignore an unknown GIF", async () => {
            const vm = await createLoadedViewModel();

            vm.sendGif("nope");

            expect(vm.getSnapshot().sendingId).toBeNull();
            expect(fetchMock.callHistory.calls()).toHaveLength(0);
        });

        it("should ask guests to register instead", async () => {
            vi.mocked(client.isGuest).mockReturnValue(true);
            const vm = await createLoadedViewModel();

            vm.sendGif("t1");

            expect(defaultDispatcher.dispatch).toHaveBeenCalledWith({ action: "require_registration" });
            expect(fetchMock.callHistory.calls()).toHaveLength(0);
        });

        it("should stop downloading when disposed", async () => {
            fetchMock.removeRoutes();
            fetchMock.get("begin:https://media.example.net/", { body: GIF_BYTES }, { delay: 1000 });
            const vm = await createLoadedViewModel();

            vm.sendGif("t1");
            await vi.waitFor(() => expect(fetchMock.callHistory.calls()).toHaveLength(1));
            vm.dispose();

            expect(fetchMock.callHistory.lastCall()!.signal!.aborted).toBe(true);
            expect(sendContentToRoom).not.toHaveBeenCalled();
        });
    });
});
