import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath, URL} from 'node:url';

import {
    buildArchiveName,
    ensureProjectStructure,
    listBuildArchives,
    listProjects,
    loadProjectConfig,
    pathExists,
    saveProjectConfig,
    toBuildDir,
    toConfigPath,
    toProjectDir,
    toSrcDir,
    validateName,
} from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.join(__dirname, 'web');

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text, headers = {}) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...headers,
    });
    res.end(text);
}

function writeStreamEvent(res, event) {
    res.write(`${JSON.stringify(event)}\n`);
}

function sendRedirect(res, location) {
    res.writeHead(303, {Location: location});
    res.end();
}

function createHttpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function contentTypeFor(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.html':
            return 'text/html; charset=utf-8';
        case '.css':
            return 'text/css; charset=utf-8';
        case '.js':
            return 'application/javascript; charset=utf-8';
        case '.json':
            return 'application/json; charset=utf-8';
        case '.svg':
            return 'image/svg+xml; charset=utf-8';
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.gif':
            return 'image/gif';
        case '.ico':
            return 'image/x-icon';
        default:
            return 'application/octet-stream';
    }
}

function collectRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalLength = 0;

        req.on('data', (chunk) => {
            totalLength += chunk.length;
            if (totalLength > 1_000_000) {
                reject(new Error('请求体过大'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function parseBody(req, rawBody) {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
        return rawBody ? JSON.parse(rawBody) : {};
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
        return Object.fromEntries(new URLSearchParams(rawBody));
    }
    return rawBody ? JSON.parse(rawBody) : {};
}

async function readBody(req) {
    const rawBody = await collectRequestBody(req);
    if (!rawBody) {
        return {};
    }
    try {
        return parseBody(req, rawBody);
    } catch {
        throw new Error('请求体格式不正确');
    }
}

async function getProjectConfig(projectName) {
    if (!(await pathExists(toConfigPath(projectName)))) {
        throw createHttpError(404, '项目不存在');
    }
    return loadProjectConfig(projectName);
}

async function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            shell: false,
            ...options,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve({stdout, stderr});
                return;
            }
            reject(new Error(`${command} exited with code ${code}\n${stdout}${stderr}`));
        });
    });
}

async function runCommandStream(command, args, options = {}, emitLog) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            shell: false,
            ...options,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            emitLog?.('stdout', text);
        });
        child.stderr?.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            emitLog?.('stderr', text);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve({stdout, stderr});
                return;
            }
            reject(new Error(`${command} exited with code ${code}\n${stdout}${stderr}`));
        });
    });
}

/**
 * 规范化并校验环境配置里的 Hook 地址，允许为空。
 * @param raw
 * @return {string}
 */
function normalizeHookUrl(raw) {
    const hookUrl = (raw || '').trim();
    if (!hookUrl) {
        return '';
    }
    let parsed;
    try {
        parsed = new URL(hookUrl);
    } catch {
        throw new Error('Hook 地址格式不正确');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Hook 地址必须以 http:// 或 https:// 开头');
    }
    return hookUrl;
}

/**
 * 调用环境配置的 Hook 地址，将响应内容（普通文本或流式输出）逐块写入构建日志。
 * Hook 调用失败不会中断构建（此时产物已生成），仅在日志中记录失败信息。
 * @param hookUrl
 * @param emitLog
 * @return {Promise<string>} Hook 的完整输出内容
 */
async function callBuildHook(hookUrl, emitLog) {
    const chunks = [];
    const log = (stream, text) => {
        if (!text) {
            return;
        }
        chunks.push(text);
        emitLog?.(stream, text);
    };

    log('stdout', `开始调用 Hook：${hookUrl}\n`);
    try {
        const response = await fetch(hookUrl, {
            method: 'GET',
            redirect: 'follow',
            // 防止 Hook 端无响应导致构建流一直挂起
            signal: AbortSignal.timeout(600_000),
        });
        log('stdout', `Hook 响应：HTTP ${response.status} ${response.statusText}\n`);

        if (response.body) {
            // 逐块读取并输出，支持普通文本和流式（chunked / SSE）响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const {value, done} = await reader.read();
                if (done) {
                    break;
                }
                log('stdout', decoder.decode(value, {stream: true}));
            }
            log('stdout', decoder.decode());
        } else {
            log('stdout', await response.text());
        }
    } catch (error) {
        log('stderr', `Hook 调用失败：${error.message || String(error)}\n`);
    }
    return chunks.join('');
}

