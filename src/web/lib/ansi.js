import {escapeHtml} from "./common.js";

/**
 * ANSI 转义序列渲染器：把终端日志（Linux 下的带色输出）转换为 HTML 内联样式，
 * 使前端网页能够像终端一样显示颜色、加粗、下划线等效果。
 *
 * 支持：SGR 颜色（16 色 / 256 色 / RGB 真彩）、加粗、暗淡、下划线、反显，
 * 并会丢弃光标控制等非渲染类转义序列。
 */

const NORMAL_COLORS = [
    '#000000', '#cd3131', '#0dbc79', '#e5e510',
    '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
];
const BRIGHT_COLORS = [
    '#666666', '#f14c4c', '#23d18b', '#f5f543',
    '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5',
];
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

const toHex = (value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');

/**
 * 将 256 色调色板索引转换为十六进制颜色。
 * @param index
 * @return {string}
 */
const paletteColor = (index) => {
    if (index < 8) {
        return NORMAL_COLORS[index];
    }
    if (index < 16) {
        return BRIGHT_COLORS[index - 8];
    }
    if (index < 232) {
        const i = index - 16;
        const r = CUBE_LEVELS[Math.floor(i / 36) % 6];
        const g = CUBE_LEVELS[Math.floor(i / 6) % 6];
        const b = CUBE_LEVELS[i % 6];
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    const gray = 8 + (index - 232) * 10;
    return `#${toHex(gray)}${toHex(gray)}${toHex(gray)}`;
};

// CSI 序列：\x1b[...字母，捕获 SGR(m) 的参数；其余 CSI 序列直接丢弃
const SEQUENCE_PATTERN = /\x1b\[([\d;]*)([A-Za-z])|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b/g;

export class AnsiLogRenderer {
    constructor() {
        // 缓存跨数据块被截断的不完整转义序列
        this.pending = '';
        this.style = {};
    }

    /**
     * 将一段终端输出转换为 HTML 片段（文本内容会做 HTML 转义，安全）。
     * @param text
     * @return {string}
     */
    push(text) {
        let input = this.pending + text;
        this.pending = '';
        // 回车归一化为换行，避免进度条类输出出现杂乱字符
        input = input.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

        // 末尾若是不完整的转义序列，留到下一个数据块再解析
        const lastEsc = input.lastIndexOf('\x1b');
        if (lastEsc !== -1) {
            const rest = input.slice(lastEsc);
            if (/^\x1b\[[\d;]*$/.test(rest) || /^\x1b\][^\x07]*$/.test(rest) || rest === '\x1b') {
                this.pending = rest;
                input = input.slice(0, lastEsc);
            }
        }

        let html = '';
        let cursor = 0;
        let match;
        SEQUENCE_PATTERN.lastIndex = 0;
        while ((match = SEQUENCE_PATTERN.exec(input)) !== null) {
            html += this.emitText(input.slice(cursor, match.index));
            if (match[2] === 'm') {
                this.applySgr(match[1]);
            }
            // 其他转义序列（清屏、移动光标等）直接丢弃
            cursor = match.index + match[0].length;
        }
        html += this.emitText(input.slice(cursor));
        return html;
    }

    /**
     * 按当前样式把纯文本包装成 HTML。
     * @param text
     * @return {string}
     */
    emitText(text) {
        if (!text) {
            return '';
        }
        const escaped = escapeHtml(text);
        const css = this.styleToCss();
        return css ? `<span style="${css}">${escaped}</span>` : escaped;
    }

    styleToCss() {
        const parts = [];
        let fg = this.style.fg;
        let bg = this.style.bg;
        if (this.style.inverse) {
            [fg, bg] = [bg || '#000000', fg || '#e5e5e5'];
        }
        if (fg) parts.push(`color:${fg}`);
        if (bg) parts.push(`background-color:${bg}`);
        if (this.style.bold) parts.push('font-weight:700');
        if (this.style.dim) parts.push('opacity:0.75');
        if (this.style.underline) parts.push('text-decoration:underline');
        return parts.join(';');
    }

    /**
     * 处理 SGR（颜色和样式）参数序列。
     * @param raw 例如 "1;32" 或 "38;5;214"
     */
    applySgr(raw) {
        const params = (raw === '' ? [0] : raw.split(';').map((p) => (p === '' ? 0 : Number(p))));
        for (let i = 0; i < params.length; i += 1) {
            const code = params[i];
            if (code === 38 || code === 48) {
                const target = code === 38 ? 'fg' : 'bg';
                const mode = params[i + 1];
                if (mode === 5 && params[i + 2] !== undefined) {
                    this.style[target] = paletteColor(params[i + 2]);
                    i += 2;
                    continue;
                }
                if (mode === 2 && params[i + 4] !== undefined) {
                    this.style[target] = `#${toHex(params[i + 2])}${toHex(params[i + 3])}${toHex(params[i + 4])}`;
                    i += 4;
                    continue;
                }
                continue;
            }
            if (code >= 90 && code <= 97) {
                this.style.fg = BRIGHT_COLORS[code - 90];
                continue;
            }
            if (code >= 100 && code <= 107) {
                this.style.bg = BRIGHT_COLORS[code - 100];
                continue;
            }
            switch (code) {
                case 0:
                    this.style = {};
                    break;
                case 1:
                    this.style.bold = true;
                    break;
                case 2:
                    this.style.dim = true;
                    break;
                case 4:
                    this.style.underline = true;
                    break;
                case 7:
                    this.style.inverse = true;
                    break;
                case 22:
                    delete this.style.bold;
                    delete this.style.dim;
                    break;
                case 24:
                    delete this.style.underline;
                    break;
                case 27:
                    delete this.style.inverse;
                    break;
                case 39:
                    delete this.style.fg;
                    break;
                case 49:
                    delete this.style.bg;
                    break;
                default:
                    if (code >= 30 && code <= 37) {
                        this.style.fg = NORMAL_COLORS[code - 30];
                    } else if (code >= 40 && code <= 47) {
                        this.style.bg = NORMAL_COLORS[code - 40];
                    }
            }
        }
    }
}

/**
 * 一次性把整段终端输出转换为 HTML。
 * @param text
 * @return {string}
 */
export const ansiToHtml = (text) => {
    return new AnsiLogRenderer().push(String(text ?? ''));
};
