import * as vscode from 'vscode';
import * as ra from '../rust-analyzer-api';

import { Ctx, Cmd } from '../ctx';

export function parentModule(ctx: Ctx): Cmd {
    return async () => {
        const editor = ctx.activeRustEditor;
        const client = ctx.client;
        if (!editor || !client) return;

        const response = await client.sendRequest(ra.parentModule, {
            textDocument: { uri: editor.document.uri.toString() },
            position: client.code2ProtocolConverter.asPosition(
                editor.selection.active,
            ),
        });
        const loc = response[0];
        if (loc == null) return;

        const uri = client.protocol2CodeConverter.asUri(loc.uri);
        const range = client.protocol2CodeConverter.asRange(loc.range);

        const doc = await vscode.workspace.openTextDocument(uri);
        const e = await vscode.window.showTextDocument(doc);
        e.selection = new vscode.Selection(range.start, range.start);
        e.revealRange(range, vscode.TextEditorRevealType.InCenter);
    };
}
