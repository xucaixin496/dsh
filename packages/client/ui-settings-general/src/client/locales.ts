/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'updater.repo': '更新仓库',
  'updater.unconfigured': '未配置（在桌面端设置中填写）',
  'updater.check': '检查更新',
  'updater.update': '更新',
  'updater.checking': '正在检查更新…',
  'updater.latest': '已是最新版本（{hash}）',
  'updater.available': '发现 {count} 个新提交（本地 {local} → 远端 {remote}）',
  'updater.applying': '正在更新（拉取+安装依赖+构建），可能需要几分钟，请勿关闭…',
  'updater.applyDone': '更新完成，请重启客户端生效',
  'updater.failed': '更新失败：{reason}',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'updater.repo': 'Update repository',
  'updater.unconfigured': 'Not configured (set it in the desktop settings)',
  'updater.check': 'Check for updates',
  'updater.update': 'Update',
  'updater.checking': 'Checking for updates…',
  'updater.latest': 'Already up to date ({hash})',
  'updater.available': '{count} new commit(s) (local {local} → remote {remote})',
  'updater.applying': 'Updating (pull + install + build); this may take a few minutes…',
  'updater.applyDone': 'Update complete; restart the client to apply it',
  'updater.failed': 'Update failed: {reason}',
} satisfies Record<SettingsKey, string>
