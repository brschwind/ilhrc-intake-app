export function createCameraScanLatch() {
  let last = "";
  return {
    accept(value) {
      if (value === last) return false;
      last = value;
      return true;
    },
    clear() { last = ""; },
  };
}
