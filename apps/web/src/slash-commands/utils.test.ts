/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { singleMxcUpload, splitAtFirstSpace } from "./utils";
import Modal from "../Modal";
import UploadConfirmDialog from "../components/views/dialogs/UploadConfirmDialog";

describe("splitAtFirstSpace", () => {
    it("should be able to split arguments at the first whitespace", () => {
        expect(splitAtFirstSpace("a b")).toEqual(["a", "b"]);
        expect(splitAtFirstSpace("arg1 Followed by more stuff")).toEqual(["arg1", "Followed by more stuff"]);
        expect(splitAtFirstSpace("arg1 Followed by more\nstuff")).toEqual(["arg1", "Followed by more\nstuff"]);
        expect(splitAtFirstSpace("  arg1 Followed by more stuff  ")).toEqual(["arg1", "Followed by more stuff"]);
        expect(splitAtFirstSpace("arg1 \t\n Followed by more stuff")).toEqual(["arg1", "Followed by more stuff"]);
        expect(splitAtFirstSpace("a")).toEqual(["a"]);
        expect(splitAtFirstSpace("arg1")).toEqual(["arg1"]);
        expect(splitAtFirstSpace("arg1    ")).toEqual(["arg1"]);
        expect(splitAtFirstSpace("  arg1    ")).toEqual(["arg1"]);
    });
});

describe("singleMxcUpload", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should confirm the file without asking for a caption, which the upload has no use for", async () => {
        const file = new File(["avatar"], "avatar.png", { type: "image/png" });
        const client = {
            uploadContent: vi.fn().mockResolvedValue({ content_uri: "mxc://server/avatar" }),
        } as unknown as MatrixClient;
        const createDialog = vi
            .spyOn(Modal, "createDialog")
            .mockReturnValue({ finished: Promise.resolve([true]), close: vi.fn() } as unknown as ReturnType<
                typeof Modal.createDialog
            >);
        // Choose the file as soon as the file picker is opened
        const createElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
            const element = createElement(tagName);
            if (tagName === "input") {
                element.click = () => element.onchange?.({ target: { files: [file] } } as unknown as Event);
            }
            return element;
        }) as typeof document.createElement);

        await expect(singleMxcUpload(client)).resolves.toBe("mxc://server/avatar");
        expect(createDialog).toHaveBeenCalledWith(UploadConfirmDialog, { file });
    });
});
