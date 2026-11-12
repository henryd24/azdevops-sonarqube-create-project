export function info(message: string) {
  console.info(message);
}

export function success(message: string) {
  console.info(message);
}

export function warn(message: string) {
  console.warn(message);
}

export function error(message: string) {
  console.error(message);
}

export function group(title: string) {
  console.info(`##[group]${title}`);
}

export function endGroup() {
  console.info(`##[endgroup]`);
}

export default { info, success, warn, error, group, endGroup };