async function ensureSource(project) {
    const srcDir = toSrcDir(project.name);
    const gitDir = path.join(srcDir, '.git');
    const hasGitRepo = await pathExists(gitDir);
    const isEmpty = (await fs.readdir(srcDir)).length === 0;

    if (!hasGitRepo && isEmpty) {
        await runCommand('git', ['clone', project.gitUrl, '.'], {cwd: srcDir});
        return;
    }

    if (!hasGitRepo) {
        throw new Error('源代码目录已存在，但不是 git 仓库，请清理后重试');
    }

    await runCommand('git', ['pull', '--ff-only'], {cwd: srcDir});
}

async function syncSource(project, emitStep, emitLog) {
    const srcDir = toSrcDir(project.name);
    const gitDir = path.join(srcDir, '.git');
    const hasGitRepo = await pathExists(gitDir);
    const isEmpty = (await fs.readdir(srcDir)).length === 0;

    emitStep('检查代码是否存在');

    if (!hasGitRepo && isEmpty) {
        emitStep('下载代码');
        return runCommandStream('git', ['clone', project.gitUrl, '.'], {cwd: srcDir}, emitLog);
    }

    if (!hasGitRepo) {
        throw new Error('源代码目录已存在，但不是 git 仓库，请清理后重试');
    }

    emitStep('更新代码');
    return runCommandStream('git', ['pull', '--ff-only'], {cwd: srcDir}, emitLog);
}

async function runBuild(project, env, emit) {
    await ensureProjectStructure(project.name);
    const srcDir = toSrcDir(project.name);

    const sourceResult = await syncSource(
        project,
        (title) => emit?.('step', {
            title,
            message: `[步骤-${title}]`,
        }),
        (stream, text) => emit?.('log', {stream, text}),
    );

    emit?.('step', {title: '执行编译', message: '[步骤-执行编译]'});
    const scriptResult = await runCommandStream('sh', ['-lc', env.script], {cwd: srcDir}, (stream, text) => emit?.('log', {stream, text}));

    const logParts = [sourceResult?.stdout, sourceResult?.stderr, scriptResult.stdout, scriptResult.stderr];
    let archiveName = '';

    // 输出支持多个文件/目录，使用分号分隔（兼容全角分号）
    const outputEntries = (env.outputDir || '').split(/[;；]/).map((item) => item.trim()).filter(Boolean);

    if (outputEntries.length) {
        emit?.('step', {title: '生成构建产物', message: '[步骤-生成构建产物]'});

        // 先统一校验所有输出路径，避免打包到一半才发现某个路径不存在
        const resolvedOutputs = [];
        for (const entry of outputEntries) {
            const outputDir = path.isAbsolute(entry) ? entry : path.join(srcDir, entry);
            if (!(await pathExists(outputDir))) {
                throw new Error(`输出目录不存在：${entry}`);
            }
            const outputStat = await fs.stat(outputDir);
            if (!outputStat.isFile() && !outputStat.isDirectory()) {
                throw new Error(`输出目录不是文件或目录：${entry}`);
            }
            resolvedOutputs.push({outputDir, isFile: outputStat.isFile()});
        }

        const buildDir = toBuildDir(project.name);
        await fs.mkdir(buildDir, {recursive: true});
        archiveName = buildArchiveName(project.name, env.name);
        const archivePath = path.join(buildDir, archiveName);

        if (resolvedOutputs.length === 1) {
            // 单个输出保持原有行为：文件直接压缩为 zip；目录则将目录内容压缩为 zip
            const {outputDir, isFile} = resolvedOutputs[0];
            const args = isFile ? ['-j', archivePath, outputDir] : ['-r', archivePath, '.'];
            const options = isFile ? {} : {cwd: outputDir};
            const zipResult = await runCommandStream('zip', args, options, (stream, text) => emit?.('log', {stream, text}));
            logParts.push(zipResult.stdout, zipResult.stderr);
        } else {
            // 多个输出依次追加到同一个 zip 归档，归档内保留各自的文件/目录名，避免内容冲突覆盖
            for (const {outputDir, isFile} of resolvedOutputs) {
                const args = isFile
                    ? ['-j', archivePath, outputDir]
                    : ['-r', archivePath, path.basename(outputDir)];
                const options = isFile ? {} : {cwd: path.dirname(outputDir)};
                const zipResult = await runCommandStream('zip', args, options, (stream, text) => emit?.('log', {stream, text}));
                logParts.push(zipResult.stdout, zipResult.stderr);
            }
        }
    } else {
        emit?.('step', {title: '未生成构建产物', message: '[步骤-未生成构建产物]'});
    }

    // 编译最后调用 Hook 地址（可为空），响应内容追加到构建日志末尾
    const hookUrl = (env.hookUrl || '').trim();
    if (hookUrl) {
        emit?.('step', {title: '调用 Hook', message: '[步骤-调用 Hook]'});
        const hookOutput = await callBuildHook(hookUrl, (stream, text) => emit?.('log', {stream, text}));
        logParts.push(hookOutput);
    }

    return {
        archiveName,
        logOutput: logParts.filter(Boolean).join('\n'),
    };
}

