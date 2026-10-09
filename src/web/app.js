const app = document.getElementById('app');

const state = {
  notice: null,
  lastBuild: null,
  buildAbortController: null,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function bannerHtml(message, type = 'success') {
  if (!message) {
    return '';
  }
  return `<div class="banner ${type}">${escapeHtml(message)}</div>`;
}

async function api(pathname, options = {}) {
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
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || payload.message || `请求失败：${response.status}`);
  }

  return payload;
}

function projectRows(projects) {
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

function envRows(envs) {
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

function buildRows(builds) {
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

function formatBytes(bytes) {
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

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || '-');
  }
  return date.toLocaleString();
}

function absoluteUrl(pathname) {
  return new URL(pathname, window.location.origin).toString();
}

async function copyBuildLink(pathname) {
  const url = absoluteUrl(pathname);
  try {
    await navigator.clipboard.writeText(url);
    state.notice = { type: 'success', message: '下载链接已复制' };
    await loadRoute();
  } catch {
    window.prompt('复制下载链接', url);
  }
}

function projectModalHtml(mode = 'create', data = {}) {
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

function envModalHtml(data = {}) {
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

function buildModalHtml() {
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

function buildResultHtml(result) {
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

function createBuildStreamState() {
  return {
    modal: document.getElementById('build-modal'),
    title: document.getElementById('build-modal-title'),
    step: document.getElementById('build-step'),
    log: document.getElementById('build-log'),
    closeButton: document.getElementById('close-build-modal'),
  };
}

function renderHome(projects) {
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

  bindProjectModal({ mode: 'create' });
  bindNavigationButtons();
}

function renderProject(project, envs, builds) {
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
        ${buildRows(builds.map((build) => ({ ...build, projectName: project.name })))}
      </div>
      ${projectModalHtml('edit', project)}
      ${envModalHtml()}
      ${buildModalHtml()}
    </div>
  `;

  bindProjectModal({ mode: 'edit', project });
  bindEnvModal(project.name);
  bindBuildButtons(project.name);
  bindBuildCopyButtons();
  bindNavigationButtons();
  bindBuildResultToggle();
}

function openModal(modal) {
  modal.hidden = false;
  const focusTarget = modal.querySelector('input, textarea, button');
  focusTarget && focusTarget.focus();
}

function closeModal(modal) {
  modal.hidden = true;
}

function bindProjectModal({ mode, project }) {
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

  function bindNavigationButtons() {
    document.querySelectorAll('.js-open-project, .js-download-build').forEach((button) => {
      button.addEventListener('click', () => {
        const href = button.dataset.href;
        if (href) {
          window.location.href = href;
        }
      });
    });
  }

  function bindBuildResultToggle() {
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
      openEditDialog({ dataset: project });
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
        await api(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
        state.notice = { type: 'success', message: `项目 ${name} 已删除` };
        await loadRoute();
      } catch (error) {
        state.notice = { type: 'error', message: error.message || String(error) };
        await loadRoute();
      }
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      resetProjectModal();
      closeModal(modal);
    });
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      resetProjectModal();
      closeModal(modal);
    }
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
        state.notice = { type: 'success', message: `项目 ${payload.name} 已更新` };
      } else {
        await api('/api/projects', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        state.notice = { type: 'success', message: `项目 ${payload.name} 创建成功` };
      }
      closeModal(modal);
      await loadRoute();
    } catch (error) {
      state.notice = { type: 'error', message: error.message || String(error) };
      await loadRoute();
    }
  }, { once: true });
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
        state.notice = { type: 'success', message: `环境 ${name} 已删除` };
        await loadRoute();
      } catch (error) {
        state.notice = { type: 'error', message: error.message || String(error) };
        await loadRoute();
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
      await loadRoute();
    } catch (error) {
      state.notice = { type: 'error', message: error.message || String(error) };
      await loadRoute();
    }
  }, { once: true });
}

function bindBuildButtons(projectName) {
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

function bindBuildCopyButtons() {
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
        api(deleteUrl, { method: 'GET' })
            .then(() => {
                state.notice = { type: 'success', message: '构建产物已删除' };
                loadRoute();
            })
            .catch((error) => {
                state.notice = { type: 'error', message: error.message || String(error) };
                loadRoute();
            });
    });
  });
}

function bindBuildResultToggle() {
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
        state.notice = { type: 'success', message: event.message || '构建完成' };
        if (modalState?.modal) {
          modalState.modal.hidden = true;
        }
        setTimeout(() => {
          loadRoute();
        }, 800);
        return;
      }
      if (event.type === 'error') {
        appendBuildLog(modalState, `\n[错误] ${event.message || '构建失败'}\n`);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
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

function bindNavigationButtons() {
  document.querySelectorAll('.js-open-project, .js-download-build').forEach((button) => {
    button.addEventListener('click', () => {
      const href = button.dataset.href;
      if (href) {
        window.location.href = href;
      }
    });
  });
}

async function loadRoute() {
  const pathname = decodeURIComponent(location.pathname);
  state.lastBuild = state.lastBuild && state.lastBuild.projectName === pathname.split('/')[2] ? state.lastBuild : null;

  try {
    if (pathname === '/' || pathname === '/index.html') {
      const data = await api('/api/projects');
      renderHome(data.projects || []);
      return;
    }

    if (pathname.startsWith('/projects/')) {
      const projectName = pathname.split('/')[2];
      const data = await api(`/api/projects/${encodeURIComponent(projectName)}`);
      renderProject(data.project, data.envs || [], data.builds || []);
      return;
    }

    const data = await api('/api/projects');
    renderHome(data.projects || []);
  } catch (error) {
    app.innerHTML = `
      <div class="wrap">
        <div class="banner error">${escapeHtml(error.message || String(error))}</div>
        <div class="card">
          <a href="/">返回首页</a>
        </div>
      </div>
    `;
  } finally {
    state.notice = null;
  }
}

window.addEventListener('popstate', () => {
  loadRoute();
});

loadRoute();
