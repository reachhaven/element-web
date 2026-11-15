// SPDX-FileCopyrightText: 2026 vDL Digital Ventures
//
// SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const env = (name: string): string | undefined => process.env[name] || undefined;

export const suiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputSetting = env("E2E_OUTPUT_DIR") ?? "output";
export const outputDir = path.resolve(suiteDir, outputSetting);
export const stepsFile = path.resolve(outputDir, "steps.json");
if (!path.isAbsolute(outputSetting) && !/^output[^/]*$/.test(path.relative(suiteDir, outputDir).split(path.sep)[0])) {
    throw new Error(`E2E_OUTPUT_DIR is ${outputSetting}: a relative output directory begins with "output", which git ignores`);
}
if (existsSync(outputDir) && readdirSync(outputDir).length && !existsSync(stepsFile)) {
    throw new Error(`E2E_OUTPUT_DIR names ${outputDir}, which holds files but no steps.json of a run, and a run empties it`);
}

const text = z.string().trim().min(1);

// https://spec.matrix.org/v1.16/appendices/#user-identifiers
export const matrixUserIdPattern = /^@([^:]+):(.+)$/;
const matrixUserId = z.string().regex(matrixUserIdPattern);
const localpartChars = z.string().regex(/^[a-z0-9._=\-/+]+$/);

const personSchema = z.looseObject({
    id: text,
    displayName: text.optional(),
    name: text.optional(),
    username: text.optional(),
    password: text.optional(),
    matrixUserId: matrixUserId.optional(),
});

const stateSchema = z.looseObject({
    baseUrl: text.optional(),
    urls: z.looseObject({ chat: text.optional() }).optional(),
    organisation: z.union([text, z.looseObject({ spaceName: text.optional(), name: text.optional() })]).optional(),
    people: z.union([z.array(personSchema), z.record(z.string(), personSchema)]),
});

type Entry = z.infer<typeof personSchema>;

export type Person = Entry & { key: "a" | "b"; displayName: string };

const environmentSchema = z.object({
    E2E_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
    E2E_PAUSE_MS: z.coerce.number().int().nonnegative().default(800),
    E2E_TYPING_DELAY_MS: z.coerce.number().int().nonnegative().default(35),
    E2E_BOT_LOCALPART_PREFIX: localpartChars.optional(),
    E2E_BOT_LOCALPART_SUFFIX: localpartChars.optional(),
    E2E_BOT_CONSENT_EVENT_TYPE: text.optional(),
});

const parseEnvironment = (): z.infer<typeof environmentSchema> => {
    const parsed = environmentSchema.safeParse(
        Object.fromEntries(Object.keys(environmentSchema.shape).map((name) => [name, env(name)])),
    );
    if (!parsed.success) {
        throw new Error(`Malformed ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
    }
    return parsed.data;
};

const readState = (file: string): z.infer<typeof stateSchema> => {
    let json: unknown;
    try {
        json = JSON.parse(readFileSync(path.resolve(file), "utf8"));
    } catch {
        throw new Error(`${file} is not readable as JSON`);
    }
    const parsed = stateSchema.safeParse(json);
    if (!parsed.success) {
        throw new Error(
            `${file} is not a state file: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
        );
    }
    return parsed.data;
};

const environment = parseEnvironment();
const stateFile = env("E2E_STATE_FILE");
const state = stateFile ? readState(stateFile) : undefined;
const entries: Entry[] = state ? Object.values(state.people) : [];

const person = (key: "a" | "b"): Person => {
    const suffix = key.toUpperCase();
    const user = env(`E2E_USER_${suffix}`);
    const entry =
        entries[key === "a" ? 0 : 1] ?? (user ? { id: user, displayName: env(`E2E_NAME_${suffix}`) } : undefined);
    const displayName = entry?.displayName ?? entry?.name ?? entry?.id;
    if (!entry || !displayName) {
        throw new Error(`Person ${suffix} is missing: list two people in E2E_STATE_FILE, or set E2E_USER_${suffix}`);
    }
    return {
        ...entry,
        key,
        displayName,
        username: user ?? entry.username ?? entry.id,
        password: env(`E2E_PASS_${suffix}`) ?? entry.password,
    };
};

const organisation = state?.organisation;
const space = typeof organisation === "string" ? organisation : (organisation?.spaceName ?? organisation?.name);
const organisationName = typeof organisation === "object" ? organisation.name : undefined;
const baseUrl = environment.E2E_BASE_URL ?? state?.baseUrl ?? state?.urls?.chat;
if (!baseUrl || !URL.canParse(baseUrl)) throw new Error("Set E2E_BASE_URL, or baseUrl or urls.chat in E2E_STATE_FILE");
const {
    E2E_BOT_LOCALPART_PREFIX: botPrefix,
    E2E_BOT_LOCALPART_SUFFIX: botSuffix,
    E2E_BOT_CONSENT_EVENT_TYPE: consentEventType,
} = environment;

export const settings = {
    baseUrl: baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
    people: [person("a"), person("b")] as const,
    space,
    spaceTitle: organisationName !== space ? organisationName : undefined,
    roomName: env("E2E_ROOM_NAME"),
    providerLogin: env("E2E_PROVIDER_LOGIN"),
    allowIdentityReset: env("E2E_ALLOW_IDENTITY_RESET") === "1",
    ignoreHttpsErrors: env("E2E_IGNORE_HTTPS_ERRORS") === "1",
    mediaDir: env("E2E_MEDIA_DIR"),
    title: env("E2E_TITLE"),
    pauseMs: environment.E2E_PAUSE_MS,
    typing: { delay: environment.E2E_TYPING_DELAY_MS },
    bots:
        botPrefix && consentEventType
            ? { localpartPrefix: botPrefix, localpartSuffix: botSuffix ?? "", consentEventType }
            : undefined,
};
