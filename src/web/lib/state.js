export const state = {
    notice: null,
    lastBuild: null,
    buildAbortController: null,
    reloader:null
};


export const notice = (type, message) => {
    state.notice = {type, message};
}

/**
 * 通知刷新页面
 */
export const noticeReload = ()=>{
    if (state.reloader && typeof state.reloader === 'function') {
        state.reloader();
    }
}