async function createProject(body) {
    const name = validateName('项目名称', body.name);
    const description = (body.description || '').trim();
    const gitUrl = (body.gitUrl || '').trim();

    if (!gitUrl) {
        throw new Error('项目代码 Git 地址不能为空');
    }

    const configPath = toConfigPath(name);
    if (await pathExists(configPath)) {
        throw new Error(`项目已存在：${name}`);
    }

    const config = {
        description,
        gitUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        environments: [],
    };

    await saveProjectConfig(name, config);
    await ensureProjectStructure(name);
    return name;
}

async function updateProject(projectName, body) {
    const project = await getProjectConfig(projectName);
    const submittedName = validateName('项目名称', body.name || projectName);
    if (submittedName !== projectName) {
        throw new Error('项目名称不支持修改');
    }

    const description = (body.description || '').trim();
    const gitUrl = (body.gitUrl || '').trim();
    if (!gitUrl) {
        throw new Error('项目代码 Git 地址不能为空');
    }
    // 修改项目信息之后，需要删除源代码目录
    const srcDir = toSrcDir(projectName);
    await fs.rm(srcDir, {recursive: true, force: true});

    await saveProjectConfig(projectName, {
        ...project,
        description,
        gitUrl,
        updatedAt: new Date().toISOString(),
    });
}

async function createEnvironment(projectName, body) {
    const project = await getProjectConfig(projectName);
    const name = validateName('环境名称', body.name);
    const description = (body.description || '').trim();
    const script = (body.script || '').trim();
    const outputDir = (body.outputDir || '').trim();
    const hookUrl = normalizeHookUrl(body.hookUrl);

    if (!script) {
        throw new Error('构建脚本不能为空');
    }

    const environments = Array.isArray(project.environments) ? project.environments : [];
    if (environments.some((env) => env.name === name)) {
        throw new Error(`环境已存在：${name}`);
    }

    environments.push({
        name,
        description,
        script,
        outputDir,
        hookUrl,
        createdAt: new Date().toISOString(),
    });

    await saveProjectConfig(projectName, {
        ...project,
        updatedAt: new Date().toISOString(),
        environments,
    });
}

async function updateEnvironment(projectName, envName, body) {
    const project = await getProjectConfig(projectName);
    const environments = Array.isArray(project.environments) ? project.environments : [];
    const index = environments.findIndex((env) => env.name === envName);

    if (index < 0) {
        throw createHttpError(404, `未找到环境：${envName}`);
    }

    const nextName = validateName('环境名称', body.name || envName);
    const description = (body.description || '').trim();
    const script = (body.script || '').trim();
    const outputDir = (body.outputDir || '').trim();
    const hookUrl = normalizeHookUrl(body.hookUrl);

    if (!script) {
        throw new Error('构建脚本不能为空');
    }

    if (environments.some((env, envIndex) => envIndex !== index && env.name === nextName)) {
        throw new Error(`环境已存在：${nextName}`);
    }

    environments[index] = {
        ...environments[index],
        name: nextName,
        description,
        script,
        outputDir,
        hookUrl,
        updatedAt: new Date().toISOString(),
    };

    await saveProjectConfig(projectName, {
        ...project,
        updatedAt: new Date().toISOString(),
        environments,
    });
}

