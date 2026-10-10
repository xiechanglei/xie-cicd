import {api, bannerHtml, bindNavigationButtons, closeModal, copyBuildLink, escapeHtml, openModal} from "./common.js";

import {notice, noticeReload, state} from "./state.js";
import {bindBuildButtons, bindBuildCopyButtons, bindBuildResultToggle, buildModalHtml, buildResultHtml, buildRows} from "./build.js";
import {bindProjectModal, projectModalHtml} from "./project.js";


export const renderProject = (app,project, envs, builds) => {
    const lastBuild = state.lastBuild && state.lastBuild.projectName === project.name ? state.lastBuild : null;
    app.innerHTML = `
    <div class="wrap">
      <div class="header-row">
        <div>
          <p><a href="/">← 返回首页</a></p>
          <h1>${escapeHtml(project.name)}</h1>
          <p class="muted">${escapeHtml(project.description || '')}</p>
          <p><strong>Git 地址：</strong>${escapeHtml(project.gitUrl || '')}</p>
        </div>
        <div class="actions">
          <button type="button" id="open-project-edit">编辑项目</button>
          <button type="button" id="open-env-create">创建编译环境</button>
        </div>
      </div>
      ${bannerHtml(state.notice?.message, state.notice?.type || 'success')}
      ${buildResultHtml(lastBuild)}
      <div class="card">
        <h2>编译环境</h2>
        ${envRows(envs)}
      </div>
      <div class="card">
        <h2>构建产物</h2>
        ${buildRows(builds.map((build) => ({...build, projectName: project.name})))}
      </div>
      ${projectModalHtml('edit', project)}
      ${envModalHtml()}
      ${buildModalHtml()}
    </div>
  `;

    bindProjectModal({mode: 'edit', project});
    bindEnvModal(project.name);
    bindBuildButtons(project.name);
    bindBuildCopyButtons();
    bindNavigationButtons();
    bindBuildResultToggle();
}




function bindEnvModal(projectName) {
    const modal = document.getElementById('env-modal');
    const openButton = document.getElementById('open-env-create');
    const editButtons = document.querySelectorAll('.js-edit-env');
    const deleteButtons = document.querySelectorAll('.js-delete-env');
    const lastestButtons = document.querySelectorAll('.js-lastest-env');
    if (!modal || !openButton) {
        return;
    }

    const form = document.getElementById('env-form');
    const title = document.getElementById('env-modal-title');
    const submitButton = document.getElementById('env-submit-button');
    const nameInput = form.querySelector('input[name="name"]');
    const descriptionInput = form.querySelector('textarea[name="description"]');
    const scriptInput = form.querySelector('textarea[name="script"]');
    const outputDirInput = form.querySelector('input[name="outputDir"]');
    const closeButtons = modal.querySelectorAll('[data-close-modal]');
    const resetEnvModal = () => {
        title.textContent = '创建编译环境';
        submitButton.textContent = '创建编译环境';
        nameInput.readOnly = false;
    };

    openButton.addEventListener('click', () => {
        resetEnvModal();
        form.dataset.mode = 'create';
        form.dataset.originalName = '';
        form.reset();
        openModal(modal);
    });

    const openEditDialog = (button) => {
        title.textContent = '编辑编译环境';
        submitButton.textContent = '保存修改';
        form.dataset.mode = 'edit';
        form.dataset.originalName = button.dataset.name || '';
        nameInput.readOnly = false;
        nameInput.value = button.dataset.name || '';
        descriptionInput.value = button.dataset.description || '';
        scriptInput.value = button.dataset.script || '';
        outputDirInput.value = button.dataset.outputDir || '';
        openModal(modal);
    };

    editButtons.forEach((button) => {
        button.addEventListener('click', () => openEditDialog(button));
    });

    deleteButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            const name = button.dataset.name || '';
            if (!name || !confirm(`确定删除环境 ${name} 吗？`)) {
                return;
            }
            try {
                await api(`/api/projects/${encodeURIComponent(projectName)}/envs/${encodeURIComponent(name)}`, {
                    method: 'DELETE',
                });
                notice('success', `环境 ${name} 已删除`);
                noticeReload()
            } catch (error) {
                notice('error', error.message || String(error));
                noticeReload()
            }
        });
    });
    lastestButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const name = button.dataset.name || '';
            if (name) {
                copyBuildLink(`/api/projects/${encodeURIComponent(projectName)}/envs/${encodeURIComponent(name)}/builds/latest`);
            }
        });
    });

    closeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            resetEnvModal();
            closeModal(modal);
        });
    });

    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            resetEnvModal();
            closeModal(modal);
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
            name: form.elements.name.value.trim(),
            description: form.elements.description.value.trim(),
            script: form.elements.script.value.trim(),
            outputDir: form.elements.outputDir.value.trim(),
        };

        try {
            const endpoint = form.dataset.mode === 'edit'
                ? `/api/projects/${encodeURIComponent(projectName)}/envs/${encodeURIComponent(form.dataset.originalName || payload.name)}/edit`
                : `/api/projects/${encodeURIComponent(projectName)}/envs`;
            await api(endpoint, {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            state.notice = {
                type: 'success',
                message: form.dataset.mode === 'edit'
                    ? `环境 ${payload.name} 已更新`
                    : `环境 ${payload.name} 创建成功`,
            };
            resetEnvModal();
            closeModal(modal);
            noticeReload()
        } catch (error) {
            state.notice = {type: 'error', message: error.message || String(error)};
            noticeReload()
        }
    }, {once: true});
}

