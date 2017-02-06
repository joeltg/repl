/**
 * Created by joel on 8/20/16.
 */

import CodeMirror from 'codemirror';
import {defaults, strip, state, test} from '../utils';
import {Expression} from '../graphics/expression';
import {send} from '../connect';
import {keywords} from './keywords';

const marks = [];
const prefix = '#; ';
let highlight = null;

function tab(sign) {
    const direction = sign ? 1 : -1;
    const indentation = sign ? 'indentMore' : 'indentLess';
    return cm => cm_view(cm, direction) || cm.execCommand(indentation);
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
    value: ';;;; Lambda v0.3\n\n',
    extraKeys: CodeMirror.normalizeKeyMap({
        'Tab': tab(true),
        'Shift-Tab': tab(false),
    })
});
window.cm = editor;
editor.setCursor(2, 0);
CodeMirror.commands['clear-values'] = clear_values;
CodeMirror.commands['eval-document']= eval_document;
CodeMirror.commands['eval-expression'] = eval_expression;
CodeMirror.registerHelper('hintWords', 'scheme', keywords.sort());

function cm_view(cm, delta) {
    const {line} = cm.getCursor();
    const clear = cm.getLine(line) === '';
    const match = l => (l === line) || (clear && l === line - 1);
    const mark = marks.find(mark => match(cm.getLineNumber(mark.line)));
    if (mark) {
        const {expression} = mark;
        const radix = expression.modes.length;
        const index = (expression.index + delta + radix) % radix;
        mark.expression.update(index);
        mark.changed();
        return true;
    }
    return false;
}

function predicate({state: {depth, mode}, type}) {
    if (type === 'comment' || mode === 'comment' || mode === 's-expr-comment') return false;
    return depth === 0;
}

function find_next_expression(cm, {line, ch}) {
    const lines = cm.lineCount();
    for (let t = cm.getLineTokens(line).filter(({start}) => start > ch); line < lines; t = cm.getLineTokens(++line)) {
        for (let i = 0; i < t.length; i++) {
            const token = t[i];
            if (predicate(token)) {
                return {line, token};
            }
        }
    }
    return null;
}

function find_previous_expression(cm, {line, ch}) {
    // father forgive me, for I know not what I do
    for (let t = cm.getLineTokens(line).filter(({start}) => start < ch); line >= 0; t = cm.getLineTokens(--line)) {
        for (let i = t.length - 1; i >= 0; i--) {
            const token = t[i];
            if (predicate(token)) {
                return {line, token};
            }
        }
    }
    return null;
}

function select_expression(cm, line, token) {
    const start = {line, ch: token.start}, end = {line, ch: token.end};
    if (token.type === 'paren') {
        return select_paren(end);
    } else if (token.type === 'string') {
        const backward = select_string_backward(cm, token, start);
        const forward = select_string_forward(cm, token, end);
        return {start: backward, end: forward};
    } else {
        return {start, end};
    }
}

function select_string_forward(cm, {string}, end) {
    if (string[string.length - 1] === '"') {
        return end;
    } else {
        const next = find_next_expression(cm, end);
        if (next && next.token.type === 'string') {
            const {line, token} = next;
            return select_string_forward(cm, token, {line, ch: token.end});
        } else {
            return null;
        }
    }
}

function select_string_backward(cm, {string}, start) {
    if (string[0] === '"') {
        return start;
    } else {
        const prev = find_previous_expression(cm, start);
        if (prev && prev.token.type === 'string') {
            const {line, token} = prev;
            return select_string_backward(cm, token, {line, ch: token.start});
        } else {
            return null;
        }
    }
}

function select_paren(position) {
    const brackets = editor.findMatchingBracket(position);
    if (brackets && brackets.match) {
        const {forward, from, to} = brackets;
        const start = forward ? from : to;
        const end = forward ? to : from;
        end.ch += 1;
        return {start, end};
    } else {
        return null;
    }
}

