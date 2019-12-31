import * as vscode from 'vscode';
import * as lc from 'vscode-languageclient';
import * as seedrandom_ from 'seedrandom';
const seedrandom = seedrandom_; // https://github.com/jvandemo/generator-angular2-library/issues/221#issuecomment-355945207

import { loadThemeColors, TextMateRuleSettings } from './load_theme_colors';
import * as scopesMapper from './scopes_mapper';

import { Ctx } from './ctx';

export function activateHighlighting(ctx: Ctx) {
    const highlighter = new Highlighter(ctx);

    ctx.client.onReady().then(() => {
        ctx.client.onNotification(
            'rust-analyzer/publishDecorations',
            (params: PublishDecorationsParams) => {
                if (!ctx.config.highlightingOn) return;

                const targetEditor = vscode.window.visibleTextEditors.find(
                    editor => {
                        const unescapedUri = unescape(
                            editor.document.uri.toString(),
                        );
                        // Unescaped URI looks like:
                        // file:///c:/Workspace/ra-test/src/main.rs
                        return unescapedUri === params.uri;
                    },
                );
                if (!targetEditor) return;

                highlighter.setHighlights(targetEditor, params.decorations);
            },
        );
    });

    vscode.workspace.onDidChangeConfiguration(
        _ => highlighter.removeHighlights(),
        ctx.subscriptions,
    );

    vscode.window.onDidChangeActiveTextEditor(
        async (editor: vscode.TextEditor | undefined) => {
            if (!editor || editor.document.languageId !== 'rust') return;
            if (!ctx.config.highlightingOn) return;

            const params: lc.TextDocumentIdentifier = {
                uri: editor.document.uri.toString(),
            };
            const decorations = await ctx.sendRequestWithRetry<Decoration[]>(
                'rust-analyzer/decorationsRequest',
                params,
            );
            highlighter.setHighlights(editor, decorations);
        },
        ctx.subscriptions,
    );
}

interface PublishDecorationsParams {
    uri: string;
    decorations: Decoration[];
}

interface Decoration {
    range: lc.Range;
    tag: string;
    bindingHash?: string;
}

// Based on this HSL-based color generator: https://gist.github.com/bendc/76c48ce53299e6078a76
function fancify(seed: string, shade: 'light' | 'dark') {
    const random = seedrandom(seed);
    const randomInt = (min: number, max: number) => {
        return Math.floor(random() * (max - min + 1)) + min;
    };

    const h = randomInt(0, 360);
    const s = randomInt(42, 98);
    const l = shade === 'light' ? randomInt(15, 40) : randomInt(40, 90);
    return `hsl(${h},${s}%,${l}%)`;
}

class Highlighter {
    private ctx: Ctx;
    private decorations: Map<
        string,
        vscode.TextEditorDecorationType
    > | null = null;

    constructor(ctx: Ctx) {
        this.ctx = ctx;
    }

    public removeHighlights() {
        if (this.decorations == null) {
            return;
        }

        // Decorations are removed when the object is disposed
        for (const decoration of this.decorations.values()) {
            decoration.dispose();
        }

        this.decorations = null;
    }

