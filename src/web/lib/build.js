import {api, copyBuildLink, escapeHtml, formatBytes, formatDate} from "./common.js";
import {notice, noticeReload, state} from "./state.js";

export const  bindBuildCopyButtons = () => {
    document.querySelectorAll('.js-copy-build-link').forEach((button) => {
        button.addEventListener('click', () => {
            copyBuildLink(button.dataset.downloadUrl || '');
        });
    });

    document.querySelectorAll('.js-remove-build-link').forEach((button) => {
        button.addEventListener('click', () => {
            const deleteUrl = button.dataset.deleteUrl || '';
            if (!deleteUrl || !confirm('确定删除该构建产物吗？')) {
                return;
            }
            api(deleteUrl, {method: 'GET'})
                .then(() => {
                    notice('success', '构建产物已删除');
                    noticeReload()
                })
                .catch((error) => {
                    notice('error', error.message || String(error));
                    noticeReload()
                });
        });
    });
}

export const bindBuildResultToggle = () => {
    const toggleButton = document.querySelector('.js-toggle-build-log');
    const logPanel = document.getElementById('build-result-log');
    if (!toggleButton || !logPanel) {
        return;
    }

    toggleButton.addEventListener('click', () => {
        logPanel.hidden = !logPanel.hidden;
        toggleButton.textContent = logPanel.hidden ? '查看日志' : '隐藏日志';
    });
}

/**
 * 增加日志输出到构建日志面板中，并自动滚动到底部。
 * @param modalState
 * @param text
 */
function appendBuildLog(modalState, text) {
    if (!modalState?.log || !text) {
        return;
    }
    modalState.log.textContent += text;
    modalState.log.scrollTop = modalState.log.scrollHeight;
}

function clearBuildModal(modalState, titleText) {
    if (modalState?.title) {
        modalState.title.textContent = titleText || '开始编译';
    }
    if (modalState?.step) {
        modalState.step.textContent = '当前步骤：等待开始';
    }
    if (modalState?.log) {
        modalState.log.textContent = '';
    }
}

function createBuildStreamState() {
    return {
        modal: document.getElementById('build-modal'),
        title: document.getElementById('build-modal-title'),
        step: document.getElementById('build-step'),
        log: document.getElementById('build-log'),
        closeButton: document.getElementById('close-build-modal'),
    };
}


