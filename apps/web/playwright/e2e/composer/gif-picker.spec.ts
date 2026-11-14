/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { type Page } from "@playwright/test";

import { test, expect } from "../../element-web-test";
import { type ElementAppPage } from "../../pages/ElementAppPage";

/** The GIPHY API as a path on the client's origin, where a proxy that adds the key would sit. */
const GIF_API_PATH = "/gifs";
/** The host that the fake API answers serve the GIFs from. */
const MEDIA_HOST = "https://media.example.org";

interface FakeGif {
    id: string;
    title: string;
    /** The GIF file. */
    bytes: Buffer;
    width: number;
    height: number;
}

// Two animated GIFs of two frames each
const CAT: FakeGif = {
    id: "cat",
    title: "Dancing cat",
    bytes: Buffer.from(
        "R0lGODlhBAADAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAABAADAAAICAABCBxIUGBAACH5BAAUAAAALAAAAAAEAAMAgf//AAAAAAAAAAAAAAgIAAEIHEhQYEAAOw==",
        "base64",
    ),
    width: 4,
    height: 3,
};
const PARROT: FakeGif = {
    id: "parrot",
    title: "Party parrot",
    bytes: Buffer.from(
        "R0lGODlhAwAEAIEAAAAA/wAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAwAEAAAICAABCBxIUGBAACH5BAAUAAAALAAAAAADAAQAgQD/AAAAAAAAAAAAAAgIAAEIHEhQYEAAOw==",
        "base64",
    ),
    width: 3,
    height: 4,
};

/** A GIF Object of the GIPHY API, https://developers.giphy.com/docs/api/schema#gif-object */
function toGiphyObject(gif: FakeGif): Record<string, unknown> {
    const rendition = {
        url: `${MEDIA_HOST}/${gif.id}.gif`,
        width: String(gif.width),
        height: String(gif.height),
        size: String(gif.bytes.length),
    };
    return {
        type: "gif",
        id: gif.id,
        title: gif.title,
        alt_text: gif.title,
        images: { fixed_width_small: rendition, original: rendition },
    };
}

/**
 * Answer the trending and search endpoints of the GIPHY API with the given GIFs, and serve their files from
 * {@link MEDIA_HOST} the way a media host that allows cross-origin downloads does.
 */
async function fakeGiphy(page: Page, trending: FakeGif[], searches: Record<string, FakeGif[]>): Promise<void> {
    const answer = (gifs: FakeGif[]): Record<string, unknown> => ({
        data: gifs.map(toGiphyObject),
        pagination: { total_count: gifs.length, count: gifs.length, offset: 0 },
        meta: { status: 200, msg: "OK" },
    });
    const allGifs = [...trending, ...Object.values(searches).flat()];

    await page.route(
        (url) => url.pathname === `${GIF_API_PATH}/v1/gifs/trending`,
        (route) => route.fulfill({ json: answer(trending) }),
    );
    await page.route(
        (url) => url.pathname === `${GIF_API_PATH}/v1/gifs/search`,
        (route) => {
            const query = new URL(route.request().url()).searchParams.get("q") ?? "";
            return route.fulfill({ json: answer(searches[query] ?? []) });
        },
    );
    await page.route(`${MEDIA_HOST}/**`, (route) => {
        const gif = allGifs.find(({ id }) => new URL(route.request().url()).pathname === `/${id}.gif`);
        if (!gif) return route.fulfill({ status: 404 });
        return route.fulfill({
            body: gif.bytes,
            contentType: "image/gif",
            headers: { "Access-Control-Allow-Origin": "*" },
        });
    });
}

/** The last message in the room, once the server has accepted it. */
async function getLastSentMessage(
    app: ElementAppPage,
    roomId: string,
): Promise<{ eventId?: string; content?: Record<string, unknown> }> {
    return app.client.evaluate((client, roomId) => {
        const events = client.getRoom(roomId)?.getLiveTimeline().getEvents() ?? [];
        const message = events.findLast((event) => event.getType() === "m.room.message");
        return { eventId: message?.getId(), content: message?.getContent() };
    }, roomId);
}

test.describe("GIF picker", () => {
    test.use({
        displayName: "Alice",
        room: async ({ app, user }, use) => {
            const roomId = await app.client.createRoom({ name: "GIF room" });
            await app.viewRoomByName("GIF room");
            await use({ roomId });
        },
    });

    test.describe("with a GIF provider", () => {
        test.use({
            config: { gif_provider: { provider: "giphy", base_url: GIF_API_PATH } },
        });

        test("should send a GIF found by a search as an image", async ({ page, app, room }) => {
            await fakeGiphy(page, [CAT], { party: [PARROT] });

            await app.getComposer().getByRole("button", { name: "GIF" }).click();
            const picker = page.getByRole("region", { name: "GIF picker" });
            await expect(picker.getByRole("button", { name: CAT.title })).toBeVisible();
            await expect(picker.getByRole("img", { name: "Powered by GIPHY" })).toBeVisible();

            await picker.getByRole("searchbox", { name: "Search GIFs" }).fill("party");
            await expect(picker.getByRole("button", { name: CAT.title })).not.toBeVisible();
            await picker.getByRole("button", { name: PARROT.title }).click();
            await expect(picker).not.toBeVisible();

            await app.timeline.scrollToBottom();
            await expect(page.getByRole("img", { name: "Party parrot.gif" })).toBeVisible();
            // A sent event has its ID from the server, which starts with "$"
            await expect.poll(async () => (await getLastSentMessage(app, room.roomId)).eventId).toMatch(/^\$/);
            const { content } = await getLastSentMessage(app, room.roomId);
            expect(content).toMatchObject({
                msgtype: "m.image",
                body: "Party parrot.gif",
                info: { mimetype: "image/gif", w: PARROT.width, h: PARROT.height, size: PARROT.bytes.length },
            });
            // The GIF was uploaded to the homeserver: the event links to its copy, not to the provider
            expect(content!.url).toMatch(/^mxc:\/\//);
            expect(JSON.stringify(content)).not.toContain(MEDIA_HOST);
        });
    });

    test("should not offer GIFs without a GIF provider", async ({ app, room }) => {
        const composer = app.getComposer();
        await expect(composer.getByRole("button", { name: "Emoji" })).toBeVisible();
        await expect(composer.getByRole("button", { name: "GIF" })).toHaveCount(0);
    });
});
