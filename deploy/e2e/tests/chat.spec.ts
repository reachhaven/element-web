// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { expect, test, type Locator, type Page } from "@playwright/test";

import { clientConfig } from "../src/client-config";
import {
    arrives,
    attach,
    closeDialog,
    closeRightPanel,
    composer,
    dialog,
    findPerson,
    focusComposer,
    formattingButton,
    gifButton,
    homeButton,
    invitationItem,
    mentionQuery,
    messageAction,
    messageTile,
    moreOptions,
    openRoom,
    react,
    reaction,
    readBy,
    roomHeading,
    roomHeader,
    roomInfo,
    roomListItem,
    say,
    scrollBackTo,
    sendButton,
    showInvites,
    spaceButton,
    openNewMenu,
    startFromRoomList,
    suggestion,
    submitInvite,
    threadPanel,
    tileWithImage,
    timeline,
    typeInto,
    write,
} from "../src/element";
import { settings } from "../src/env";
import { mediaFile } from "../src/media";
import { closeSession, openSession, type Session } from "../src/session";
import {
    confirmIdentity,
    hasRecovery,
    knownRecoveryKey,
    resetIdentity,
    setUpRecovery,
    signIn,
    signOut,
} from "../src/sign-in";
import { step } from "../src/steps";

test.describe.configure({ mode: "serial" });

const [personA, personB] = settings.people;
const A = personA.displayName;
const B = personB.displayName;
const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
const room = settings.roomName ?? `Launch room ${stamp}`;
const renamed = `${room} for Friday`;
const runTime = settings.roomName ? "" : ` (${stamp})`;

const text = {
    hello: `Hi ${B}, welcome to the launch room.`,
    answer: `Thanks ${A}, glad to be here!`,
    notes: { bold: "Release notes", code: "build 42", block: "const answer = 42" },
    shortcuts: { bold: "Looks good", code: "npm test", block: "echo done" },
    reply: "Count me in for Friday.",
    thread: "Let us keep the release talk in this thread.",
    threadAnswer: "Good idea, I will post the build here.",
    mention: "Can you check the build tonight,",
    png: "Our hills at noon",
    pngEdited: "Our hills at noon, from the roof",
    video: "A six second test clip",
    dmHello: `Hi ${A}, a quick word in private${runTime}.`,
    dmAnswer: `Sure, go ahead${runTime}.`,
    dmImage: `The view from my desk${runTime}`,
    poll: "Where do we meet on Friday?",
    pollOptions: ["At the office", "Online"],
    topic: "Plans for the Friday release",
    back: "Back again, and the history is all here.",
};

let a: Session;
let b: Session;
let space = settings.space;

const both = (): Session[] => [a, b];

const signInAndSecure = async (session: Session): Promise<void> => {
    const arrival = await step(`${session.name} signs in`, () => signIn(session));
    if (arrival === "confirm identity") {
        const confirmed =
            knownRecoveryKey(session) &&
            (await step(`${session.name} confirms the digital identity with the recovery key`, async ({ skip }) =>
                (await confirmIdentity(session)) ? true : skip("the stored recovery key no longer fits the account"),
            ));
        if (confirmed) return;
        await step(`${session.name} resets the digital identity`, () => resetIdentity(session));
    }
    await step(`${session.name} creates a recovery key in the encryption settings`, async ({ skip }) => {
        if (await hasRecovery(session.page)) {
            await closeDialog(session.page);
            skip("the account has a recovery key already");
        }
        await setUpRecovery(session);
    });
};

const showSpace = async (page: Page): Promise<void> => {
    await (space ? spaceButton(page, space) : homeButton(page)).click();
};

const findInRoomList = async (page: Page, item: Locator): Promise<void> => {
    const views = [space ? spaceButton(page, space) : homeButton(page), homeButton(page)];
    let attempt = 0;
    await expect(async () => {
        if (!(await item.first().isVisible())) {
            await views[attempt++ % views.length].click();
            await showInvites(page);
            await expect(item.first()).toBeVisible({ timeout: 5_000 });
        }
    }).toPass({ timeout: 90_000 });
};

