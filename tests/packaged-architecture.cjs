function normalizeMacArchitecture(architecture) {
  return architecture === 'x86_64' ? 'x64' : architecture;
}

module.exports = { normalizeMacArchitecture };
