import {notice, state} from "./state.js";

/**
 * Escapes HTML special characters in a string to prevent XSS attacks.
 * @param value
 * @return {string}
 */
export const escapeHtml = (value) => {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * Generates HTML for a banner message with a specified type (e.g., success, error).
 * @param message
 * @param type
 * @return {string}
 */
export const bannerHtml = (message, type = 'success') => {
    if (!message) {
        return '';
    }
    return `<div class="banner ${type}">${escapeHtml(message)}</div>`;
}


/**
 * Makes an API request to the specified pathname with optional settings.
 * @param pathname
 * @param options
 * @return {Promise<{}>}
 */
export const api = async (pathname, options = {}) => {
    const response = await fetch(pathname, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
        ...options,
    });

    const text = await response.text();
    let payload = {};
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = {raw: text};
        }
    }

    if (!response.ok) {
        throw new Error(payload.error || payload.message || `请求失败：${response.status}`);
    }

    return payload;
}

/**
 * Formats a byte value into a human-readable string with appropriate units (B, KB, MB, GB).
 * @param bytes
 * @return {string}
 */
export const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes)) {
        return '-';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * Formats a date value into a human-readable string using the local date and time format.
 * @param value
 * @return {string}
 */
export const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value || '-');
    }
    return date.toLocaleString();
}

/**
 * Generates an absolute URL based on the current window location and the provided pathname.
 * @param pathname
 * @return {string}
 */
export const absoluteUrl = (pathname) => {
    return new URL(pathname, window.location.origin).toString();
}

export const bindNavigationButtons = () => {
    document.querySelectorAll('.js-open-project, .js-download-build').forEach((button) => {
        button.addEventListener('click', () => {
            const href = button.dataset.href;
            if (href) {
                window.location.href = href;
            }
        });
    });
}

export const openModal = (modal) => {
    modal.hidden = false;
    const focusTarget = modal.querySelector('input, textarea, button');
    focusTarget && focusTarget.focus();
}

export const closeModal = (modal) => {
    modal.hidden = true;
}

export const copyBuildLink = async (pathname) => {
    const url = absoluteUrl(pathname);
    try {
        await navigator.clipboard.writeText(url);
        notice('success', '下载链接已复制');
    } catch {
        // todo use modal
        window.prompt('复制下载链接', url);
    }
}