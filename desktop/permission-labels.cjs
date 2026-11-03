// Keep this map aligned with Electron 45.2.1's Session Permission union. The
// renderer-facing confirmation must never expose an unknown protocol name.
const permissionLabels = Object.freeze({
  ar: '增强现实',
  'automatic-fullscreen': '自动进入全屏',
  'background-fetch': '后台下载',
  'background-sync': '后台同步',
  'captured-surface-control': '控制共享的屏幕或窗口',
  'clipboard-read': '读取剪贴板',
  'clipboard-sanitized-write': '向剪贴板写入内容',
  'deprecated-sync-clipboard-read': '读取剪贴板',
  'display-capture': '共享屏幕或窗口',
  fileSystem: '访问文件',
  fullscreen: '进入全屏',
  geolocation: '获取精确位置信息',
  'geolocation-approximate': '获取大致位置信息',
  'hand-tracking': '读取手部动作',
  hid: '访问 HID 设备',
  'idle-detection': '检测设备是否空闲',
  keyboardLock: '锁定键盘输入',
  'local-fonts': '读取本机字体',
  'local-network': '访问本地网络',
  'local-network-access': '访问本地网络设备',
  'loopback-network': '访问本机网络服务',
  media: '使用摄像头或麦克风',
  mediaKeySystem: '播放受保护的媒体内容',
  midi: '访问 MIDI 设备',
  midiSysex: '访问 MIDI 设备并发送系统专用消息',
  nfc: '访问 NFC 设备',
  notifications: '发送通知',
  openExternal: '打开外部应用或链接',
  'payment-handler': '处理付款',
  'periodic-background-sync': '定期在后台同步数据',
  'persistent-storage': '持久保存网站数据',
  pointerLock: '锁定鼠标指针',
  'screen-wake-lock': '防止屏幕休眠',
  sensors: '读取设备传感器',
  serial: '访问串口设备',
  'smart-card': '访问智能卡',
  'speaker-selection': '选择音频输出设备',
  'storage-access': '访问嵌入网站的存储数据',
  'system-wake-lock': '阻止系统休眠',
  'top-level-storage-access': '访问顶层网站的存储数据',
  usb: '访问 USB 设备',
  vr: '访问虚拟现实设备',
  'web-app-installation': '安装网站应用',
  'web-printing': '使用网页打印',
  'window-management': '查看和管理窗口',
  unknown: '一项尚未识别的浏览器权限',
});

const mediaLabels = Object.freeze({ audio: '麦克风', video: '摄像头' });
const unknownPermissionLabel = '一项尚未识别的浏览器权限';

function permissionDisplayName(permission, mediaTypes = []) {
  if (permission === 'media' && Array.isArray(mediaTypes) && mediaTypes.length) {
    const labels = [...new Set(mediaTypes.map(type => mediaLabels[type] || '媒体设备'))];
    return labels.join('、');
  }
  if (permission === 'display-capture' && Array.isArray(mediaTypes) && mediaTypes.includes('audio')) {
    return '共享屏幕或窗口及音频';
  }

  return permissionLabels[permission] || unknownPermissionLabel;
}

module.exports = { permissionDisplayName, unknownPermissionLabel };
