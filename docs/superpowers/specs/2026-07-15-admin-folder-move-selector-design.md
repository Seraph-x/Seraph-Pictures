# Admin batch folder move selector design

## Goal

Replace the legacy Admin batch move prompt with a destination selector that exposes existing folder paths while preserving the ability to type a new path. The change applies only to the Admin batch toolbar action that moves selected files; it does not change folder rename/move operations in `/app/drive` or any backend API.

## Chosen approach

Use an Element UI dialog containing an `el-autocomplete` combobox backed by the existing folder paths. This fits the existing Vue 2 and Element UI Admin interface, keeps every typed character bound directly to the destination model, and avoids building a separate tree component. The suggestion callback filters existing paths, while unmatched input remains a valid value without requiring the administrator to press Enter or explicitly create an option before clicking Confirm.

The selector contains:

- an explicit root-directory option with an empty path value;
- every normalized path currently present in the Admin `folders` collection;
- a free-form value entered by the administrator when no existing path matches.

The current folder path is selected when the dialog opens. Existing paths are suggestions, not a restriction.

## User interaction

The existing batch toolbar button continues to require at least one selected file. When files are selected, activating the action opens the destination dialog instead of the current `$prompt` text box.

The administrator can search the suggestions by typing, choose an existing path, choose the root directory, or finish typing a new path. The input value updates the destination model on every edit, so clicking Confirm always uses the visible text even when no suggestion was selected. Confirming normalizes the bound value with the existing `normalizeFolderPath` function. Cancelling, pressing Escape, or closing through the backdrop closes the dialog without changing selection or issuing a request.

While the move request is active, the confirm action is disabled or loading to prevent duplicate submissions, and Escape, backdrop, and close-button dismissal are blocked. On success, the existing localized success message reports the number of moved files and the normalized destination. Selecting the current folder remains a no-op, shows the existing informational message, closes the dialog, and resets dialog-only state.

## Component and state changes

Add the dialog markup to the legacy Admin component tree where the batch toolbar and folder sidebar already consume Admin state. Keep display concerns in the component template and move workflow logic in `folder-move-methods.js`.

Add only the state required by the dialog:

- whether the dialog is visible;
- the current destination input value;
- whether confirmation is in progress.

Expose a computed destination list derived immutably from `folders`. Normalize and deduplicate paths, sort them with the same path ordering already used by the folder sidebar, and prepend the root option. Each autocomplete suggestion has a display label and a path value; selecting the root suggestion writes the empty path value. Do not mutate the `folders` collection while building options.

`promptFolderMove` becomes the dialog-opening action. A separate confirmation method captures the selected file IDs and normalized destination, then delegates to the existing `performFolderMove` workflow. Closing or cancelling resets dialog-only state.

## Data flow

1. The Admin folder refresh continues to populate `folders` from `/api/manage/folders`.
2. The computed option list projects root plus the current normalized folder paths.
3. The batch action seeds the selector with `folderPath` and opens the dialog.
4. Confirmation normalizes the selected or newly entered value.
5. Existing `performFolderMove` performs the no-op check, optimistic table update, request, folder refresh, and rollback on failure.
6. The existing `/api/drive/files/move` request remains unchanged: `{ ids, targetFolderPath }`.

No new endpoint, folder creation request, or persistence format is introduced. A new path is materialized by the existing file-move behavior.

## Validation and error behavior

All destination input passes through `normalizeFolderPath`; the root directory is represented by an empty normalized path. The selector must not submit raw or unnormalized input.

The existing selection guard remains in place. Request failures remain visible through the current error path, and `performFolderMove` continues restoring the prior rows and folder snapshot. The dialog stays open after a failed confirmation so the administrator can inspect or change the destination and retry. It closes after a successful move, a same-folder no-op, or an explicit cancellation. Cancellation is unavailable while a request is active.

## Accessibility and localization

The dialog, selector placeholder, root option, confirm action, and cancel action use the existing translation mechanism. Chinese and English message tables receive equivalent labels. The selector supports keyboard focus, text filtering, arrow-key selection, and Enter confirmation through Element UI behavior.

## Testing

Automated tests must verify:

- the batch action still refuses to open without selected files;
- opening seeds the selector with the current folder;
- root and normalized existing paths are listed once and in deterministic order;
- an existing path can be selected and submitted;
- a path absent from `folders` can be entered and submitted;
- root submission sends an empty `targetFolderPath`;
- cancellation sends no request and changes no file state;
- same-folder selection remains a no-op and closes the dialog;
- unmatched visible text is submitted without requiring an option-selection event;
- a failed request restores previous state and leaves the dialog available for retry;
- Chinese and English labels required by the dialog exist.

The existing Drive contract and folder move regression tests remain unchanged because the backend request shape and semantics do not change.

## Out of scope

- Changing `/app/drive` folder-row move behavior.
- Adding a hierarchical tree picker.
- Creating folders through a separate API call before moving files.
- Changing drag-and-drop folder moves.
- Changing folder rename, deletion, or backend path semantics.