async function startBuildStream(projectName, envName, modalState) {
    if (!envName) {
        return;
    }

    state.buildAbortController?.abort();
    const controller = new AbortController();
    state.buildAbortController = controller;

    clearBuildModal(modalState, '开始编译');
    if (modalState?.title) {
        modalState.title.textContent = `开始编译：${envName}`;
    }
    if (modalState?.modal) {
        modalState.modal.hidden = false;
    }

    const endpoint = `/api/projects/${encodeURIComponent(projectName)}/envs/${encodeURIComponent(envName)}/build/stream`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            signal: controller.signal,
        });

        if (!response.ok || !response.body) {
            const message = await response.text();
            throw new Error(message || `请求失败：${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const consumeLine = (line) => {
            if (!line.trim()) {
                return;
            }
            const event = JSON.parse(line);
            if (event.type === 'start') {
                appendBuildLog(modalState, `${event.message || '开始构建'}\n`);
                return;
            }
            if (event.type === 'step') {
                const stepTitle = event.title || '处理中';
                if (modalState?.step) {
                    modalState.step.textContent = `当前步骤：${stepTitle}`;
                }
                appendBuildLog(modalState, `\n${event.message || stepTitle}\n`);
                return;
            }
            if (event.type === 'log') {
                appendBuildLog(modalState, event.text || '');
                return;
            }
            if (event.type === 'done') {
                if (modalState?.log) {
                    modalState.log.textContent = '';
                }
                if (modalState?.step) {
                    modalState.step.textContent = `当前步骤：${event.message || '构建完成'}`;
                }
                state.lastBuild = {
                    projectName,
                    archiveName: event.archiveName || '',
                    logOutput: event.logOutput || '',
                };
                state.notice = {type: 'success', message: event.message || '构建完成'};
                if (modalState?.modal) {
                    modalState.modal.hidden = true;
                }
                setTimeout(noticeReload, 800);
                return;
            }
            if (event.type === 'error') {
                appendBuildLog(modalState, `\n[错误] ${event.message || '构建失败'}\n`);
            }
        };

        while (true) {
            const {value, done} = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, {stream: true});
            let index = buffer.indexOf('\n');
            while (index >= 0) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                consumeLine(line);
                index = buffer.indexOf('\n');
            }
        }

        if (buffer.trim()) {
            consumeLine(buffer);
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            return;
        }
        appendBuildLog(modalState, `\n[错误] ${error.message || String(error)}\n`);
    } finally {
        if (state.buildAbortController === controller) {
            state.buildAbortController = null;
        }
    }
}


export const bindBuildButtons = (projectName) => {
    const modalState = createBuildStreamState();
    const openButtonList = document.querySelectorAll('.js-build-env');
    const closeBuildModal = () => {
        state.buildAbortController?.abort();
        state.buildAbortController = null;
        modalState.modal.hidden = true;
    };

    modalState.closeButton?.addEventListener('click', closeBuildModal);
    modalState.modal?.addEventListener('click', (event) => {
        if (event.target === modalState.modal) {
            closeBuildModal();
        }
    });

    openButtonList.forEach((button) => {
        button.addEventListener('click', () => {
            startBuildStream(projectName, button.dataset.env || '', modalState);
        });
    });
}

/**
 * Builds a table of build artifacts.
 * @param builds
 * @return {string}
 */
export const buildRows = (builds) => {
    if (!builds.length) {
        return '<p class="muted">暂无构建产物</p>';
    }

    return `
    <div class="table-shell">
      <table class="detail-table">
        <thead>
          <tr>
            <th>文件名</th>
            <th>大小</th>
            <th>构建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${builds.map((build) => `
            <tr>
              <td><code>${escapeHtml(build.name)}</code></td>
              <td>${formatBytes(build.size)}</td>
              <td>${formatDate(build.mtime)}</td>
              <td class="actions">
                <button
                  type="button"
                  class="icon-button js-copy-build-link"
                  data-download-url="/api/projects/${encodeURIComponent(build.projectName)}/builds/${encodeURIComponent(build.name)}"
                >复制下载链接</button>
                
                <button
                  type="button"
                  class="icon-button js-remove-build-link"
                  data-delete-url="/api/projects/${encodeURIComponent(build.projectName)}/build-delete/${encodeURIComponent(build.name)}"
                >删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Builds the HTML for the build modal.
 * @return {string}
 */
export const buildModalHtml = () => {
    return `
    <div class="modal-backdrop" id="build-modal" hidden>
      <div class="modal build-modal" role="dialog" aria-modal="true" aria-labelledby="build-modal-title">
        <header>
          <h2 id="build-modal-title">开始编译</h2>
          <button type="button" class="icon-button" id="close-build-modal">关闭</button>
        </header>
        <div class="build-step" id="build-step">当前步骤：等待开始</div>
        <pre class="build-log" id="build-log"></pre>
      </div>
    </div>
  `;
}

/**
 * Builds the HTML for the build result.
 * @param result
 * @return {string}
 */
export const buildResultHtml = (result) => {
    if (!result) {
        return '';
    }
    const archiveHtml = result.archiveName
        ? `<p>归档：<code>${escapeHtml(result.archiveName)}</code></p>
       <p class="actions">
         <button type="button" class="icon-button js-download-build" data-href="/api/projects/${encodeURIComponent(result.projectName)}/builds/${encodeURIComponent(result.archiveName)}">下载归档</button>
         <button type="button" class="icon-button js-toggle-build-log">查看日志</button>
       </p>`
        : '<p class="muted">本次构建未生成产物</p>';
    return `
    <div class="card">
      <h3>构建完成</h3>
      ${archiveHtml}
      <pre class="build-result-log" id="build-result-log" hidden>${escapeHtml(result.logOutput || '构建完成')}</pre>
    </div>
  `;
}