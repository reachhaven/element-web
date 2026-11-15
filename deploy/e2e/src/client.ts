// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import type { JSHandle, Page } from "@playwright/test";

type Content = Record<string, unknown>;

type ClientEvent = {
    getId(): string | undefined;
    getType(): string;
    getSender(): string | undefined;
    getContent(): Content;
    isDecryptionFailure(): boolean;
};

type ClientRoom = {
    name: string;
    roomId: string;
    getMyMembership(): string;
    currentState: { getStateEvents(type: string, stateKey: string): ClientEvent | null };
    getLiveTimeline(): { getEvents(): ClientEvent[] };
};

type Client = {
    getSafeUserId(): string;
    getRooms(): ClientRoom[];
    getRoom(roomId: string): ClientRoom | null;
    sendStateEvent(roomId: string, type: string, content: Content, stateKey: string): Promise<unknown>;
};

declare global {
    interface Window {
        mxMatrixClientPeg: { get(): Client | null };
    }
}

export type Membership = { eventId: string; membership: unknown; sender?: string };

export type Message = { eventId: string; type: string; body: unknown; mentions: unknown; undecryptable: boolean };

const clientOf = (page: Page): Promise<JSHandle<Client>> =>
    page.evaluateHandle(() => {
        const client = window.mxMatrixClientPeg.get();
        if (!client) throw new Error("The app has no signed-in Matrix client");
        return client;
    });

const withClient = async <R>(page: Page, act: (client: JSHandle<Client>) => Promise<R>): Promise<R> => {
    const client = await clientOf(page);
    try {
        return await act(client);
    } finally {
        await client.dispose();
    }
};

export const ownUserId = (page: Page): Promise<string> =>
    withClient(page, (client) => client.evaluate((client) => client.getSafeUserId()));

export const joinedRoomId = (page: Page, name: string): Promise<string | undefined> =>
    withClient(page, (client) =>
        client.evaluate(
            (client, name) =>
                client.getRooms().find((room) => room.name === name && room.getMyMembership() === "join")?.roomId,
            name,
        ),
    );

// https://spec.matrix.org/v1.16/client-server-api/#mroompower_levels
export const setEventPowerLevel = (page: Page, roomId: string, type: string, level: number): Promise<void> =>
    withClient(page, (client) =>
        client.evaluate(
            async (client, [roomId, type, level]) => {
                const current = client.getRoom(roomId)?.currentState.getStateEvents("m.room.power_levels", "");
                if (!current) throw new Error(`${roomId} has no power levels`);
                const content = current.getContent();
                const events = { ...(content.events as Content | undefined), [type]: level };
                await client.sendStateEvent(roomId, "m.room.power_levels", { ...content, events }, "");
            },
            [roomId, type, level] as const,
        ),
    );

export const sendOwnStateEvent = (page: Page, roomId: string, type: string, content: Content): Promise<void> =>
    withClient(page, (client) =>
        client.evaluate(
            async (client, [roomId, type, content]) => {
                await client.sendStateEvent(roomId, type, content, client.getSafeUserId());
            },
            [roomId, type, content] as const,
        ),
    );

// https://spec.matrix.org/v1.16/client-server-api/#mroommember
export const membershipOf = (page: Page, roomId: string, userId: string): Promise<Membership | undefined> =>
    withClient(page, (client) =>
        client.evaluate(
            (client, [roomId, userId]) => {
                const event = client.getRoom(roomId)?.currentState.getStateEvents("m.room.member", userId);
                const eventId = event?.getId();
                if (!event || !eventId) return undefined;
                return { eventId, membership: event.getContent().membership, sender: event.getSender() };
            },
            [roomId, userId] as const,
        ),
    );

// https://spec.matrix.org/v1.16/client-server-api/#mroommessage
// https://spec.matrix.org/v1.16/client-server-api/#mroomencrypted
export const latestMessageOf = (page: Page, roomId: string, sender: string): Promise<Message | undefined> =>
    withClient(page, (client) =>
        client.evaluate(
            (client, [roomId, sender]) => {
                const event = client
                    .getRoom(roomId)
                    ?.getLiveTimeline()
                    .getEvents()
                    .findLast(
                        (event) =>
                            event.getSender() === sender &&
                            ["m.room.message", "m.room.encrypted"].includes(event.getType()),
                    );
                const eventId = event?.getId();
                if (!event || !eventId) return undefined;
                return {
                    eventId,
                    type: event.getType(),
                    body: event.getContent().body,
                    mentions: event.getContent()["m.mentions"],
                    undecryptable: event.isDecryptionFailure(),
                };
            },
            [roomId, sender] as const,
        ),
    );
