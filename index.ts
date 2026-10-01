/*
 * Vencord Remastered sample plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import definePlugin from '@utils/types';
export default definePlugin({
    name: "RemasteredSmokeTest",
    description: "Harmless installation smoke test. Logs a message when explicitly enabled.",
    authors: [],
    start() { console.info('[Vencord Remastered] Git plugin smoke test started'); },
    stop() { console.info('[Vencord Remastered] Git plugin smoke test stopped'); }
});
