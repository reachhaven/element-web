/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "vitest-canvas-mock";
import fetchMock from "@fetch-mock/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "test-utils-rtl";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { createTestClient, getRoomContext, mkStubRoom } from "test-utils";

import { GifButton } from "./GifButton";
import { OverflowMenuContext } from "./CollapsibleButton";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { ScopedRoomContextProvider } from "../../../contexts/ScopedRoomContext";
import ContentMessages from "../../../ContentMessages";
import SettingsStore from "../../../settings/SettingsStore";
import { GiphyProvider } from "../../../gifs/GiphyProvider";

vi.mock("../../../BlurhashEncoder", () => ({
    BlurhashEncoder: { instance: { getBlurhash: vi.fn().mockResolvedValue("blurhash") } },
}));

const BASE_URL = "https://gifs.example.org/giphy";
const ONE_PIXEL_GIF_BYTES = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) =>
    c.charCodeAt(0),
);

function giphyGif(id: string, title: string): Record<string, unknown> {
    return {
        id,
        title,
        images: {
            fixed_width_small: { url: `https://media.example.net/${id}/100w.gif`, width: "100", height: "80" },
            original: { url: `https://media.example.net/${id}/giphy.gif`, width: "400", height: "320", size: "10" },
        },
    };
}

describe("GifButton", () => {
    let client: MatrixClient;
    let room: Room;

    beforeEach(() => {
        client = createTestClient();
        room = mkStubRoom("!room:example.org", "Room", client);
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/trending`, {
            data: [giphyGif("cat", "A cat"), giphyGif("dog", "A dog")],
            pagination: { total_count: 2, count: 2, offset: 0 },
        });
        fetchMock.get(`begin:${BASE_URL}/v1/gifs/search`, {
            data: [giphyGif("party", "A party")],
            pagination: { total_count: 1, count: 1, offset: 0 },
        });
        fetchMock.get("begin:https://media.example.net/", {
            body: ONE_PIXEL_GIF_BYTES,
            headers: { "Content-Type": "image/gif" },
        });
        vi.spyOn(SettingsStore, "setValue").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function renderButton(): void {
        render(
            <MatrixClientContext.Provider value={client}>
                <ScopedRoomContextProvider {...getRoomContext(room, {})}>
                    <GifButton provider={new GiphyProvider(BASE_URL, "key")} room={room} />
                </ScopedRoomContextProvider>
            </MatrixClientContext.Provider>,
        );
    }

    it("should open the picker on the trending GIFs", async () => {
        renderButton();

        await userEvent.click(screen.getByRole("button", { name: "GIF" }));

        expect(await screen.findByRole("button", { name: "A cat" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "A dog" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Trending" })).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "Powered by GIPHY" })).toBeInTheDocument();
    });

    it("should search for GIFs", async () => {
        renderButton();
        await userEvent.click(screen.getByRole("button", { name: "GIF" }));

        await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "party");

        expect(await screen.findByRole("button", { name: "A party" })).toBeInTheDocument();
        const search = fetchMock.callHistory.calls().filter((call) => call.url.includes("/v1/gifs/search"));
        expect(search).toHaveLength(1);
        expect(new URL(search[0].url).searchParams.get("q")).toBe("party");
    });

    it("should send the chosen GIF as an image file and close the picker", async () => {
        const sendContentToRoom = vi
            .spyOn(ContentMessages.sharedInstance(), "sendContentToRoom")
            .mockResolvedValue(undefined);
        renderButton();
        await userEvent.click(screen.getByRole("button", { name: "GIF" }));

        await userEvent.click(await screen.findByRole("button", { name: "A cat" }));

        await waitFor(() => expect(sendContentToRoom).toHaveBeenCalled());
        const [file, roomId] = sendContentToRoom.mock.calls[0];
        expect(file).toBeInstanceOf(File);
        expect(file.type).toBe("image/gif");
        expect(file.name).toBe("A cat.gif");
        expect(roomId).toBe("!room:example.org");
        await waitFor(() => expect(screen.queryByRole("region", { name: "GIF picker" })).not.toBeInTheDocument());
    });

    it("should open from the overflow menu and close it once a GIF is sent", async () => {
        vi.spyOn(ContentMessages.sharedInstance(), "sendContentToRoom").mockResolvedValue(undefined);
        const closeOverflowMenu = vi.fn();
        render(
            <MatrixClientContext.Provider value={client}>
                <ScopedRoomContextProvider {...getRoomContext(room, {})}>
                    <OverflowMenuContext.Provider value={closeOverflowMenu}>
                        <GifButton provider={new GiphyProvider(BASE_URL, "key")} room={room} />
                    </OverflowMenuContext.Provider>
                </ScopedRoomContextProvider>
            </MatrixClientContext.Provider>,
        );

        await userEvent.click(screen.getByRole("menuitem", { name: "GIF" }));
        await userEvent.click(await screen.findByRole("button", { name: "A cat" }));

        await waitFor(() => expect(closeOverflowMenu).toHaveBeenCalled());
    });

    describe("with the real upload path", () => {
        beforeEach(() => {
            vi.stubGlobal("OffscreenCanvas", undefined);
            Object.defineProperty(globalThis.Image.prototype, "src", {
                configurable: true,
                set() {
                    window.setTimeout(() => this.onload());
                },
            });
            Object.defineProperty(globalThis.Image.prototype, "width", { configurable: true, get: () => 400 });
            Object.defineProperty(globalThis.Image.prototype, "height", { configurable: true, get: () => 320 });
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://example.org/gif" });
        });

        afterEach(() => {
            for (const property of ["src", "width", "height"]) {
                delete (globalThis.Image.prototype as unknown as Record<string, unknown>)[property];
            }
            vi.unstubAllGlobals();
        });

        it("should send an m.image of the uploaded file, without the provider's URLs", async () => {
            renderButton();
            await userEvent.click(screen.getByRole("button", { name: "GIF" }));

            await userEvent.click(await screen.findByRole("button", { name: "A cat" }));

            await waitFor(() => expect(client.sendMessage).toHaveBeenCalled());
            const [roomId, threadId, content] = vi.mocked(client.sendMessage).mock.calls[0] as unknown as [
                string,
                string | null,
                Record<string, unknown>,
            ];
            expect(roomId).toBe("!room:example.org");
            expect(threadId).toBeNull();
            expect(content).toMatchObject({
                msgtype: "m.image",
                body: "A cat.gif",
                url: "mxc://example.org/gif",
                info: { mimetype: "image/gif", size: ONE_PIXEL_GIF_BYTES.length, w: 400, h: 320 },
            });
            expect(JSON.stringify(content)).not.toContain("example.net");
            expect(JSON.stringify(content)).not.toContain("gifs.example.org");
            expect(vi.mocked(client.uploadContent).mock.calls[0][0]).toBeInstanceOf(File);
        });
    });
});
