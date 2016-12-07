/**
 * Created by joel on 8/20/16.
 */

import CodeMirror from 'codemirror';
import {defaults, strip, state} from './utils';
import {Expression, modes} from './expression';
import {send} from './connect';
import {keywords} from './keywords';

const marks = [];

function tab(sign) {
    const direction = sign ? 1 : -1;
    const indentation = sign ? 'indentMore' : 'indentLess';
    return cm => view(cm, direction) || hint(cm, sign) || cm.execCommand(indentation);
}

const editor_element = document.getElementById('editor');
const editor = CodeMirror(editor_element, {
    mode: 'scheme',
    theme: defaults.theme,
    styleActiveLine: true,
    autoCloseBrackets: true,
    autoMatchParens: true,
    matchBrackets: true,
    indentUnit: 2,
    indentWithTabs: false,
    keyMap: defaults.keyMap,
    value: ';;;; Lambda v0.1\n\n',
    extraKeys: CodeMirror.normalizeKeyMap({
        'Tab': tab(true),
        'Shift-Tab': tab(false),
    })
});

editor.setCursor(2, 0);

CodeMirror.commands.eval_document = eval_document;
CodeMirror.commands.eval_expression = eval_expression;
CodeMirror.registerHelper('hintWords', 'scheme', keywords.sort());

function range(a, b, c) {
    return (b.line >= a.line) && (b.line <= c.line);
}

function eq(a, b) {
    return (a.line === b.line) && (a.ch === b.ch);
}

function hint(cm, sign) {
    if (sign) {
        const start = cm.getCursor('from');
        const end = cm.getCursor('to');
        if (eq(start, end) && /^ *$/.test(cm.getLine(start.line).substring(0, start.ch))) return false;
        cm.showHint();
    }
    return sign;
}

function view(cm, delta) {
    const start = cm.getCursor('from');
    const end = cm.getCursor('to');
    const update = ({from, to}) => range(start, from, end) || range(start, to, end);

    const updates = marks.filter(mark => update(mark.find() || {from: -1, to: -1}));
    if (updates.length === 0) return false;
    const index = Math.abs((updates[0].expression.index + delta) % modes.length);
    updates.forEach(mark => mark.expression.update(index) && mark.changed());
    return true;
}

const complain_notification = document.createElement('span');

complain_notification.textContent = 'Resolve error before continuing evaluation';

function complain(cm) {
    cm.openNotification(complain_notification, {duration: 3000});
}

function eval_expression(cm) {
    if (state.error) complain(cm);
    else {
        const position = cm.getCursor();
        const {start, end} = get_outer_expression(cm, position);
        const {line} = end;
        const value = cm.getRange(start, end);
        state.expressions = false;
        evaluate(value, {line});
    }
}

function eval_document(cm) {
    if (state.error) complain(cm);
    else {
        const expressions = [];
        let open = false;
        cm.eachLine(line_handle => {
            const line = cm.getLineNumber(line_handle);
            const tokens = cm.getLineTokens(line);
            tokens.forEach(token => {
                const {start, end, type, state: {depth, mode}} = token;
                if (depth === 0 && mode !== 'comment') {
                    if (type === 'bracket') {
                        if (open) {
                            expressions.push({start: open, end: {line_handle, end}});
                            open = false;
                        } else open = {line_handle, start};
                    } else if (type === 'comment') {

                    } else expressions.push({start: {line_handle, start}, end: {line_handle, end}});
                }
            });
        });
        if (expressions.length > 0) {
            state.expressions = expressions;
            pop_expression();
        } else state.expressions = false;
    }
}

const traverse_tokens = (predicate, callback) => function(cm, {line, ch}) {
    let tokens = cm.getLineTokens(line);
    for (tokens = tokens.filter(token => token.start < ch); line > -1; tokens = cm.getLineTokens(--line))
        for (let i = tokens.length - 1; i > -1; i--)
            if (predicate(tokens[i]))
                return callback(line, tokens[i]);
};

function select_expression(line, token) {
    const start = {line, ch: token.start}, end = {line, ch: token.end};
    if (token.type === 'bracket') return get_paren_block(end);
    else if (token.type === 'string') start.ch -= 1;
    return {start, end};
}

const get_outer_expression = traverse_tokens(token => token.state.depth === 0, select_expression);

function get_paren_block(position) {
    const parens = editor.findMatchingBracket(position);
    if (parens && parens.match) {
        const start = parens.forward ? parens.from : parens.to;
        const end = parens.forward ? parens.to : parens.from;
        end.ch += 1;
        state.position = {line: end.line + 1, ch: 0};
        editor.setCursor(state.position);
        editor.scrollIntoView();
        return {start, end}
    } else return false;
}

function evaluate(value, position) {
    state.position = position;
    send('eval', strip(value) + '\n', true);
}

function pop_expression() {
    const [{start, end}] = state.expressions.splice(0, 1);
    const from = {line: editor.getLineNumber(start.line_handle), ch: start.start};
    const to = {line: editor.getLineNumber(end.line_handle), ch: end.end};
    const text = editor.getRange(from, to);
    const {line} = to;
    evaluate(text, {line});
}

function push([text, latex, flex]) {
    if (state.error) {

    } else {
        const {position} = state;
        if (position) {
            editor.setCursor(position);
            editor.replaceRange('\n' + strip(text) + '\n', position, position);
            state.position = editor.getCursor();
            if (latex) {
                const expression = new Expression(text, latex, defaults.mode_index);
                const start = {line: position.line + 1, ch: 0};
                const end = {line: state.position.line - 1};
                const mark = editor.markText(start, end, {
                    replacedWith: expression.node,
                    inclusiveLeft: false,
                    inclusiveRight: true
                });
                expression.mark = mark;
                mark.expression = expression;
                marks.push(mark);
            }
            if (flex) {
                const [id, args, vals, out] = flex;
            }
        }
        if (state.expressions && state.expressions.length > 0) pop_expression();
    }
}

export {editor, editor_element, push, view}