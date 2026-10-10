import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {
    APP_DIR,
    ensureAppDir,
    loadClientConfig,
    pathExists,
    saveClientConfig,
    toClientConfigPath,
} from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end(text);
}

// 首次启动时写入的默认配置，其中 hello 作为参照案例，附带字段说明供用户编辑时参考
const DEFAULT_CLIENT_CONFIG = [
    {
        _comment: '每个接口为一个对象：apiPath 是访问路径（唯一，建议使用不易猜测的随机串，如 6987t6565876），apiShell 是被执行的 shell 脚本，执行结果会流式返回给调用者。新增接口直接复制本对象修改 apiPath 和 apiShell 即可；_comment 仅为说明文字，服务端会忽略，可随意修改或删除。修改保存后立即生效，无需重启服务。',
        apiPath: 'hello',
        apiShell: 'echo "cicd-client is running"; date',
        createdAt: new Date().toISOString(),
    },
];

async function ensureClientConfig() {
    // 配置文件不存在时创建一份默认配置；已存在则不覆盖
    if (await pathExists(toClientConfigPath())) {
        return;
    }
    await saveClientConfig(DEFAULT_CLIENT_CONFIG);
}

async function findApiItem(apiPath) {
    const apis = await loadClientConfig();
    return apis.find((item) => item.apiPath === apiPath) || null;
}

/**
 * 执行接口对应的 shell 脚本，并把 stdout/stderr 实时流式响应给调用方。
 * 脚本可通过环境变量 CICD_CLIENT_API_PATH、CICD_CLIENT_QUERY 获取本次调用的上下文。
 */
function executeApiShell(req, res, apiItem) {
    return new Promise((resolve) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();

        const child = spawn('sh', ['-lc', apiItem.apiShell], {
            shell: false,
            cwd: APP_DIR,
            env: {
                ...process.env,
                CICD_CLIENT_API_PATH: apiItem.apiPath,
                CICD_CLIENT_QUERY: url.search.replace(/^\?/, ''),
            },
        });

        // 逐块透传，脚本边输出调用方边收到
        child.stdout.pipe(res, {end: false});
        child.stderr.pipe(res, {end: false});

        child.on('error', (error) => {
            res.end(`[错误] 脚本启动失败：${error.message}\n`);
        });

        child.on('close', (code) => {
            res.end(`\n[执行结束，退出码：${code === null ? 'killed' : code}]\n`);
        });

        // 调用方中途断开连接时，同步终止脚本，避免残留进程
        res.on('close', () => {
            if (!res.writableFinished && !child.killed && child.exitCode === null && child.signalCode === null) {
                child.kill('SIGTERM');
            }
            resolve();
        });
    });
}

export async function startClientServer(port) {
    await ensureAppDir();
    await ensureClientConfig();

    const server = http.createServer(async (req, res) => {
        try {
            const method = (req.method || 'GET').toUpperCase();
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

            // 根路径：返回服务存活状态文本
            if (url.pathname === '/' || url.pathname === '') {
                sendText(res, 200, 'xie-cicd-client is running\n');
                return;
            }

            // 只接受单段路径（如 /6987t6565876），命中 client.json 中的接口配置才执行脚本
            const apiPathMatch = url.pathname.match(/^\/([^/]+)$/);
            if (!apiPathMatch || !['GET', 'POST'].includes(method)) {
                sendJson(res, 404, {error: 'Not found'});
                return;
            }

            const apiPath = decodeURIComponent(apiPathMatch[1]);
            const apiItem = await findApiItem(apiPath);
            if (!apiItem || !(apiItem.apiShell || '').trim()) {
                sendJson(res, 404, {error: '接口不存在'});
                return;
            }

            await executeApiShell(req, res, apiItem);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendText(res, 500, `服务内部错误：${message}`);
        }
    });

    await new Promise((resolve) => {
        server.listen(port, resolve);
    });

    console.log(`xie-cicd-client running at http://localhost:${port}`);
    return server;
}
