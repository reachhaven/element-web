// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { expect, type Locator, type Page } from "@playwright/test";

import { settings, type Person } from "./env";

export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const userMenu = (page: Page): Locator => page.getByRole("button", { name: "User menu", exact: true });

export const dialog = (page: Page): Locator => page.getByRole("dialog").last();

export const closeDialog = async (page: Page): Promise<void> => {
    const open = page.getByRole("dialog");
    const count = await open.count();
    await page.getByRole("button", { name: "Close dialog", exact: true }).last().click();
    await expect(open).toHaveCount(count - 1);
};

export const typeInto = async (field: Locator, text: string): Promise<void> => {
    await field.click();
    await field.pressSequentially(text, settings.typing);
};

export const openUserSettings = async (page: Page, tab?: string): Promise<Locator> => {
    await userMenu(page).click();
    await page.getByRole("menuitem", { name: "All settings", exact: true }).click();
    const settingsDialog = dialog(page);
    if (tab) await settingsDialog.getByRole("tab", { name: tab, exact: true }).click();
    return settingsDialog;
};

const spacePanel = (page: Page): Locator => page.getByRole("tree", { name: "Spaces", exact: true });

export const spaceButton = (page: Page, name: string): Locator =>
    spacePanel(page).getByRole("button", { name, exact: true });

export const homeButton = (page: Page): Locator => spacePanel(page).getByRole("button", { name: "Home", exact: true });

export const showSpace = async (page: Page, space?: string): Promise<void> => {
    await (space ? spaceButton(page, space) : homeButton(page)).click();
};

export const openSpaceMenu = async (page: Page, space: string): Promise<void> => {
    await spaceButton(page, space).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Space home", exact: true })).toBeVisible();
};

/** Waits until every page lists the space, under its own name or the organisation's, and answers the name shown. */
export const findSpace = async (pages: Page[], space: string): Promise<string> => {
    const title = settings.spaceTitle;
    for (const page of pages) {
        const named = title ? spaceButton(page, space).or(spaceButton(page, title)) : spaceButton(page, space);
        await expect(named).toBeVisible({ timeout: 120_000 });
    }
    return title && (await spaceButton(pages[0], title).isVisible()) ? title : space;
};

const leftPanel = (page: Page): Locator => page.getByRole("navigation", { name: "Room list", exact: true });

export const roomListItem = (page: Page, room: string): Locator =>
    leftPanel(page).getByLabel(new RegExp(`^Open room ${escapeRegExp(room)}(?: with [^.]+\\.)?$`));

export const invitationItem = (page: Page, room: string): Locator =>
    leftPanel(page).getByLabel(`Open room ${room} invitation.`, { exact: true });

export const showInvites = async (page: Page): Promise<void> => {
    const section = leftPanel(page).getByRole("gridcell", { name: /^Toggle Invites section/ });
    if ((await section.count()) && (await section.getAttribute("aria-expanded")) !== "true") {
        await section.getByRole("button").click();
        await expect(section).toHaveAttribute("aria-expanded", "true");
    }
};