    public setHighlights(editor: vscode.TextEditor, highlights: Decoration[]) {
        // Initialize decorations if necessary
        //
        // Note: decoration objects need to be kept around so we can dispose them
        // if the user disables syntax highlighting
        if (this.decorations == null) {
            this.decorations = initDecorations();
        }

        const byTag: Map<string, vscode.Range[]> = new Map();
        const colorfulIdents: Map<
            string,
            [vscode.Range[], boolean]
        > = new Map();
        const rainbowTime = this.ctx.config.rainbowHighlightingOn;

        for (const tag of this.decorations.keys()) {
            byTag.set(tag, []);
        }

        for (const d of highlights) {
            if (!byTag.get(d.tag)) {
                continue;
            }

            if (rainbowTime && d.bindingHash) {
                if (!colorfulIdents.has(d.bindingHash)) {
                    const mut = d.tag.endsWith('.mut');
                    colorfulIdents.set(d.bindingHash, [[], mut]);
                }
                colorfulIdents
                    .get(d.bindingHash)![0]
                    .push(
                        this.ctx.client.protocol2CodeConverter.asRange(d.range),
                    );
            } else {
                byTag
                    .get(d.tag)!
                    .push(
                        this.ctx.client.protocol2CodeConverter.asRange(d.range),
                    );
            }
        }

        for (const tag of byTag.keys()) {
            const dec = this.decorations.get(
                tag,
            ) as vscode.TextEditorDecorationType;
            const ranges = byTag.get(tag)!;
            editor.setDecorations(dec, ranges);
        }

        for (const [hash, [ranges, mut]] of colorfulIdents.entries()) {
            const textDecoration = mut ? 'underline' : undefined;
            const dec = vscode.window.createTextEditorDecorationType({
                light: { color: fancify(hash, 'light'), textDecoration },
                dark: { color: fancify(hash, 'dark'), textDecoration },
            });
            editor.setDecorations(dec, ranges);
        }
    }
}

function initDecorations(): Map<
    string,
    vscode.TextEditorDecorationType
> {
    const themeColors = loadThemeColors();

    const decoration = (
        tag: string,
        textDecoration?: string,
    ): [string, vscode.TextEditorDecorationType] => {
        const rule = scopesMapper.toRule(tag, it => themeColors.get(it));

        if (rule) {
            const decor = createDecorationFromTextmate(rule);
            return [tag, decor];
        } else {
            const fallBackTag = 'ralsp.' + tag;
            // console.log(' ');
            // console.log('Missing theme for: <"' + tag + '"> for following mapped scopes:');
            // console.log(scopesMapper.find(tag));
            // console.log('Falling back to values defined in: ' + fallBackTag);
            // console.log(' ');
            const color = new vscode.ThemeColor(fallBackTag);
            const decor = vscode.window.createTextEditorDecorationType({
                color,
                textDecoration,
            });
            return [tag, decor];
        }
    };

    const decorations: Iterable<[
        string,
        vscode.TextEditorDecorationType,
    ]> = [
            decoration('comment'),
            decoration('string'),
            decoration('keyword'),
            decoration('keyword.control'),
            decoration('keyword.unsafe'),
            decoration('function'),
            decoration('parameter'),
            decoration('constant'),
            decoration('type.builtin'),
            decoration('type.generic'),
            decoration('type.lifetime'),
            decoration('type.param'),
            decoration('type.self'),
            decoration('type'),
            decoration('text'),
            decoration('attribute'),
            decoration('literal'),
            decoration('literal.numeric'),
            decoration('literal.char'),
            decoration('literal.byte'),
            decoration('macro'),
            decoration('variable'),
            decoration('variable.mut', 'underline'),
            decoration('field'),
            decoration('module'),
        ];

    return new Map<string, vscode.TextEditorDecorationType>(decorations);
}

function createDecorationFromTextmate(
    themeStyle: TextMateRuleSettings,
): vscode.TextEditorDecorationType {
    const decorationOptions: vscode.DecorationRenderOptions = {};
    decorationOptions.rangeBehavior = vscode.DecorationRangeBehavior.OpenOpen;

    if (themeStyle.foreground) {
        decorationOptions.color = themeStyle.foreground;
    }

    if (themeStyle.background) {
        decorationOptions.backgroundColor = themeStyle.background;
    }

    if (themeStyle.fontStyle) {
        const parts: string[] = themeStyle.fontStyle.split(' ');
        parts.forEach(part => {
            switch (part) {
                case 'italic':
                    decorationOptions.fontStyle = 'italic';
                    break;
                case 'bold':
                    decorationOptions.fontWeight = 'bold';
                    break;
                case 'underline':
                    decorationOptions.textDecoration = 'underline';
                    break;
                default:
                    break;
            }
        });
    }
    return vscode.window.createTextEditorDecorationType(decorationOptions);
}
