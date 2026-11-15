/*
Copyright 2024 New Vector Ltd.
Copyright 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";
import { getSampleFilePath } from "../../sample-files";

test.describe("Image Upload", () => {
    test.use({
        displayName: "Alice",
    });

    test.beforeEach(async ({ page, app, user }) => {
        await app.client.createRoom({ name: "My Pictures" });
        await app.viewRoomByName("My Pictures");

        // Wait until configuration is finished
        await expect(
            page
                .locator(".mx_GenericEventListSummary[data-layout='group'] .mx_GenericEventListSummary_summary")
                .getByText(`${user.displayName} created and configured the room.`),
        ).toBeVisible();
    });

    test("should show image preview when uploading an image", { tag: "@screenshot" }, async ({ page, app }) => {
        await app.setComposerInputFiles("room", getSampleFilePath("riot.png"));

        await expect(page.getByRole("button", { name: "Upload" })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Close dialog" })).toBeEnabled();
        await expect(page.locator(".mx_Dialog")).toMatchScreenshot("image-upload-preview.png");
    });

    test("should allow upload via drag and drop", { tag: "@screenshot" }, async ({ page, app }) => {
        await app.composerDragAndUploadFiles("room", getSampleFilePath("riot.png"), "image/png");
        await app.timeline.scrollToBottom();
        const imgTile = page.locator(".mx_ImageBody").first();
        await expect(imgTile).toBeVisible();
    });

    test("should send an image with a caption", async ({ page, app }) => {
        await app.setComposerInputFiles("room", getSampleFilePath("riot.png"));
        // The caption field has the focus: typing writes the caption and Enter uploads the image
        await expect(page.getByRole("dialog").getByRole("textbox", { name: "Caption (optional)" })).toBeFocused();
        await page.keyboard.type("The **new** logo");
        await page.keyboard.press("Enter");

        await app.timeline.scrollToBottom();
        const tile = page.locator(".mx_EventTile").filter({ has: page.locator(".mx_ImageBody") });
        await expect(tile.locator(".mx_ImageBody")).toBeVisible();
        await expect(tile.locator(".mx_EventTile_caption")).toHaveText("The new logo");
        await expect(tile.locator(".mx_EventTile_caption strong")).toHaveText("new");

        // The caption is the body, and the file keeps its name in filename
        const roomId = await app.getCurrentRoomIdFromUrl();
        await expect
            .poll(() =>
                app.client.evaluate(
                    (client, roomId) =>
                        client
                            .getRoom(roomId)
                            ?.getLiveTimeline()
                            .getEvents()
                            .findLast((event) => event.getType() === "m.room.message")
                            ?.getContent(),
                    roomId,
                ),
            )
            .toMatchObject({
                msgtype: "m.image",
                body: "The **new** logo",
                filename: "riot.png",
                format: "org.matrix.custom.html",
                formatted_body: "The <strong>new</strong> logo",
            });
    });
});