const findInvitation = async (page: Page, name: string): Promise<Locator> => {
    const invitation = invitationItem(page, name);
    await findInRoomList(page, invitation);
    return invitation;
};

test.beforeAll(async ({ browser }) => {
    a = await openSession(browser, personA);
    b = await openSession(browser, personB);
});

test.afterAll(async () => {
    test.setTimeout(120_000);
    try {
        if (a) await closeSession(a);
    } finally {
        if (b) await closeSession(b);
    }
});

test("1. Both sign in", async () => {
    await signInAndSecure(a);
    await signInAndSecure(b);

    await step(`Both see the space ${space ?? ""}`.trim(), async ({ skip, note }) => {
        const name = space ?? skip("no organisation in the state file, so there is no space to show");
        const title = settings.spaceTitle;
        for (const { page } of both()) {
            const named = title ? spaceButton(page, name).or(spaceButton(page, title)) : spaceButton(page, name);
            await expect(named).toBeVisible({ timeout: 120_000 });
        }
        if (title && (await spaceButton(a.page, title).isVisible())) {
            note(`The space is called ${title} already.`);
            space = title;
        }
    });

    for (const [seeker, sought] of [
        [a, personB],
        [b, personA],
    ] as const) {
        await step(`${seeker.name} finds ${sought.displayName}`, async () => {
            await startFromRoomList(seeker.page, "Start chat");
            await findPerson(seeker.page, sought);
            await closeDialog(seeker.page);
        });
    }
});

