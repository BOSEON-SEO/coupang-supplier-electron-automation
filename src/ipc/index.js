// 신규(v4) IPC 컨트롤러 등록 진입점.
// 기존 ipc-handlers.js 는 그대로 유지 (M2~M5 사이 점진 분해). 여기서 등록되는 건 NEW 채널만.
function registerV4Handlers() {
  require('./pos').register();
  require('./inbox').register();
  require('./lots').register();
}

module.exports = { registerV4Handlers };
