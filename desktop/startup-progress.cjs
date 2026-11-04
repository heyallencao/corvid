const fs = require('node:fs');
const path = require('node:path');

function createStartupProgress({ dataDir, enabled, onError = error => console.error(error.message) }) {
  const progressPath = path.join(dataDir, 'startup-progress.json');
  let startupCompleted = false;
  return stage => {
    if (!enabled || startupCompleted) return;
    try {
      const temp = `${progressPath}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ stage, pid: process.pid, updatedAt: new Date().toISOString() }), { mode: 0o600 });
      fs.chmodSync(temp, 0o600);
      fs.renameSync(temp, progressPath);
      if (stage === 'startup-complete') startupCompleted = true;
    } catch (error) {
      onError(error);
    }
  };
}

module.exports = { createStartupProgress };
