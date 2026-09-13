/**
 * 浏览器会话控制令牌。
 *
 * 作者：JucieOvo
 *
 * 控制令牌只保存在 sessionStorage，关闭当前标签页后自动清除。读取失败时按未配置
 * 处理，由服务端统一返回鉴权错误，不在客户端伪造权限状态。
 */

const CONTROL_TOKEN_STORAGE_KEY = "modelmayhem-control-token";

export function readSessionControlToken(): string {
  try {
    return sessionStorage.getItem(CONTROL_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeSessionControlToken(value: string): void {
  try {
    if (value.length === 0) {
      sessionStorage.removeItem(CONTROL_TOKEN_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(CONTROL_TOKEN_STORAGE_KEY, value);
  } catch {
    return;
  }
}
