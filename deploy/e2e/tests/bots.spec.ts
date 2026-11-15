// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { expect, test } from "@playwright/test";

import {
    joinedRoomId,
    latestMessageOf,
    membershipOf,
    ownUserId,
    sendOwnStateEvent,
    setEventPowerLevel,
    type Membership,
    type Message,
} from "../src/client";
import {
    acceptInvitation,
    arrives,
    createRoom,
    findSpace,
    invitePerson,
    inviteByUserId,
    mentionAndSend,
    openSpaceMenu,
    roomListItem,
    showSpace,
    timelineEvent,
} from "../src/element";
import { matrixUserIdPattern, settings } from "../src/env";
import { closeSessions, openSessions, type Session } from "../src/session";
import { signInAndSecure } from "../src/sign-in";
import { step } from "../src/steps";

const { bots } = settings;
test.skip(!bots, "set E2E_BOT_LOCALPART_PREFIX and E2E_BOT_CONSENT_EVENT_TYPE to record the bots");
test.skip(!settings.space, "the state file names no organisation, and a bot joins only rooms of its space");
test.describe.configure({ mode: "serial" });

const prefix = bots?.localpartPrefix ?? "";
const suffix = bots?.localpartSuffix ?? "";
const consentType = bots?.consentEventType ?? "";
const [personA, personB] = settings.people;
const A = personA.displayName;
const B = personB.displayName;
const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
const room = `Bot room ${stamp}`;
const botTimeout = 90_000;

let a: Session;
let b: Session;
let space = settings.space ?? "";
let roomId = "";
let bot = "";
let botEvent: string | undefined;

const both = (): Session[] => [a, b];

const botOf = (userId: string): string => {
    const [, localpart, server] = matrixUserIdPattern.exec(userId) ?? [];
    if (!localpart || !server) throw new Error(`${userId} is not a Matrix user ID`);
    return `@${prefix}${localpart}${suffix}:${server}`;
};

const botQuery = (): string => `@${bot.slice(1, bot.indexOf(":")).slice(0, prefix.length + 4)}`;

const eventually = async <T extends object>(
    probe: () => Promise<T | undefined>,
    expected: Record<string, unknown>,
    message: string,
): Promise<T> => {
    const seen: { value?: T } = {};
    await expect
        .poll(async () => (seen.value = await probe()), { timeout: botTimeout, message })
        .toMatchObject(expected);
    return seen.value!;
};

const botMembership = (session: Session, expected: Record<string, unknown>, after?: string): Promise<Membership> =>
    eventually(
        async () => {
            const current = await membershipOf(session.page, roomId, bot);
            return current?.eventId === after ? undefined : current;
        },
        expected,
        `${session.name} waits for the bot's membership ${JSON.stringify(expected)}`,
    );

const botMessage = (session: Session, expected: Record<string, unknown>, after?: string): Promise<Message> =>
    eventually(
        async () => {
            const latest = await latestMessageOf(session.page, roomId, bot);
            return latest?.eventId === after ? undefined : latest;
        },
        { type: "m.room.message", ...expected },
        `${session.name} waits for a message from the bot`,
    );

const shows = async (session: Session, eventId: string, text?: RegExp | string): Promise<void> => {
    const event = timelineEvent(session.page, eventId);
    await arrives(event);
    if (text) await expect(event).toContainText(text);
};

const consent = (session: Session, consented: string[]): Promise<void> =>
    sendOwnStateEvent(session.page, roomId, consentType, { bots: consented });

const inviteBot = async (): Promise<void> => {
    await inviteByUserId(a.page, bot);
    await botMembership(a, {}, botEvent);
};

const bothSeeTheBot = async (membership: "join" | "leave", text: RegExp): Promise<void> => {
    const after = botEvent;
    for (const session of both()) {
        const change = await botMembership(session, { membership, sender: bot }, after);
        await shows(session, change.eventId, text);
        botEvent = change.eventId;
    }
};