test("2. A room for both", async () => {
    if (space) {
        const current = space;
        const naming = settings.spaceTitle ? `${A} names the space ${settings.spaceTitle}` : `${A} names the space`;
        await step(naming, async ({ skip }) => {
            const title = settings.spaceTitle ?? skip(`the organisation has no name other than "${current}"`);
            if (current === title) skip(`the space is called ${title} already`);
            await spaceButton(a.page, current).click({ button: "right" });
            const settingsItem = a.page.getByRole("menuitem", { name: "Settings", exact: true });
            await expect(a.page.getByRole("menuitem", { name: "Space home", exact: true })).toBeVisible();
            if (!(await settingsItem.isVisible())) {
                await a.page.keyboard.press("Escape");
                skip(`${A} may not change the settings of ${current}`);
            }
            await settingsItem.click();
            const spaceSettings = dialog(a.page);
            const name = spaceSettings.getByRole("textbox", { name: "Name", exact: true });
            if (!(await name.isEditable())) {
                await closeDialog(a.page);
                skip(`${A} may not rename ${current}`);
            }
            await name.clear();
            await typeInto(name, title);
            await spaceSettings.getByRole("button", { name: "Save Changes", exact: true }).click();
            await expect(spaceSettings.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
            await closeDialog(a.page);
            for (const { page } of both()) await expect(spaceButton(page, title)).toBeVisible({ timeout: 60_000 });
            space = title;
        });
    }

    await step(`${A} creates the room "${room}"${space ? " in the space" : ""}`, async ({ note }) => {
        const { page } = a;
        await showSpace(page);
        await openNewMenu(page);
        const newRoom = page.getByRole("menuitem", { name: "New room", exact: true });
        if (space && !(await newRoom.isVisible())) {
            note(`${A} may not add rooms to the space, so the room is created outside it.`);
            await page.keyboard.press("Escape");
            await homeButton(page).click();
            await openNewMenu(page);
        }
        await newRoom.click();
        const create = dialog(page);
        await typeInto(create.getByRole("textbox", { name: "Name", exact: true }), room);
        await create.getByRole("button", { name: "Create room", exact: true }).click();
        await expect(create).toBeHidden();
        await expect(roomHeading(page)).toHaveText(room);
    });

    await step(`${A} invites ${B}`, async () => {
        const { page } = a;
        const panel = await roomInfo(page);
        await panel.getByRole("menuitem", { name: "Invite", exact: true }).click();
        const option = await findPerson(page, personB);
        await option.click();
        await submitInvite(page, "Invite");
        await closeRightPanel(page);
    });

    await step(`${B} accepts the invitation`, async () => {
        const { page } = b;
        await (await findInvitation(page, room)).click();
        await page.getByRole("button", { name: "Accept", exact: true }).click();
        await expect(composer(page)).toBeVisible({ timeout: 60_000 });
        await expect(roomHeading(page)).toHaveText(room);
    });

    await step("Both see that the room is encrypted", async () => {
        for (const { page } of both()) {
            const panel = await roomInfo(page);
            await expect(panel.getByText("Encrypted", { exact: true })).toBeVisible();
        }
        for (const { page } of both()) await closeRightPanel(page);
    });
});

test("3. Messages both ways", async () => {
    await step(`${A} says hello`, async () => {
        await say(a.page, text.hello);
        await arrives(messageTile(timeline(b.page), text.hello));
    });

    await step(`${B} answers`, async () => {
        await say(b.page, text.answer);
        await arrives(messageTile(timeline(a.page), text.answer));
    });

    await step(`${A} formats release notes with the formatting buttons`, async () => {
        const { page } = a;
        const field = await focusComposer(page);
        const format = async (button: "Bold" | "Code" | "Code block", typed: string): Promise<void> => {
            await formattingButton(page, button).click();
            await field.pressSequentially(typed, settings.typing);
        };
        await format("Bold", text.notes.bold);
        await formattingButton(page, "Bold").click();
        await field.pressSequentially(" for ", settings.typing);
        await format("Code", text.notes.code);
        await formattingButton(page, "Code").click();
        await field.press("Shift+Enter");
        await format("Code block", text.notes.block);
        await expect(field.locator("strong")).toHaveText(text.notes.bold);
        await expect(field.locator("code").first()).toHaveText(text.notes.code);
        await expect(field.locator("pre")).toHaveText(text.notes.block);
        await sendButton(page).click();
        await expect(field).toHaveText("");
    });

    await step("Both see bold text, inline code and a code block", async () => {
        for (const session of both()) {
            const tile = messageTile(timeline(session.page), text.notes.bold);
            await arrives(tile);
            const body = tile.getByTestId("event-tile-slot-body");
            await expect(body.locator("strong")).toHaveText(text.notes.bold);
            await expect(body.locator("code").filter({ hasText: text.notes.code })).toHaveText(text.notes.code);
            await expect(body.locator("pre")).toContainText(text.notes.block);
        }
    });

    await step(`${B} copies the code block`, async () => {
        const { page } = b;
        const block = messageTile(timeline(b.page), text.notes.bold).locator("pre");
        await page.evaluate(() => navigator.clipboard.writeText(""));
        await block.hover();
        await messageTile(timeline(b.page), text.notes.bold).getByRole("button", { name: "Copy", exact: true }).click();
        await expect(page.getByText("Copied!", { exact: true })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text.notes.block);
    });

    await step(`${B} answers in bold and inline code with Ctrl+B and Ctrl+E`, async () => {
        const { page } = b;
        const field = await focusComposer(page);
        await field.press("ControlOrMeta+b");
        await field.pressSequentially(text.shortcuts.bold, settings.typing);
        await field.press("ControlOrMeta+b");
        await field.pressSequentially(", ", settings.typing);
        await field.press("ControlOrMeta+e");
        await field.pressSequentially(text.shortcuts.code, settings.typing);
        await field.press("ControlOrMeta+e");
        await field.pressSequentially(" passes.", settings.typing);
        await expect(field.locator("strong")).toHaveText(text.shortcuts.bold);
        await expect(field.locator("code")).toHaveText(text.shortcuts.code);
        await field.press("Enter");
        const tile = messageTile(timeline(a.page), text.shortcuts.bold);
        await arrives(tile);
        await expect(tile.getByTestId("event-tile-slot-body").locator("strong")).toHaveText(text.shortcuts.bold);
        await expect(tile.getByTestId("event-tile-slot-body").locator("code")).toHaveText(text.shortcuts.code);
    });

    await step(`${B} starts a code block with a keyboard shortcut`, async () => {
        const { page } = b;
        const field = await focusComposer(page);
        await page.keyboard.press("Control+Alt+c");
        await field.pressSequentially(text.shortcuts.block, settings.typing);
        await expect(field.locator("pre")).toHaveText(text.shortcuts.block);
        await sendButton(page).click();
        await expect(field).toHaveText("");
        const tile = messageTile(timeline(a.page), text.shortcuts.block);
        await arrives(tile);
        await expect(tile.locator("pre")).toBeVisible();
    });
});

test("4. Replies, a thread, a mention and read receipts", async () => {
    await step(`${B} replies to ${A}'s greeting`, async () => {
        await messageAction(messageTile(timeline(b.page), text.hello), "Reply");
        await write(b.page, text.reply);
        await b.page.keyboard.press("Enter");
        const reply = messageTile(timeline(a.page), text.reply);
        await arrives(reply);
        await expect(reply.getByTestId("event-tile-slot-replyChain")).toContainText(text.hello);
    });

    await step(`${A} starts a thread on ${B}'s answer`, async () => {
        await messageAction(messageTile(timeline(a.page), text.answer), "Reply in thread");
        await expect(composer(a.page, "thread")).toBeVisible();
        await say(a.page, text.thread, "thread");
    });

    await step(`${B} opens the thread from the threads list and answers`, async () => {
        const { page } = b;
        await roomHeader(page).getByRole("button", { name: "Threads", exact: true }).click();
        const root = messageTile(threadPanel(page), text.answer);
        await expect(root).toBeVisible({ timeout: 60_000 });
        await root.click();
        await arrives(messageTile(threadPanel(page), text.thread));
        await say(page, text.threadAnswer, "thread");
        await arrives(messageTile(threadPanel(a.page), text.threadAnswer));
    });

    await step("Both close the thread and see its summary", async () => {
        for (const { page } of both()) await closeRightPanel(page);
        for (const session of both()) {
            const summary = messageTile(timeline(session.page), text.answer).getByTestId("event-tile-slot-threadInfo");
            await expect(summary).toContainText(text.threadAnswer);
        }
    });

    await step(`${A} mentions ${B}`, async () => {
        const { page } = a;
        await write(page, `${text.mention} ${mentionQuery(personB)}`);
        await suggestion(page, personB).first().click();
        await expect(composer(page).getByText(B)).toBeVisible();
        await sendButton(page).click();
        const tile = messageTile(timeline(b.page), text.mention);
        await arrives(tile);
        await expect(tile.getByTestId("event-tile-slot-body").getByText(B)).toBeVisible();
    });

    await step(`${A} sees that ${B} has read it`, async () => {
        await messageTile(timeline(b.page), text.mention).hover();
        await expect(readBy(messageTile(timeline(a.page), text.mention), personB)).toBeVisible({ timeout: 60_000 });
    });
});

test("5. Reactions", async () => {
    await step(`${A} reacts with a thumbs up to ${B}'s answer`, async () => {
        await react(a.page, messageTile(timeline(a.page), text.answer), "👍");
        await expect(reaction(messageTile(timeline(b.page), text.answer), "👍", personA)).toBeVisible({
            timeout: 60_000,
        });
    });

    await step(`${B} reacts with a heart to the mention`, async () => {
        await react(b.page, messageTile(timeline(b.page), text.mention), "❤️");
        await expect(reaction(messageTile(timeline(a.page), text.mention), "❤️", personB)).toBeVisible({
            timeout: 60_000,
        });
    });

    await step("Both see both reactions", async () => {
        for (const session of both()) {
            await expect(reaction(messageTile(timeline(session.page), text.answer), "👍", personA)).toBeVisible();
            await expect(reaction(messageTile(timeline(session.page), text.mention), "❤️", personB)).toBeVisible();
        }
    });

    await step(`${A} takes the thumbs up back`, async () => {
        await reaction(messageTile(timeline(a.page), text.answer), "👍", personA).click();
        for (const session of both()) {
            await expect(reaction(messageTile(timeline(session.page), text.answer), "👍")).toHaveCount(0, {
                timeout: 60_000,
            });
            await expect(reaction(messageTile(timeline(session.page), text.mention), "❤️", personB)).toBeVisible();
        }
    });
});

test("6. Media", async () => {
    const png = mediaFile("png");
    const jpeg = mediaFile("jpeg");
    const mp4 = mediaFile("mp4");
    const gif = mediaFile("gif");

    await step(`${A} sends a PNG with a caption`, async () => {
        await attach(a.page, png.path, text.png);
        for (const session of both()) {
            const tile = tileWithImage(timeline(session.page), text.png);
            await arrives(tile);
            await expect(tile.getByTestId("event-tile-slot-body")).toContainText(text.png);
        }
    });

    await step(`${B} sends a JPEG`, async () => {
        await attach(b.page, jpeg.path);
        await arrives(tileWithImage(timeline(a.page), jpeg.name));
    });

    await step(`${A} sends an MP4 video with a caption`, async () => {
        await attach(a.page, mp4.path, text.video);
        await arrives(messageTile(timeline(b.page), text.video));
        await expect(messageTile(timeline(b.page), text.video).locator("video")).toBeVisible({ timeout: 60_000 });
    });

    await step(`${B} plays the video`, async ({ note }) => {
        const video = messageTile(timeline(b.page), text.video).locator("video");
        // https://html.spec.whatwg.org/multipage/media.html#mediaerror
        const playback = (): Promise<string> =>
            video.evaluate((element: HTMLVideoElement) => {
                if (element.error) return `error ${element.error.code}`;
                if (element.currentTime > 1) return "playing";
                return element.paused ? "paused" : "waiting";
            });
        let presses = 0;
        await expect(async () => {
            if ((await playback()) === "paused") {
                await video.hover();
                const box = await video.boundingBox();
                if (!box) throw new Error("the video has no box to click");
                await video.click({ position: { x: 24, y: box.height - 48 } });
                presses++;
            }
            await expect.poll(playback, { timeout: 8_000 }).toBe("playing");
        }).toPass({ timeout: 60_000 });
        if (presses > 1) note("The first press of play fetches and decrypts the video, the second one starts it.");
    });

    await step(`${A} sends a GIF file`, async () => {
        await attach(a.page, gif.path);
        await arrives(tileWithImage(timeline(b.page), gif.name));
    });

    await step(`${B} opens the GIF and sees it move`, async () => {
        const { page } = b;
        await tileWithImage(timeline(b.page), gif.name).getByRole("img", { name: gif.name, exact: true }).click();
        const viewer = page.getByRole("dialog", { name: "Image view", exact: true });
        const image = viewer.getByRole("img", { name: gif.name, exact: true });
        await expect(image).toBeVisible();
        await page.waitForTimeout(1_000);
        const frames = new Set<string>();
        for (let i = 0; i < 6; i++) {
            frames.add((await image.screenshot()).toString("base64"));
            await page.waitForTimeout(250);
        }
        expect(frames.size).toBeGreaterThanOrEqual(3);
        await viewer.getByRole("button", { name: "Close", exact: true }).click();
        await expect(viewer).toBeHidden();
    });

    await step(`${B} sends a GIF from the GIF search`, async ({ skip }) => {
        if (!clientConfig().gif_provider)
            skip("the served config.json sets no gif_provider, so the composer has no GIF search");
        const { page } = b;
        await gifButton(page).click();
        const picker = page.getByRole("region", { name: "GIF picker", exact: true });
        await typeInto(picker.getByRole("searchbox", { name: "Search GIFs", exact: true }), "thumbs up");
        const gifs = timeline(a.page).getByRole("img", { name: /\.gif$/i });
        const before = await gifs.count();
        await picker
            .getByRole("button")
            .filter({ has: page.locator("img") })
            .first()
            .click();
        await expect(picker).toBeHidden();
        await expect(gifs).toHaveCount(before + 1, { timeout: 90_000 });
    });

    await step(`${A} edits the caption of the PNG`, async () => {
        const tile = messageTile(timeline(a.page), text.png);
        await messageAction(tile, "Edit");
        const editor = tile.getByRole("textbox").first();
        await expect(editor).toBeVisible();
        await editor.click();
        await a.page.keyboard.press("ControlOrMeta+a");
        await editor.pressSequentially(text.pngEdited, settings.typing);
        await tile.getByRole("button", { name: "Save", exact: true }).click();
        const edited = messageTile(timeline(b.page), text.pngEdited);
        await arrives(edited);
        await expect(edited).toContainText("(edited)");
        await expect(edited.getByRole("img").first()).toBeVisible();
    });
});

test("7. Direct messages", async () => {
    await step(`${B} starts a direct chat with ${A}`, async () => {
        const { page } = b;
        await startFromRoomList(page, "Start chat");
        const option = await findPerson(page, personA);
        await option.click();
        await submitInvite(page, "Go");
        await expect(roomHeading(page)).toHaveText(A);
    });

    await step(`${B} writes first`, async () => {
        await say(b.page, text.dmHello);
    });

    await step(`${A} accepts the chat`, async ({ note }) => {
        const { page } = a;
        const invitation = invitationItem(page, B);
        await findInRoomList(page, invitation.or(roomListItem(page, B)));
        if (await invitation.isVisible()) {
            await invitation.click();
            await page.getByRole("button", { name: "Start chatting", exact: true }).click();
        } else {
            if (!runTime) {
                throw new Error(
                    `${A} and ${B} have a direct chat from an earlier run, whose messages read the same with E2E_ROOM_NAME set: use new accounts or leave E2E_ROOM_NAME unset`,
                );
            }
            note(`${A} and ${B} have a direct chat already, so the message arrives there.`);
            await roomListItem(page, B).click();
        }
        await expect(composer(page)).toBeVisible({ timeout: 60_000 });
        await arrives(messageTile(timeline(a.page), text.dmHello));
    });

    await step(`${A} answers`, async () => {
        await say(a.page, text.dmAnswer);
        await arrives(messageTile(timeline(b.page), text.dmAnswer));
    });

    await step(`${A} sends a picture in the direct chat`, async () => {
        await attach(a.page, mediaFile("jpeg").path, text.dmImage);
        await arrives(tileWithImage(timeline(b.page), text.dmImage));
    });
});

test("8. Pins, a poll, search and room settings", async () => {
    await step(`Both go back to "${room}"`, async () => {
        for (const { page } of both()) {
            await showSpace(page);
            await openRoom(page, room);
        }
    });

    await step(`${A} pins ${B}'s answer`, async () => {
        await messageAction(messageTile(timeline(a.page), text.answer), "Pin");
        for (const { page } of both()) {
            await expect(page.getByRole("region", { name: "Pinned messages", exact: true })).toContainText(
                text.answer,
                { timeout: 60_000 },
            );
        }
    });

    await step(`${A} starts a poll`, async () => {
        const { page } = a;
        await moreOptions(page, "Poll");
        const create = dialog(page);
        await typeInto(create.getByRole("textbox", { name: "Question or topic", exact: true }), text.poll);
        for (const [index, option] of text.pollOptions.entries()) {
            await typeInto(create.getByRole("textbox", { name: `Option ${index + 1}`, exact: true }), option);
        }
        await create.getByRole("button", { name: "Create Poll", exact: true }).click();
        await expect(create).toBeHidden();
        await arrives(messageTile(timeline(b.page), text.poll));
    });

    await step(`${B} votes`, async () => {
        const poll = messageTile(timeline(b.page), text.poll);
        await poll.getByText(text.pollOptions[1], { exact: true }).click();
        await expect(poll.getByRole("radio", { name: text.pollOptions[1] })).toBeChecked();
        await expect(poll.getByText("Based on 1 vote", { exact: true })).toBeVisible({ timeout: 60_000 });
        await arrives(messageTile(timeline(a.page), text.poll));
        await expect(messageTile(timeline(a.page), text.poll).getByText(/^1 vote cast/)).toBeVisible({
            timeout: 60_000,
        });
    });

    await step(`${B} searches the room`, async ({ note }) => {
        const { page } = b;
        const panel = await roomInfo(page);
        const search = panel.getByPlaceholder("Search messages…", { exact: true });
        await typeInto(search, text.notes.bold.split(" ")[0].toLowerCase());
        await search.press("Enter");
        const summary = page.getByText(/^\d+ results? found for/).first();
        await expect(summary).toBeVisible({ timeout: 60_000 });
        const found = Number((await summary.innerText()).match(/^\d+/)?.[0] ?? "0");
        const cancel = page.getByRole("button", { name: "Cancel", exact: true });
        if (found > 0) {
            const result = timeline(page).getByTestId("event-tile").filter({ hasText: text.notes.bold });
            await expect(result.first()).toBeVisible();
            await cancel.click();
            await closeRightPanel(page);
            return;
        }
        await expect(page.getByText(/does not support searching encrypted messages/)).toBeVisible();
        note("The app on the web cannot search encrypted messages, so the room filter is checked instead.");
        await cancel.click();
        await closeRightPanel(page);
        await page.keyboard.press("ControlOrMeta+k");
        const spotlight = page.getByRole("dialog", { name: "Search Dialog" });
        await typeInto(spotlight.getByRole("textbox", { name: "Search", exact: true }), room.split(" ")[0]);
        await expect(spotlight.getByRole("option", { name: room }).first()).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(spotlight).toBeHidden();
    });

    await step(`${A} renames the room and sets its topic`, async () => {
        const { page } = a;
        const panel = await roomInfo(page);
        await panel.getByRole("menuitem", { name: "Settings", exact: true }).click();
        const roomSettings = dialog(page);
        const name = roomSettings.getByRole("textbox", { name: "Room Name", exact: true });
        await name.clear();
        await typeInto(name, renamed);
        await typeInto(roomSettings.getByRole("textbox", { name: "Room Topic", exact: true }), text.topic);
        await roomSettings.getByRole("button", { name: "Save", exact: true }).click();
        await expect(roomSettings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
        await closeDialog(page);
        await closeRightPanel(page);
        await expect(roomHeading(page)).toHaveText(renamed);
    });

    await step(`${B} sees the new name and topic`, async () => {
        const { page } = b;
        await expect(roomHeading(page)).toHaveText(renamed, { timeout: 60_000 });
        await expect(timeline(page).getByText(`changed the topic to "${text.topic}".`)).toBeVisible({
            timeout: 60_000,
        });
        const panel = await roomInfo(page);
        await expect(panel.getByText(text.topic)).toBeVisible();
        await closeRightPanel(page);
    });
});

test("9. Sign out and back in", async () => {
    await step(`${B} signs out`, () => signOut(b));

    await signInAndSecure(b);

    await step(`${B} reads the history`, async () => {
        await showSpace(b.page);
        await openRoom(b.page, renamed);
        for (const earlier of [text.answer, text.hello]) await scrollBackTo(b.page, messageTile(timeline(b.page), earlier));
    });

    await step(`${B} writes again`, async () => {
        await say(b.page, text.back);
        await arrives(messageTile(timeline(a.page), text.back));
    });
});
