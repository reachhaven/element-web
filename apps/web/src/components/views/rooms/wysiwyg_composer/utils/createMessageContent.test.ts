/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { MsgType } from "matrix-js-sdk/src/matrix";
import { initOnce } from "@vector-im/matrix-wysiwyg";

import { filterConsole, mkEvent } from "test-utils";
import { createMessageContent, EMOTE_PREFIX } from "./createMessageContent";
import { makeGenericPermalink, makeUserPermalink } from "../../../../../utils/permalinks/Permalinks";

beforeAll(initOnce, 10000);

describe("createMessageContent", () => {
    const sender = "@alice:example.org";
    const message = "<em><b>hello</b> world</em>";

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe("Richtext composer input", () => {
        filterConsole(
            "WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm`",
        );

        it("Should create html message", async () => {
            // When
            const content = await createMessageContent(sender, message, true, {});

            // Then
            expect(content).toEqual({
                "body": "*__hello__ world*",
                "format": "org.matrix.custom.html",
                "formatted_body": message,
                "msgtype": "m.text",
                "m.mentions": {},
            });
        });

        it("Should add relation to message", async () => {
            // When
            const relation = {
                rel_type: "m.thread",
                event_id: "myFakeThreadId",
            };
            const content = await createMessageContent(sender, message, true, { relation });

            // Then
            expect(content).toEqual({
                "body": "*__hello__ world*",
                "format": "org.matrix.custom.html",
                "formatted_body": message,
                "msgtype": "m.text",
                "m.mentions": {},
                "m.relates_to": {
                    event_id: "myFakeThreadId",
                    rel_type: "m.thread",
                },
            });
        });

        it("Should add fields related to edition", async () => {
            // When
            const editedEvent = mkEvent({
                type: "m.room.message",
                room: "myfakeroom",
                user: "myfakeuser2",
                content: {
                    "msgtype": "m.text",
                    "body": "First message",
                    "formatted_body": "<b>First Message</b>",
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "eventId",
                        },
                    },
                },
                event: true,
            });
            const content = await createMessageContent(sender, message, true, { editedEvent });

            // Then
            expect(content).toEqual({
                "body": "* *__hello__ world*",
                "format": "org.matrix.custom.html",
                "formatted_body": `* ${message}`,
                "msgtype": "m.text",
                "m.mentions": {},
                "m.new_content": {
                    "body": "*__hello__ world*",
                    "format": "org.matrix.custom.html",
                    "formatted_body": message,
                    "msgtype": "m.text",
                    "m.mentions": {},
                },
                "m.relates_to": {
                    event_id: editedEvent.getId(),
                    rel_type: "m.replace",
                },
            });
        });

        it("Should strip the /me prefix from a message", async () => {
            const textBody = "some body text";
            const content = await createMessageContent(sender, EMOTE_PREFIX + textBody, true, {});

            expect(content).toMatchObject({ body: textBody, formatted_body: textBody });
        });

        it("Should strip single / from message prefixed with //", async () => {
            const content = await createMessageContent(sender, "//twoSlashes", true, {});

            expect(content).toMatchObject({ body: "/twoSlashes", formatted_body: "/twoSlashes" });
        });

        it("Should set the content type to MsgType.Emote when /me prefix is used", async () => {
            const textBody = "some body text";
            const content = await createMessageContent(sender, EMOTE_PREFIX + textBody, true, {});

            expect(content).toMatchObject({ msgtype: MsgType.Emote });
        });

        describe("mentions", () => {
            // The rich text mode writes a user or room pill as a plain link to its permalink, and the at-room
            // pill as the text "@room".
            const bob = `<a href="${makeUserPermalink("@bob:example.org")}">Bob</a>`;
            const carol = `<a href="${makeUserPermalink("@carol:example.org")}">Carol</a>`;

            it("Should mention the users of user pills", async () => {
                const content = await createMessageContent(sender, `${bob} and ${carol} `, true, {});

                expect(content["m.mentions"]).toEqual({ user_ids: ["@bob:example.org", "@carol:example.org"] });
            });

            it("Should mention the room for an at-room pill", async () => {
                const content = await createMessageContent(sender, "hello @room ", true, {});

                expect(content["m.mentions"]).toEqual({ room: true });
            });

            it("Should not mention the sender", async () => {
                const alice = `<a href="${makeUserPermalink(sender)}">Alice</a>`;
                const content = await createMessageContent(sender, `${alice} and ${bob} `, true, {});

                expect(content["m.mentions"]).toEqual({ user_ids: ["@bob:example.org"] });
            });

            it("Should mention the sender of the replied-to event", async () => {
                const replyToEvent = mkEvent({
                    type: "m.room.message",
                    room: "!room:example.org",
                    user: "@carol:example.org",
                    content: { msgtype: "m.text", body: "Hello" },
                    event: true,
                });
                const content = await createMessageContent(sender, `${bob} `, true, { replyToEvent });

                expect(content["m.mentions"]).toEqual({ user_ids: ["@carol:example.org", "@bob:example.org"] });
            });

            it("Should only mention newly mentioned users outside the new content of an edit", async () => {
                const editedEvent = mkEvent({
                    type: "m.room.message",
                    room: "!room:example.org",
                    user: sender,
                    content: { "msgtype": "m.text", "body": "Bob", "m.mentions": { user_ids: ["@bob:example.org"] } },
                    event: true,
                });
                const content = await createMessageContent(sender, `${bob} and ${carol} `, true, { editedEvent });

                expect(content).toEqual(
                    expect.objectContaining({
                        "m.mentions": { user_ids: ["@carol:example.org"] },
                        "m.new_content": expect.objectContaining({
                            "m.mentions": { user_ids: ["@bob:example.org", "@carol:example.org"] },
                        }),
                    }),
                );
            });

            it("Should not mention a room linked in the message", async () => {
                const lobby = `<a href="${makeGenericPermalink("#lobby:example.org")}">#lobby:example.org</a>`;
                const content = await createMessageContent(sender, `${lobby} `, true, {});

                expect(content["m.mentions"]).toEqual({});
            });

            it("Should ignore a link that is not a user permalink", async () => {
                const link = '<a href="https://example.org/">@bob:example.org</a>';
                const content = await createMessageContent(sender, `${link} `, true, {});

                expect(content["m.mentions"]).toEqual({});
            });

            it("Should only mention the room for @room on its own", async () => {
                // A user whose name reads "@room", and "@room" at the start of a longer word.
                const named = `<a href="${makeUserPermalink("@bob:example.org")}">@room</a>`;
                const content = await createMessageContent(sender, `${named} and @roommates `, true, {});

                expect(content["m.mentions"]).toEqual({ user_ids: ["@bob:example.org"] });
            });
        });
    });

    describe("Plaintext composer input", () => {
        it("Should replace at-room mentions with `@room` in body", async () => {
            const messageComposerState = `<a href="#" contenteditable="false" data-mention-type="at-room" style="some styling">@room</a> `;

            const content = await createMessageContent(sender, messageComposerState, false, {});
            expect(content).toMatchObject({ body: "@room " });
        });

        it("Should replace user mentions with user name in body", async () => {
            const messageComposerState = `<a href="https://matrix.to/#/@test_user:element.io" contenteditable="false" data-mention-type="user" style="some styling">a test user</a> `;

            const content = await createMessageContent(sender, messageComposerState, false, {});

            expect(content).toMatchObject({ body: "a test user " });
        });

        it("Should replace room mentions with room mxid in body", async () => {
            const messageComposerState = `<a href="https://matrix.to/#/#test_room:element.io" contenteditable="false" data-mention-type="room" style="some styling">a test room</a> `;

            const content = await createMessageContent(sender, messageComposerState, false, {});

            expect(content).toMatchObject({
                body: "#test_room:element.io ",
            });
        });

        it("Should mention the user of a user mention", async () => {
            const messageComposerState = `<a href="${makeUserPermalink("@bob:example.org")}" contenteditable="false" data-mention-type="user" style="some styling">Bob</a> `;

            const content = await createMessageContent(sender, messageComposerState, false, {});

            expect(content["m.mentions"]).toEqual({ user_ids: ["@bob:example.org"] });
        });

        it("Should mention the room for an at-room mention", async () => {
            const messageComposerState = `<a href="#" contenteditable="false" data-mention-type="at-room" style="some styling">@room</a> `;

            const content = await createMessageContent(sender, messageComposerState, false, {});

            expect(content["m.mentions"]).toEqual({ room: true });
        });
    });
});
