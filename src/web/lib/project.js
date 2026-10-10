import {api, bannerHtml, bindNavigationButtons, closeModal, escapeHtml, openModal} from "./common.js";
import {state,notice, noticeReload} from "./state.js";


export const  renderHome = (app,projects) =>{
    app.innerHTML = `
    <div class="wrap">
      <div class="header-row">
        <div>
          <h1>xie-cicd</h1>
          <p class="muted">项目、编译环境与构建归档管理</p>
        </div>
        <div class="actions">
          <button type="button" id="open-project-create">创建项目</button>
        </div>
      </div>
      ${bannerHtml(state.notice?.message, state.notice?.type || 'success')}
      <div class="card">
        <h2>项目列表</h2>
        ${projectRows(projects)}
      </div>
      ${projectModalHtml()}
    </div>
  `;

    bindProjectModal({mode: 'create'});
    bindNavigationButtons();
}



export const  bindProjectModal = ({ project}) => {
    const modal = document.getElementById('project-modal');
    const openCreateButton = document.getElementById('open-project-create');
    const openEditButton = document.getElementById('open-project-edit');
    const editButtons = document.querySelectorAll('.js-edit-project');
    const deleteButtons = document.querySelectorAll('.js-delete-project');
    const form = document.getElementById('project-form');
    const title = document.getElementById('project-modal-title');
    const submitButton = document.getElementById('project-submit-button');
    const nameInput = form.querySelector('input[name="name"]');
    const descriptionInput = form.querySelector('textarea[name="description"]');
    const gitUrlInput = form.querySelector('input[name="gitUrl"]');
    const closeButtons = modal.querySelectorAll('[data-close-modal]');
    const resetProjectModal = () => {
        title.textContent = '创建项目';
        submitButton.textContent = '创建项目';
        nameInput.readOnly = false;
    };

    if (openCreateButton) {
        openCreateButton.addEventListener('click', () => {
            resetProjectModal();
            form.dataset.mode = 'create';
            form.dataset.originalName = '';
            form.reset();
            openModal(modal);
        });
    }

    const openEditDialog = (source) => {
        title.textContent = '编辑项目';
        submitButton.textContent = '保存修改';
        form.dataset.mode = 'edit';
        form.dataset.originalName = source.dataset?.name || project?.name || '';
        nameInput.readOnly = true;
        nameInput.value = source.dataset?.name || project?.name || '';
        descriptionInput.value = source.dataset?.description || project?.description || '';
        gitUrlInput.value = source.dataset?.gitUrl || project?.gitUrl || '';
        openModal(modal);
    };

    if (openEditButton && project) {
        openEditButton.addEventListener('click', () => {
            openEditDialog({dataset: project});
        });
    }

    editButtons.forEach((button) => {
        button.addEventListener('click', () => openEditDialog(button));
    });

    deleteButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            const name = button.dataset.name || '';
            if (!name || !confirm(`确定删除项目 ${name} 吗？`)) {
                return;
            }
            try {
                await api(`/api/projects/${encodeURIComponent(name)}`, {method: 'DELETE'});
                notice('success', `项目 ${name} 已删除`);
                noticeReload()
            } catch (error) {
                notice('error', error.message || String(error));
                noticeReload()
            }
        });
    });

    closeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            resetProjectModal();
            closeModal(modal);
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
            name: form.elements.name.value.trim(),
            description: form.elements.description.value.trim(),
            gitUrl: form.elements.gitUrl.value.trim(),
        };

        try {
            if (form.dataset.mode === 'edit') {
                await api(`/api/projects/${encodeURIComponent(form.dataset.originalName)}/edit`, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
                notice('success', `项目 ${payload.name} 已更新`);
            } else {
                await api('/api/projects', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
                notice('success', `项目 ${payload.name} 创建成功`);
            }
            closeModal(modal);
            noticeReload()
        } catch (error) {
            notice('error', error.message || String(error));
            noticeReload()
        }
    }, {once: true});
}

/**
 * Generates HTML for a table of projects.
 * @param projects
 * @return {string}
 */
export const projectRows = (projects) => {
    if (!projects.length) {
        return '<p class="muted">暂无数据</p>';
    }

    return `
    <div class="table-shell">
      <table class="projects-table">
        <thead>
          <tr>
            <th>项目名称</th>
            <th>描述</th>
            <th>Git 地址</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${projects.map((project) => `
            <tr>
              <td><strong>${escapeHtml(project.name)}</strong></td>
              <td>${escapeHtml(project.description || '')}</td>
              <td>${escapeHtml(project.gitUrl || '')}</td>
              <td class="actions">
                <button
                  type="button"
                  class="icon-button js-open-project"
                  data-href="/projects/${encodeURIComponent(project.name)}"
                >查看</button>
                <button
                  type="button"
                  class="icon-button js-edit-project"
                  data-name="${escapeHtml(project.name)}"
                  data-description="${escapeHtml(project.description || '')}"
                  data-git-url="${escapeHtml(project.gitUrl || '')}"
                >编辑</button>
                <button
                  type="button"
                  class="icon-button js-delete-project"
                  data-name="${escapeHtml(project.name)}"
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
 * Generates HTML for the project modal.
 * @param mode
 * @param data
 */
export const projectModalHtml = (mode = 'create', data = {}) => {
    const title = mode === 'edit' ? '编辑项目' : '创建项目';
    const submitLabel = mode === 'edit' ? '保存修改' : '创建项目';
    const readOnly = mode === 'edit' ? 'readonly' : '';
    return `
    <div class="modal-backdrop" id="project-modal" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
        <header>
          <h2 id="project-modal-title">${title}</h2>
          <button type="button" class="icon-button" data-close-modal>关闭</button>
        </header>
        <form id="project-form">
          <label>项目名称（英文）
            <input name="name" required placeholder="my-project" value="${escapeHtml(data.name || '')}" ${readOnly} />
          </label>
          <label>项目描述
            <textarea name="description" placeholder="项目说明">${escapeHtml(data.description || '')}</textarea>
          </label>
          <label>项目代码 Git 地址
            <input name="gitUrl" required placeholder="https://github.com/owner/repo.git" value="${escapeHtml(data.gitUrl || '')}" />
          </label>
          <div class="actions">
            <button type="submit" id="project-submit-button">${submitLabel}</button>
            <button type="button" class="icon-button" data-close-modal>取消</button>
          </div>
        </form>
      </div>
    </div>
  `;
}
