if (process.argv.includes('--skillforge-playback')) {
  require('./playback-host.cjs');
} else {
  require('./main.cjs');
}