export const findInRoomList = async (page: Page, item: Locator, space?: string): Promise<void> => {
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

export const findInvitation = async (page: Page, room: string, space?: string): Promise<Locator> => {
    const invitation = invitationItem(page, room);
    await findInRoomList(page, invitation, space);
    return invitation;
};

export const openNewMenu = async (page: Page): Promise<void> => {
    await leftPanel(page)
        .getByLabel("Room options", { exact: true })
        .getByRole("button", { name: "New", exact: true })
        .click();
    await expect(page.getByRole("menuitem", { name: "Start chat", exact: true })).toBeVisible();
};

export const startFromRoomList = async (page: Page, item: "Start chat" | "New room"): Promise<void> => {
    await openNewMenu(page);
    await page.getByRole("menuitem", { name: item, exact: true }).click();
};

/** Fills in the open dialog for a new room, with its visibility when one is given, and creates the room. */
export const createRoom = async (page: Page, room: string, visibility?: string): Promise<void> => {
    const create = dialog(page);
    await typeInto(create.getByRole("textbox", { name: "Name", exact: true }), room);
    if (visibility) {
        await create.getByRole("button", { name: "Room visibility", exact: true }).click();
        await create.getByRole("option", { name: visibility, exact: true }).click();
    }
    await create.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(create).toBeHidden();
    await expect(roomHeading(page)).toHaveText(room);
};

export const roomHeader = (page: Page): Locator => page.locator("header.mx_RoomHeader");

export const roomHeading = (page: Page): Locator => roomHeader(page).getByRole("heading", { level: 1 });

const rightPanel = (page: Page): Locator => page.locator("#mx_RightPanel");

export const roomInfo = async (page: Page): Promise<Locator> => {
    const panel = rightPanel(page);
    const settingsItem = panel.getByRole("menuitem", { name: "Settings", exact: true });
    if (!(await settingsItem.isVisible())) {
        await roomHeader(page).getByRole("button", { name: "Room info", exact: true }).last().click();
    }
    await expect(settingsItem).toBeVisible();
    return panel;
};

export const closeRightPanel = async (page: Page): Promise<void> => {
    const panel = rightPanel(page);
    if (!(await panel.isVisible())) return;
    await panel.getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(panel).toBeHidden();
};

export const openRoom = async (page: Page, room: string): Promise<void> => {
    const item = roomListItem(page, room);
    const listed = await expect
        .poll(() => item.count(), { timeout: 5_000 })
        .toBeGreaterThan(0)
        .then(
            () => true,
            () => false,
        );
    if (listed) {
        await item.click();
    } else {
        await page.keyboard.press("ControlOrMeta+k");
        const search = page.getByRole("dialog", { name: "Search Dialog" });
        await typeInto(search.getByRole("textbox", { name: "Search", exact: true }), room);
        await search.getByRole("option", { name: room, exact: true }).click();
    }
    await expect(roomHeading(page)).toHaveText(room);
};

export const timeline = (page: Page): Locator => page.locator(".mx_RoomView_body");

/** The tile of an event in the room's timeline, or the folded summary of membership changes that holds it. */
export const timelineEvent = (page: Page, eventId: string): Locator =>
    timeline(page)
        .locator(`[data-event-id="${eventId}"]`)
        .or(
            timeline(page)
                .locator(`.mx_GenericEventListSummary[data-scroll-tokens*="${eventId}"]`)
                .filter({ has: page.locator('.mx_GenericEventListSummary_toggle[aria-expanded="false"]') }),
        );

export const threadPanel = (page: Page): Locator => rightPanel(page);

export const messageTile = (scope: Locator, text: string): Locator =>
    scope
        .getByTestId("event-tile")
        .filter({ has: scope.page().getByTestId("event-tile-slot-body").filter({ hasText: text }) })
        .last();

export const tileWithImage = (scope: Locator, name: string): Locator =>
    scope
        .getByTestId("event-tile")
        .filter({ has: scope.page().getByRole("img", { name, exact: true }) })
        .last();

export const arrives = async (tile: Locator): Promise<void> => {
    const latest = tile.page().getByRole("button", { name: "Scroll to most recent messages", exact: true }).first();
    await expect(async () => {
        if (await latest.isVisible()) await latest.click();
        await expect(tile).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });
};

/** Scrolls the room's timeline back until the tile is rendered, loading earlier history on the way. */
export const scrollBackTo = async (page: Page, tile: Locator): Promise<void> => {
    await expect(async () => {
        if (!(await tile.isVisible())) {
            await timeline(page).hover();
            await page.mouse.wheel(0, -1500);
            await expect(tile).toBeVisible({ timeout: 3_000 });
        }
    }).toPass({ timeout: 90_000 });
};

const scope = (page: Page, where: "room" | "thread"): Locator =>
    where === "room" ? timeline(page) : threadPanel(page);

export const composer = (page: Page, where: "room" | "thread" = "room"): Locator =>
    scope(page, where).getByRole("textbox", { name: "Message composer", exact: true });

const composerArea = (page: Page, where: "room" | "thread" = "room"): Locator =>
    scope(page, where).getByRole("region", { name: "Message composer", exact: true });

/** The composer's GIF search button (gif-picker), present when the configuration sets `gif_provider`. */
export const gifButton = (page: Page): Locator => composerArea(page).getByRole("button", { name: "GIF", exact: true });

export const focusComposer = async (page: Page, where: "room" | "thread" = "room"): Promise<Locator> => {
    const field = composer(page, where);
    await expect(field).toHaveAttribute("contenteditable", "true");
    await field.click();
    await expect(field).toBeFocused();
    return field;
};

export const write = async (page: Page, text: string, where: "room" | "thread" = "room"): Promise<void> => {
    const field = await focusComposer(page, where);
    await field.pressSequentially(text, settings.typing);
};

export const say = async (page: Page, text: string, where: "room" | "thread" = "room"): Promise<Locator> => {
    await write(page, text, where);
    await page.keyboard.press("Enter");
    const tile = messageTile(scope(page, where), text);
    await expect(tile).toBeVisible();
    await expect(composer(page, where)).toHaveText("");
    return tile;
};

export const formattingButton = (page: Page, name: "Bold" | "Code" | "Code block"): Locator =>
    composerArea(page).getByRole("button", { name, exact: true });

export const sendButton = (page: Page): Locator =>
    composerArea(page).getByRole("button", { name: "Send message", exact: true });

export const moreOptions = async (page: Page, item: string): Promise<void> => {
    await composerArea(page).getByRole("button", { name: "More options", exact: true }).click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
};

export const messageAction = async (tile: Locator, name: string): Promise<void> => {
    await tile.hover();
    const actions = tile.getByRole("toolbar", { name: "Message actions" });
    await expect(actions).toBeVisible();
    await actions.getByRole("button", { name, exact: true }).click();
};

// https://www.unicode.org/reports/tr51/#Emoji_Variation_Sequences
const emojiPattern = (emoji: string): string => `${escapeRegExp(emoji.replace(/\uFE0F/g, ""))}\uFE0F?`;

export const react = async (page: Page, tile: Locator, emoji: string): Promise<void> => {
    await messageAction(tile, "React");
    await page
        .getByRole("toolbar", { name: "Quick Reactions", exact: true })
        .getByRole("checkbox", { name: new RegExp(`^${emojiPattern(emoji)}$`) })
        .click();
};

export const reaction = (tile: Locator, emoji: string, by?: Person): Locator =>
    tile.getByLabel(new RegExp(`^${by ? escapeRegExp(by.displayName) : ".+"} reacted with ${emojiPattern(emoji)}$`));

export const readBy = (tile: Locator, reader: Person): Locator =>
    tile
        .getByRole("group", { name: /^Seen by \d+ (person|people)$/ })
        .getByRole("button", { name: reader.displayName, exact: true });

export const attach = async (page: Page, file: string, caption?: string): Promise<void> => {
    const chooser = page.waitForEvent("filechooser");
    await composerArea(page).getByRole("button", { name: "Attachment", exact: true }).click();
    await (await chooser).setFiles(file);
    const upload = dialog(page);
    await expect(upload.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
    if (caption) {
        const field = upload.getByRole("textbox", { name: "Caption (optional)", exact: true });
        if (!(await field.isVisible())) throw new Error("The upload dialog has no caption field (feat/upload-caption)");
        await typeInto(field, caption);
    }
    await upload.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(upload).toBeHidden();
};

const withMatrixId = (option: Locator, person: Person): Locator =>
    person.matrixUserId ? option.filter({ hasText: person.matrixUserId }) : option;

const inviteDialog = (page: Page): Locator => page.getByRole("dialog", { name: /^(Direct Messages|Invite to )/ });

export const findPerson = async (page: Page, person: Person): Promise<Locator> => {
    const field = inviteDialog(page).getByRole("textbox", { name: "Search", exact: true });
    const result = withMatrixId(
        inviteDialog(page).getByRole("option", { name: person.displayName, exact: true }),
        person,
    );
    await expect(async () => {
        await field.clear();
        await field.pressSequentially(person.displayName, settings.typing);
        await expect(result).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000, intervals: [2_000] });
    return result;
};

export const submitInvite = async (page: Page, button: "Invite" | "Go"): Promise<void> => {
    const invite = inviteDialog(page);
    const confirmation = (heading: RegExp): Locator =>
        page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: heading }) });
    const newContacts = confirmation(/^(Invite new contacts to this chat|Start a chat with)/);
    const unknownProfiles = confirmation(/^The following users may not exist$/);
    await invite.getByRole("button", { name: button, exact: true }).click();
    await expect(async () => {
        if (await newContacts.isVisible()) {
            await newContacts
                .getByRole("button", { name: button === "Go" ? "Continue" : "Invite", exact: true })
                .click();
        }
        if (await unknownProfiles.isVisible()) {
            await unknownProfiles.getByRole("button", { name: "Invite anyway", exact: true }).click();
        }
        await expect(invite.or(newContacts).or(unknownProfiles)).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
};

export const invitePerson = async (page: Page, person: Person): Promise<void> => {
    const panel = await roomInfo(page);
    await panel.getByRole("menuitem", { name: "Invite", exact: true }).click();
    const option = await findPerson(page, person);
    await option.click();
    await submitInvite(page, "Invite");
    await closeRightPanel(page);
};

export const acceptInvitation = async (page: Page, room: string, space?: string): Promise<void> => {
    await (await findInvitation(page, room, space)).click();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(composer(page)).toBeVisible({ timeout: 60_000 });
    await expect(roomHeading(page)).toHaveText(room);
};

/** Invites a user by Matrix ID from the room's member list. */
export const inviteByUserId = async (page: Page, userId: string): Promise<void> => {
    const panel = await roomInfo(page);
    await panel.getByRole("menuitem", { name: "People", exact: true }).click();
    await panel.getByRole("button", { name: "Invite", exact: true }).click();
    const field = inviteDialog(page).getByRole("textbox", { name: "Search", exact: true });
    await typeInto(field, userId);
    await field.press("Enter");
    await expect(field).toHaveValue("");
    await submitInvite(page, "Invite");
    await closeRightPanel(page);
};

export const suggestion = (page: Page, person: Person): Locator =>
    withMatrixId(composerArea(page).getByRole("option", { name: person.displayName }), person);

export const userSuggestion = (page: Page, userId: string): Locator =>
    composerArea(page).getByRole("option").filter({ hasText: userId });

/** Mentions a user through the composer's suggestions for the query and sends the mention followed by the text. */
export const mentionAndSend = async (page: Page, query: string, userId: string, text: string): Promise<void> => {
    await write(page, query);
    await userSuggestion(page, userId).first().click();
    const field = composer(page);
    await field.press("End");
    await field.pressSequentially(` ${text}`, settings.typing);
    await field.press("Enter");
    await expect(field).toHaveText("");
};

export const mentionQuery = (person: Person): string => `@${person.displayName.slice(0, 3)}`;
