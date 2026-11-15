/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { richToPlain, plainToRich } from "@vector-im/matrix-wysiwyg";
import { type IEventRelation, type IMentions, MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import {
    type ReplacementEvent,
    type RoomMessageEventContent,
    type RoomMessageTextEventContent,
} from "matrix-js-sdk/src/types";

import SettingsStore from "../../../../../settings/SettingsStore";
import { parsePermalink } from "../../../../../utils/permalinks/Permalinks";
import { addReplyToMessageContent } from "../../../../../utils/Reply";
import { isNotNull } from "../../../../../Typeguards";
import { attachMentions, attachRelation } from "../../../../../utils/messages";

export const EMOTE_PREFIX = "/me ";

interface CreateMessageContentParams {
    relation?: IEventRelation;
    replyToEvent?: MatrixEvent;
    editedEvent?: MatrixEvent;
}

const isMatrixEvent = (e: MatrixEvent | undefined): e is MatrixEvent => e instanceof MatrixEvent;

export async function createMessageContent(
    sender: string,
    message: string,
    isHTML: boolean,
    { relation, replyToEvent, editedEvent }: CreateMessageContentParams,
): Promise<RoomMessageEventContent> {
    const isEditing = isMatrixEvent(editedEvent);

    const isEmote = message.startsWith(EMOTE_PREFIX);
    if (isEmote) {
        // if we are dealing with an emote we want to remove the prefix so that `/me` does not
        // appear after the `* <userName>` text in the timeline
        message = message.slice(EMOTE_PREFIX.length);
    }
    if (message.startsWith("//")) {
        // if user wants to enter a single slash at the start of a message, this
        // is how they have to do it (due to it clashing with commands), so here we
        // remove the first character to make sure //word displays as /word
        message = message.slice(1);
    }

    // if we're editing rich text, the message content is pure html
    // BUT if we're not, the message content will be plain text where we need to convert the mentions
    const body = isHTML ? await richToPlain(message, false) : convertPlainTextToBody(message);

    const content = {
        msgtype: isEmote ? MsgType.Emote : MsgType.Text,
        body: isEditing ? `* ${body}` : body,
    } as RoomMessageTextEventContent & ReplacementEvent<RoomMessageTextEventContent>;

    // TODO markdown support

    const isMarkdownEnabled = SettingsStore.getValue("MessageComposerInput.useMarkdown");
    const formattedBody = isHTML ? message : isMarkdownEnabled ? await plainToRich(message, true) : null;

    if (formattedBody) {
        content.format = "org.matrix.custom.html";
        content.formatted_body = isEditing ? `* ${formattedBody}` : formattedBody;
    }

    if (isEditing) {
        content["m.new_content"] = {
            msgtype: content.msgtype,
            body: body,
        };

        if (formattedBody) {
            content["m.new_content"].format = "org.matrix.custom.html";
            content["m.new_content"]["formatted_body"] = formattedBody;
        }
    }

    const newRelation = isEditing ? { ...relation, rel_type: "m.replace", event_id: editedEvent.getId() } : relation;

    // Build the mentions properties for the content and, when editing, for the new content.
    attachMentions(sender, content, mentionsInHtml(message), replyToEvent, isEditing ? editedEvent.getContent() : null);
    attachRelation(content, newRelation);

    if (!isEditing && replyToEvent) {
        addReplyToMessageContent(content, replyToEvent);
    }

    return content;
}

/**
 * Without a model, we need to manually amend mentions in uncontrolled message content
 * to make sure that mentions meet the matrix specification.
 *
 * @param content - the output from the `MessageComposer` state when in plain text mode
 * @returns - a string formatted with the mentions replaced as required
 */
function convertPlainTextToBody(content: string): string {
    const document = new DOMParser().parseFromString(content, "text/html");
    const mentions = Array.from(document.querySelectorAll("a[data-mention-type]"));

    mentions.forEach((mention) => {
        const mentionType = mention.getAttribute("data-mention-type");
        switch (mentionType) {
            case "at-room": {
                mention.replaceWith("@room");
                break;
            }
            case "user": {
                const innerText = mention.innerHTML;
                mention.replaceWith(innerText);
                break;
            }
            case "room": {
                // for this case we use parsePermalink to try and get the mx id
                const href = mention.getAttribute("href");

                // if the mention has no href attribute, leave it alone
                if (href === null) break;

                // otherwise, attempt to parse the room alias or id from the href
                const permalinkParts = parsePermalink(href);

                // then if we have permalink parts with a valid roomIdOrAlias, replace the
                // room mention with that text
                if (isNotNull(permalinkParts) && isNotNull(permalinkParts.roomIdOrAlias)) {
                    mention.replaceWith(permalinkParts.roomIdOrAlias);
                }
                break;
            }
            default:
                break;
        }
    });

    return document.body.innerHTML;
}

/**
 * Find the users and the room that a message mentions, to pass to `attachMentions`.
 *
 * The rich text mode writes a user pill as a plain link to the user's permalink and the at-room pill as the text
 * "@room", leaving no other trace of the pills. So any link to a user's permalink mentions that user and "@room"
 * mentions the room, as when the editor reads a message back in to edit it. The plain text mode writes a user pill
 * as the same link with extra attributes, and the at-room pill as a link whose text is "@room".
 *
 * @param html - the message from either composer mode
 * @returns the mentioned users, in the order they first appear, and whether the room is mentioned
 */
function mentionsInHtml(html: string): IMentions {
    const document = new DOMParser().parseFromString(html, "text/html");
    const userIds = new Set<string>();

    for (const link of document.querySelectorAll("a[href]")) {
        const permalink = parsePermalink(link.getAttribute("href")!);
        if (permalink?.userId) userIds.add(permalink.userId);
        // The text of a user or room pill is a name, which does not mention the room even if it reads "@room".
        if (permalink) link.remove();
    }

    // Only "@room" as a whole word mentions the room, so "@roommates" or an email address does not.
    const room = /(?<!\w)@room(?!\w)/.test(document.body.textContent ?? "");

    return { user_ids: [...userIds], room };
}
