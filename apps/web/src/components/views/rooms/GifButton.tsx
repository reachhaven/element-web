/*
SPDX-FileCopyrightText: 2026 vDL Digital Ventures
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useContext } from "react";
import classNames from "classnames";
import { type IEventRelation, type Room } from "matrix-js-sdk/src/matrix";
import { GifPickerView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import ContextMenu, { aboveLeftOf, type MenuProps, useContextMenu } from "../../structures/ContextMenu";
import { CollapsibleButton, OverflowMenuContext } from "./CollapsibleButton";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useScopedRoomContext } from "../../../contexts/ScopedRoomContext";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { GifPickerViewModel } from "../../../viewmodels/composer/GifPickerViewModel";
import type { GifProvider } from "../../../gifs/types";
import GifIcon from "../../../../res/img/element-icons/gif.svg?react";

interface GifPickerProps {
    /** The GIF search service. */
    provider: GifProvider;
    /** The room the composer sends to. */
    room: Room;
    /** The thread the composer sends to, if any. */
    relation?: IEventRelation;
    /** Closes the picker. */
    onFinished: () => void;
}

function GifPicker({ provider, room, relation, onFinished }: GifPickerProps): JSX.Element {
    const client = useMatrixClientContext();
    const { replyToEvent, timelineRenderingType } = useScopedRoomContext("replyToEvent", "timelineRenderingType");
    const vm = useCreateAutoDisposedViewModel(
        () =>
            new GifPickerViewModel({
                provider,
                room,
                client,
                relation,
                replyToEvent,
                timelineRenderingType,
                dispatcher: defaultDispatcher,
                onFinished,
            }),
    );
    return <GifPickerView vm={vm} />;
}

interface GifButtonProps {
    /** The GIF search service. */
    provider: GifProvider;
    /** The room the composer sends to. */
    room: Room;
    /** The thread the composer sends to, if any. */
    relation?: IEventRelation;
    /** Where to open the picker. Above the button if not given. */
    menuPosition?: MenuProps;
}

/**
 * A message composer button which opens a picker to search for a GIF and send it.
 */
export function GifButton({ provider, room, relation, menuPosition }: GifButtonProps): JSX.Element {
    const overflowMenuCloser = useContext(OverflowMenuContext);
    const [menuDisplayed, button, openMenu, closeMenu] = useContextMenu();

    let contextMenu: ReactNode = null;
    if (menuDisplayed && button.current) {
        const position = menuPosition ?? aboveLeftOf(button.current.getBoundingClientRect());
        const onFinished = (): void => {
            closeMenu();
            overflowMenuCloser?.();
        };

        contextMenu = (
            <ContextMenu {...position} onFinished={onFinished} managed={false} focusLock>
                <GifPicker provider={provider} room={room} relation={relation} onFinished={onFinished} />
            </ContextMenu>
        );
    }

    return (
        <>
            <CollapsibleButton
                className={classNames("mx_MessageComposer_button", {
                    mx_MessageComposer_button_highlight: menuDisplayed,
                })}
                onClick={openMenu}
                title={_t("composer|gif_button")}
                inputRef={button}
            >
                <GifIcon />
            </CollapsibleButton>
            {contextMenu}
        </>
    );
}