/**
 * Generates HTML for a table of build environments.
 * @param envs
 * @return {string}
 */
export const envRows = (envs) => {
    if (!envs.length) {
        return '<p class="muted">暂无编译环境</p>';
    }

    return `
    <div class="table-shell">
      <table class="detail-table">
        <thead>
          <tr>
            <th>环境名称</th>
            <th>环境描述</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${envs.map((env) => `
            <tr>
              <td><strong>${escapeHtml(env.name)}</strong></td>
              <td>${escapeHtml(env.description || '')}</td>
              <td class="actions">
                <button type="button" class="js-build-env" data-env="${escapeHtml(env.name)}">开始编译</button>
                <button
                  type="button"
                  class="icon-button js-edit-env"
                  data-name="${escapeHtml(env.name)}"
                  data-description="${escapeHtml(env.description || '')}"
                  data-script="${escapeHtml(env.script || '')}"
                  data-output-dir="${escapeHtml(env.outputDir || '')}"
                >编辑</button>
                <button
                  type="button"
                  class="icon-button js-delete-env"
                  data-name="${escapeHtml(env.name)}"
                >删除</button>
                <button
                  type="button"
                  class="icon-button js-lastest-env"
                  data-name="${escapeHtml(env.name)}"
                >复制最新版本链接</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}


export const envModalHtml = (data = {}) => {
    return `
    <div class="modal-backdrop" id="env-modal" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="env-modal-title">
        <header>
          <h2 id="env-modal-title">创建编译环境</h2>
          <button type="button" class="icon-button" data-close-modal>关闭</button>
        </header>
        <form id="env-form">
          <label>环境名称（英文）
            <input name="name" required placeholder="prod" value="${escapeHtml(data.name || '')}" />
          </label>
          <label>环境描述
            <textarea name="description" placeholder="环境说明">${escapeHtml(data.description || '')}</textarea>
          </label>
          <label>构建脚本
            <textarea name="script" required placeholder="npm run build">${escapeHtml(data.script || '')}</textarea>
          </label>
          <label>输出目录
            <input name="outputDir" placeholder="dist（可为空）" value="${escapeHtml(data.outputDir || '')}" />
          </label>
          <div class="actions">
            <button type="submit" id="env-submit-button">创建编译环境</button>
            <button type="button" class="icon-button" data-close-modal>取消</button>
          </div>
        </form>
      </div>
    </div>
  `;
}