const ping = async (session: Session): Promise<void> => {
    const before = await Promise.all(both().map(({ page }) => latestMessageOf(page, roomId, bot)));
    await mentionAndSend(session.page, botQuery(), bot, "ping");
    // https://spec.matrix.org/v1.16/client-server-api/#user-and-room-mentions
    const me = await ownUserId(session.page);
    await expect
        .poll(async () => (await latestMessageOf(session.page, roomId, me))?.mentions, { timeout: 30_000 })
        .toEqual({ user_ids: [bot] });
    for (const [index, witness] of both().entries()) {
        const answer = await botMessage(witness, { body: "pong" }, before[index]?.eventId);
        await shows(witness, answer.eventId, "pong");
    }
};

test.beforeAll(async ({ browser }) => {
    [a, b] = await openSessions(browser);
});

test.afterAll(async () => {
    test.setTimeout(120_000);
    await closeSessions(a, b);
});

test("1. Both sign in", async () => {
    await signInAndSecure(a);
    await signInAndSecure(b);

    await step(`Both see the space ${space}`, async ({ note }) => {
        const shown = await findSpace(
            both().map(({ page }) => page),
            space,
        );
        if (shown !== space) {
            note(`The space is called ${shown} already.`);
            space = shown;
        }
    });
});

test("2. A private room in the space", async () => {
    await step(`${A} creates the private room "${room}" in the space`, async () => {
        const { page } = a;
        await showSpace(page, space);
        await openSpaceMenu(page, space);
        const addRoom = page.getByRole("menuitem", { name: "Room", exact: true });
        if (!(await addRoom.isVisible())) {
            await page.keyboard.press("Escape");
            throw new Error(`${A} may not add rooms to ${space}, and a bot joins rooms of the space only`);
        }
        await addRoom.click();
        await createRoom(page, room, "Invite only");
        await expect(roomListItem(page, room)).toBeVisible();
    });

    await step(`${A} invites ${B}`, () => invitePerson(a.page, personB));

    await step(`${B} accepts the invitation`, () => acceptInvitation(b.page, room, space));
});

test("3. Everyone has to agree", async () => {
    await step(`${A} agrees to add their bot; everyone in the room has to agree`, async () => {
        const { page } = a;
        bot = botOf(await ownUserId(page));
        roomId = (await joinedRoomId(page, room)) ?? "";
        if (!roomId) throw new Error(`${A} is not in "${room}"`);
        await setEventPowerLevel(page, roomId, consentType, 0);
        await consent(a, [bot]);
    });

    await step(`${A} invites their bot`, inviteBot);

    await step("The bot declines: not everyone has agreed yet", () =>
        bothSeeTheBot("leave", /rejected (the|their) invitation/),
    );

    await step(`${B} agrees too`, () => consent(b, [bot]));

    await step(`${A} invites the bot again`, inviteBot);

    await step("Everyone agreed: the bot joins and says who it belongs to", async () => {
        await bothSeeTheBot("join", /joined/);
        for (const session of both()) await shows(session, (await botMessage(session, {})).eventId);
    });
});

test("4. Asking the bot", async () => {
    await step("Pinging the bot is like pinging a person", () => ping(a));

    await step("Anyone in the room can ask it", () => ping(b));
});

test("5. Sending the bot away", async () => {
    await step(`${B} withdraws: the bot leaves at once`, async () => {
        await consent(b, []);
        await bothSeeTheBot("leave", /left/);
    });

    await step(`${B} agrees again`, () => consent(b, [bot]));

    await step(`${A} invites the bot back`, inviteBot);

    await step("The bot joins again", () => bothSeeTheBot("join", /joined/));

    await step("Any member can send it away with one word", async () => {
        await mentionAndSend(a.page, botQuery(), bot, "leave");
        await bothSeeTheBot("leave", /left/);
    });
});
