import {escapeHtml, api} from "./lib/common.js";
import {renderHome} from "./lib/project.js";
import {renderProject} from "./lib/env.js";
import {state} from "./lib/state.js";

const index = document.getElementById('app');

async function loadRoute() {
    const pathname = decodeURIComponent(location.pathname);
    state.lastBuild = state.lastBuild && state.lastBuild.projectName === pathname.split('/')[2] ? state.lastBuild : null;

    try {
        if (pathname === '/' || pathname === '/index.html') {
            const data = await api('/api/projects');
            renderHome(index, data.projects || []);
            return;
        }

        if (pathname.startsWith('/projects/')) {
            const projectName = pathname.split('/')[2];
            const data = await api(`/api/projects/${encodeURIComponent(projectName)}`);
            renderProject(index, data.project, data.envs || [], data.builds || []);
            return;
        }

        const data = await api('/api/projects');
        renderHome(index, data.projects || []);
    } catch (error) {
        index.innerHTML = `
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

state.reloader = loadRoute


window.addEventListener('popstate', loadRoute);

loadRoute();