async function deleteEnvironment(projectName, envName) {
    const project = await getProjectConfig(projectName);
    const environments = Array.isArray(project.environments) ? project.environments : [];
    const nextEnvironments = environments.filter((env) => env.name !== envName);

    if (nextEnvironments.length === environments.length) {
        throw createHttpError(404, `未找到环境：${envName}`);
    }

    await saveProjectConfig(projectName, {
        ...project,
        updatedAt: new Date().toISOString(),
        environments: nextEnvironments,
    });
}

async function deleteProject(projectName) {
    if (!(await pathExists(toConfigPath(projectName)))) {
        throw createHttpError(404, '项目不存在');
    }

    await fs.rm(toProjectDir(projectName), {recursive: true, force: true});
}

async function handleApi(req, res, url) {
    const {pathname} = url;
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET' && pathname === '/api/projects') {
        const projects = await listProjects();
        sendJson(res, 200, {projects});
        return true;
    }

    if (method === 'POST' && pathname === '/api/projects') {
        const body = await readBody(req);
        const name = await createProject(body);
        sendJson(res, 201, {ok: true, name});
        return true;
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && method === 'GET') {
        const projectName = decodeURIComponent(projectMatch[1]);
        const project = await getProjectConfig(projectName);
        const envs = project.environments || [];
        const builds = await listBuildArchives(projectName);
        sendJson(res, 200, {
            project: {name: projectName, ...project},
            envs,
            builds,
        });
        return true;
    }

    const projectEditMatch = pathname.match(/^\/api\/projects\/([^/]+)\/edit$/);
    if (projectEditMatch && method === 'POST') {
        const projectName = decodeURIComponent(projectEditMatch[1]);
        const body = await readBody(req);
        await updateProject(projectName, body);
        sendJson(res, 200, {ok: true});
        return true;
    }

    const projectDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectDeleteMatch && method === 'DELETE') {
        const projectName = decodeURIComponent(projectDeleteMatch[1]);
        await deleteProject(projectName);
        sendJson(res, 200, {ok: true});
        return true;
    }

    const envCreateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/envs$/);
    if (envCreateMatch && method === 'POST') {
        const projectName = decodeURIComponent(envCreateMatch[1]);
        const body = await readBody(req);
        await createEnvironment(projectName, body);
        sendJson(res, 201, {ok: true});
        return true;
    }

    const envEditMatch = pathname.match(/^\/api\/projects\/([^/]+)\/envs\/([^/]+)\/edit$/);
    if (envEditMatch && method === 'POST') {
        const projectName = decodeURIComponent(envEditMatch[1]);
        const envName = decodeURIComponent(envEditMatch[2]);
        const body = await readBody(req);
        await updateEnvironment(projectName, envName, body);
        sendJson(res, 200, {ok: true});
        return true;
    }

    const envDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/envs\/([^/]+)$/);
    if (envDeleteMatch && method === 'DELETE') {
        const projectName = decodeURIComponent(envDeleteMatch[1]);
        const envName = decodeURIComponent(envDeleteMatch[2]);
        await deleteEnvironment(projectName, envName);
        sendJson(res, 200, {ok: true});
        return true;
    }

    const buildStreamMatch = pathname.match(/^\/api\/projects\/([^/]+)\/envs\/([^/]+)\/build\/stream$/);
    if (buildStreamMatch && method === 'POST') {
        const projectName = decodeURIComponent(buildStreamMatch[1]);
        const envName = decodeURIComponent(buildStreamMatch[2]);
        const project = await getProjectConfig(projectName);
        const env = (project.environments || []).find((item) => item.name === envName);

        if (!env) {
            throw createHttpError(404, `未找到环境：${envName}`);
        }

        res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();

        const emit = (type, payload) => {
            writeStreamEvent(res, {type, ...payload});
        };

        try {
            emit('start', {message: '开始构建'});
            const result = await runBuild({name: projectName, ...project}, env, emit);
            emit('done', {
                message: '构建完成',
                archiveName: result.archiveName,
                logOutput: result.logOutput,
            });
        } catch (error) {
            emit('error', {
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            res.end();
        }
        return true;
    }

    const buildMatch = pathname.match(/^\/api\/projects\/([^/]+)\/envs\/([^/]+)\/build$/);
    if (buildMatch && method === 'POST') {
        const projectName = decodeURIComponent(buildMatch[1]);
        const envName = decodeURIComponent(buildMatch[2]);
        const project = await getProjectConfig(projectName);
        const env = (project.environments || []).find((item) => item.name === envName);

        if (!env) {
            throw createHttpError(404, `未找到环境：${envName}`);
        }

        const result = await runBuild({name: projectName, ...project}, env);
        sendJson(res, 200, {ok: true, archiveName: result.archiveName, logOutput: result.logOutput});
        return true;
    }

    const downloadMatch = pathname.match(/^\/api\/projects\/([^/]+)\/builds\/([^/]+)$/);
    if (downloadMatch && method === 'GET') {
        const projectName = decodeURIComponent(downloadMatch[1]);
        const fileName = decodeURIComponent(downloadMatch[2]);
        const filePath = path.join(toBuildDir(projectName), fileName);

        if (!(await pathExists(filePath))) {
            sendJson(res, 404, {error: '文件不存在'});
            return true;
        }

        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${fileName}"`,
        });
        createReadStream(filePath).pipe(res);
        return true;
    }

    // 获取最新版本的构建文件
    // http://192.168.110.177:3000/api/projects/enercy-page-vue/envs/prod/builds/latest
    const lastDownloadMatch = pathname.match(/^\/api\/projects\/([^/]+)\/envs\/([^/]+)\/builds\/latest$/);
    if (lastDownloadMatch && method === 'GET') {
        const projectName = decodeURIComponent(lastDownloadMatch[1]);
        const envName = decodeURIComponent(lastDownloadMatch[2]);
        // 匹配最新的构建文件
        const builds = await listBuildArchives(projectName);
        const latestBuild = builds
            .filter((build) => build.name.startsWith(`${projectName}-${envName}-`))
            .pop();

        if (!latestBuild) {
            sendJson(res, 404, {error: '未找到最新构建文件'});
            return true;
        }

        const fileName = latestBuild.name;
        const filePath = path.join(toBuildDir(projectName), fileName);

        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${projectName}-${envName}-latest.zip"`,
        });
        createReadStream(filePath).pipe(res);
        return true;
    }

    const buildDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/build-delete\/([^/]+)$/);
    if (buildDeleteMatch && method === 'GET') {
        const projectName = decodeURIComponent(buildDeleteMatch[1]);

        const fileName = decodeURIComponent(buildDeleteMatch[2]);
        const filePath = path.join(toBuildDir(projectName), fileName);

        if (!(await pathExists(filePath))) {
            return true;
        }
        // 删除构建产物文件
        await fs.rm(filePath, {force: true});
        sendJson(res, 200, {ok: true});
        return true;
    }

    return false;
}