function thing(cm) {
    if (cm.somethingSelected()) {
        if (highlight) {
            highlight.clear();
        }
        highlight = null;
    } else {
        const position = cm.getCursor();
        const previous = find_previous_expression(cm, position);
        if (previous) {
            const {line, token} = previous;
            const expression = select_expression(cm, line, token);
            if (expression) {
                const {start, end} = expression;
                if (start && end) {
                    if (highlight) {
                        highlight.clear();
                    }
                    highlight = cm.markText(start, end, {startStyle: 'cm-ce', endStyle: 'cm-ce'});
                } else {
                    if (highlight) {
                        highlight.clear();
                    }
                    highlight = null;
                }
            }
        }
    }
}

// editor.on('cursorActivity', thing);

function eval_expression(cm) {
    state.expressions = [];
    const position = cm.getCursor();
    const previous = find_previous_expression(cm, position);
    if (previous) {
        const {line, token} = previous;
        const expression = select_expression(cm, line, token);
        if (expression) {
            const {start, end} = expression;
            if (start && end) {
                const value = cm.getRange(start, end);
                return evaluate(cm, value, end);
            }
        }
    }
    console.error('could not select expression');
}

function eval_document(cm) {
    const expressions = [];
    let open = false;
    const lines = [];
    cm.eachLine(e => lines.push(e));
    lines.filter(test).forEach(function(handle) {
        const line = cm.getLineNumber(handle);
        const tokens = cm.getLineTokens(line);
        tokens.forEach(function({start, end, type, state: {depth, mode}}) {
            if (depth === 0 && mode !== 'comment') {
                if (type === 'bracket') {
                    if (open) {
                        expressions.push({start: open, end: {line: handle, ch: end}});
                        open = false;
                    } else {
                        open = {line: handle, ch: start};
                    }
                } else if (type === 'comment') {

                } else {
                    expressions.push({start: {line: handle, ch: start}, end: {line: handle, ch: end}});
                }
            }
        });
    });
    if (expressions.length > 0) {
        state.expressions = expressions;
        pop_expression(cm);
    } else {
        state.expressions = [];
    }
}

function evaluate(cm, value, position) {
    state.position = position;
    cm.setCursor(state.position);

    // cm.setCursor(position);
    // cm.replaceRange('\n', position);
    // state.position = cm.getCursor();

    send('eval', value.trim() + '\n', true);
}

function pop_expression(cm) {
    const [{start, end}] = state.expressions.splice(0, 1);
    const from = {line: cm.getLineNumber(start.line), ch: start.ch};
    const to = {line: cm.getLineNumber(end.line), ch: end.ch};
    cm.setCursor(to);
    const text = cm.getRange(from, to);
    const {line} = to;
    evaluate(cm, text, {line});
}

function value([text, pretty, latex]) {
    const {position, expressions} = state;
    const {line} = position;

    const nextLine = editor.getLine(line + 1);
    const nextNextLine = editor.getLine(line + 2);

    if (nextLine && !test(nextLine)) editor.replaceRange('\n\n', position, {line: line + 2});
    else if (nextLine || nextLine === undefined) editor.replaceRange('\n\n', position);
    else if (nextNextLine || nextNextLine === undefined) editor.replaceRange('\n', position);

    state.position = editor.getCursor();
    const start = {line: line + 1, ch: 0}, end = {line: line + 1};
    editor.replaceRange(prefix + strip(text), start, end);

    const expression = new Expression(text, pretty, latex);
    const mark = editor.addLineWidget(line + 1, expression.node);

    editor.addLineClass(mark.line, 'background', 'cm-e');
    expression.mark = mark;
    mark.expression = expression;
    marks.push(mark);
    editor.scrollIntoView();

    if (expressions.length > 0) {
        pop_expression(editor);
    }
}

function clear_values(cm) {
    const {line} = editor.getCursor();
    const lines = cm.getValue().split('\n');
    const first = lines.slice(0, line).filter(test);
    const last = lines.slice(line).filter(test);
    const newLine = first.length;
    cm.setValue(first.concat(last).join('\n'));
    cm.setCursor(newLine);
    cm.focus();
}

export {editor, editor_element, value, cm_view}