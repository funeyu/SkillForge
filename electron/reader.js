document.getElementById('reader-read').addEventListener('click', () => window.skillforgeReader.read());
document.getElementById('reader-cancel').addEventListener('click', () => window.skillforgeReader.cancel());
window.skillforgeReader.onStatus(value => {
  document.getElementById('reader-message').textContent = value.message;
  document.getElementById('reader-url').textContent = value.url;
  document.getElementById('reader-read').textContent = value.waitingForUser ? '登录完成，重新读取' : '重新读取';
});