async function tryServeStatic(req, res, url) {
    if ((req.method || 'GET').toUpperCase() !== 'GET') {
        return false;
    }

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') {
        pathname = '/index.html';
    }

    let filePath = path.resolve(WEB_DIR, `.${pathname}`);
    if (filePath !== WEB_DIR && !filePath.startsWith(`${WEB_DIR}${path.sep}`)) {
        return false;
    }

    const statExists = await pathExists(filePath);
    if (statExists) {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
            res.writeHead(200, {
                'Content-Type': contentTypeFor(filePath),
                'Content-Length': stat.size,
            });
            createReadStream(filePath).pipe(res);
            return true;
        }
    }

    if (!path.extname(pathname)) {
        filePath = path.join(WEB_DIR, 'index.html');
        const stat = await fs.stat(filePath);
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': stat.size,
        });
        createReadStream(filePath).pipe(res);
        return true;
    }

    return false;
}

function sendApiError(res, error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, error?.statusCode || 500, {error: message});
}

export async function startServer(port) {
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

            if (url.pathname.startsWith('/api/')) {
                const handled = await handleApi(req, res, url);
                if (handled) {
                    return;
                }
                sendJson(res, 404, {error: 'API not found'});
                return;
            }

            const staticHandled = await tryServeStatic(req, res, url);
            if (staticHandled) {
                return;
            }

            if (path.extname(url.pathname)) {
                sendJson(res, 404, {error: 'Not found'});
                return;
            }

            sendRedirect(res, '/');
        } catch (error) {
            sendApiError(res, error);
        }
    });

    await new Promise((resolve) => {
        server.listen(port, resolve);
    });

    console.log(`xie-cicd running at http://localhost:${port}`);
    return server;
}
